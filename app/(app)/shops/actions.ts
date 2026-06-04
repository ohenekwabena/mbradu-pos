"use server";

import { revalidatePath } from "next/cache";

import { assertCan } from "@/lib/auth/visibility";
import { getCurrentProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export type ShopFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

/**
 * Open a new Shop, or edit an existing one (when an `id` is present). Owner-only
 * — gated here for early rejection and again by RLS ("Owner manages all shops").
 * Name is required; address and phone are optional and print on receipts.
 * Bound to the editor form via `useActionState`.
 */
export async function saveShop(
  _prev: ShopFormState,
  formData: FormData,
): Promise<ShopFormState> {
  const profile = await getCurrentProfile();
  assertCan(profile, "shop:create");

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;

  if (!name) {
    return { status: "error", message: "Enter a shop name." };
  }

  const supabase = await createClient();

  if (id) {
    assertCan(profile, "shop:manage");
    const { error } = await supabase
      .from("shops")
      .update({ name, address, phone })
      .eq("id", id);
    if (error) return { status: "error", message: error.message };
    revalidatePath("/shops");
    return { status: "success", message: "Shop updated" };
  }

  const { error } = await supabase.from("shops").insert({ name, address, phone });
  if (error) return { status: "error", message: error.message };
  revalidatePath("/shops");
  return { status: "success", message: `“${name}” opened` };
}
