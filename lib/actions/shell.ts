"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/dal";
import { ALL_SHOPS, SHOP_SCOPE_COOKIE } from "@/lib/shop-context";
import { createClient } from "@/lib/supabase/server";

/** End the session and return to the login screen. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Set the Owner's active Shop context (a Shop id, or {@link ALL_SHOPS}). Only
 * the Owner has a context to pick; a Cashier is fixed to their own Shop. The
 * target is validated against the Shops the caller can see (RLS), so a stale or
 * forged id falls back to "all". Revalidates the shell so every Shop-scoped view
 * re-reads the new context.
 */
export async function setShopScope(scope: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") return; // a Cashier has no Shop context

  let value = scope;
  if (value !== ALL_SHOPS) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("shops")
      .select("id")
      .eq("id", value)
      .maybeSingle();
    if (!data) value = ALL_SHOPS; // unknown / unauthorized shop → all
  }

  const store = await cookies();
  store.set(SHOP_SCOPE_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
}
