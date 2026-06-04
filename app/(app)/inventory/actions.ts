"use server";

import { revalidatePath } from "next/cache";

import { assertCan } from "@/lib/auth/visibility";
import {
  ATTRIBUTE_FIELDS,
  isCategory,
  parseItemInput,
  type ItemInput,
} from "@/lib/catalog";
import { getCurrentProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export type ItemFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

/**
 * Create a catalog Item, or edit an existing one (when an `id` is present).
 * Owner-only — gated here with {@link assertCan} for an early reject, and again
 * by the "Owner writes items" RLS policy on the base table. Cost and price are
 * entered in GH₵ and stored as integer pesewas; category-specific Attributes
 * land in the flexible `attributes` JSONB. Stock is NOT set here — Items are
 * business-wide and stock lives per Shop (ADR-0005). Bound to the editor form
 * via `useActionState`.
 */
export async function saveItem(
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const profile = await getCurrentProfile();
  assertCan(profile, "catalog:write");

  const id = String(formData.get("id") ?? "").trim();
  const category = String(formData.get("category") ?? "");

  // Pull only the attribute inputs that belong to the chosen category, so a
  // stale field left in the form from a previous category can't be written.
  const attributes: Record<string, string> = {};
  if (isCategory(category)) {
    for (const field of ATTRIBUTE_FIELDS[category]) {
      attributes[field.key] = String(formData.get(`attr_${field.key}`) ?? "");
    }
  }

  const input: ItemInput = {
    category,
    name: String(formData.get("name") ?? ""),
    cost: String(formData.get("cost") ?? ""),
    price: String(formData.get("price") ?? ""),
    attributes,
  };

  const parsed = parseItemInput(input);
  if (!parsed.ok) {
    return { status: "error", message: parsed.error };
  }

  // Write the base table (not the masked items_catalog view): RLS gates this to
  // the Owner. cost_pesewas is writable here even though it's hidden on read.
  const payload = {
    category: parsed.value.category,
    name: parsed.value.name,
    cost_pesewas: parsed.value.cost_pesewas,
    price_pesewas: parsed.value.price_pesewas,
    attributes: parsed.value.attributes,
  };

  const supabase = await createClient();

  if (id) {
    const { error } = await supabase.from("items").update(payload).eq("id", id);
    if (error) return { status: "error", message: error.message };
    revalidatePath("/inventory");
    return { status: "success", message: "Item updated" };
  }

  const { error } = await supabase.from("items").insert(payload);
  if (error) return { status: "error", message: error.message };
  revalidatePath("/inventory");
  return { status: "success", message: `“${parsed.value.name}” added to the catalog` };
}
