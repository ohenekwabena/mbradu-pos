import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type ProfileRole = "owner" | "cashier";

export interface CurrentProfile {
  id: string;
  email: string | null;
  role: ProfileRole;
  fullName: string | null;
  /**
   * The Cashier's one Shop. `null` for the Owner, who spans all Shops and
   * instead picks a Shop context when selling or viewing a single Shop
   * (ADR-0005). A Cashier always has a Shop.
   */
  shopId: string | null;
}

/**
 * Secure auth check for Server Components / Actions: validates the user via
 * Supabase (`getUser`, which re-checks with the auth server) and loads their
 * profile. Redirects to /login when there is no authenticated user or profile.
 * Memoized per render pass with React `cache`.
 */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name, shop_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/login");
  }

  return {
    id: user.id,
    email: user.email ?? null,
    role: profile.role as ProfileRole,
    fullName: profile.full_name ?? null,
    shopId: profile.shop_id ?? null,
  };
});
