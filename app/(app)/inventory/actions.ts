"use server";

import { revalidatePath } from "next/cache";

import { assertCan } from "@/lib/auth/visibility";
import {
  ATTRIBUTE_FIELDS,
  isCategory,
  parseItemInput,
  parseProductInput,
  type ItemInput,
  type ProductInput,
  type ShadeInput,
} from "@/lib/catalog";
import { getCurrentProfile } from "@/lib/dal";
import {
  parseCorrectionInput,
  parseRestockInput,
  type CorrectionInput,
  type RestockInput,
} from "@/lib/stock";
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

/** Coerce one client-supplied shade row (untrusted JSON) into a {@link ShadeInput}
 * of plain strings, so {@link parseProductInput} can validate it. */
function coerceShade(raw: unknown): ShadeInput {
  const row = (raw ?? {}) as Record<string, unknown>;
  const str = (value: unknown) => (value == null ? "" : String(value));
  const id = str(row.id).trim();
  return {
    ...(id ? { id } : {}),
    shade: str(row.shade),
    size: str(row.size),
    expiry: str(row.expiry),
    cost: str(row.cost),
    price: str(row.price),
  };
}

/**
 * Create a cosmetic Product with its shade Items, or edit an existing one (when
 * an `id` is present). Owner-only — gated here with {@link assertCan} and again
 * by is_owner() inside the `save_cosmetic_product` RPC, which performs the whole
 * write (the Product plus every shade Item) in one transaction so a partial save
 * can't orphan a Product or duplicate shades on a retry. The shade rows arrive
 * as a JSON string in the `shades` field — the editor is a dynamic list — and
 * are validated by {@link parseProductInput} (which derives each shade Item's
 * name and attributes). Bound to the Product editor via `useActionState`.
 */
export async function saveProduct(
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const profile = await getCurrentProfile();
  assertCan(profile, "catalog:write");

  const id = String(formData.get("id") ?? "").trim();

  let rawShades: unknown;
  try {
    rawShades = JSON.parse(String(formData.get("shades") ?? "[]"));
  } catch {
    return { status: "error", message: "Couldn’t read the shades — please try again." };
  }

  const input: ProductInput = {
    ...(id ? { id } : {}),
    name: String(formData.get("name") ?? ""),
    brand: String(formData.get("brand") ?? ""),
    shades: Array.isArray(rawShades) ? rawShades.map(coerceShade) : [],
  };

  const parsed = parseProductInput(input);
  if (!parsed.ok) {
    return { status: "error", message: parsed.error };
  }

  // One atomic RPC writes the Product and all its shade Items; is_owner() is
  // re-checked there, and the items_product_only_cosmetic CHECK keeps the
  // "cosmetics only" rule. Names/attributes are already derived by the parser.
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_cosmetic_product", {
    p_id: parsed.value.id ?? null,
    p_name: parsed.value.name,
    p_brand: parsed.value.brand,
    p_shades: parsed.value.shades.map((shade) => ({
      id: shade.id ?? null,
      name: shade.name,
      cost_pesewas: shade.cost_pesewas,
      price_pesewas: shade.price_pesewas,
      attributes: shade.attributes,
    })),
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/inventory");

  const count = parsed.value.shades.length;
  const shadeNoun = count === 1 ? "shade" : "shades";
  return {
    status: "success",
    message: id
      ? `“${parsed.value.name}” updated`
      : `“${parsed.value.name}” added with ${count} ${shadeNoun}`,
  };
}

/**
 * Record a Restock — N units in for an Item at a chosen Shop, with an optional
 * logged reason. Owner-only: gated here with {@link assertCan} for an early
 * reject and again by is_owner() inside the SECURITY DEFINER `record_restock`
 * RPC, the sole write path. The first Restock of an Item at a Shop creates its
 * shop_stock row — the Shop begins **carrying** the Item — and the RPC raises
 * the denormalized quantity and appends the ledger movement in one transaction
 * (ADR-0004/0005). Input is validated by {@link parseRestockInput}; the amount
 * is sent as the RPC's positive `p_amount`. Bound to the restock modal via
 * `useActionState`.
 */
export async function recordRestock(
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const profile = await getCurrentProfile();
  assertCan(profile, "stock:restock");

  const input: RestockInput = {
    itemId: String(formData.get("item_id") ?? ""),
    shopId: String(formData.get("shop_id") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    note: String(formData.get("note") ?? ""),
  };

  const parsed = parseRestockInput(input);
  if (!parsed.ok) {
    return { status: "error", message: parsed.error };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_restock", {
    p_item_id: parsed.value.itemId,
    p_shop_id: parsed.value.shopId,
    p_amount: parsed.value.amount,
    p_note: parsed.value.note,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/inventory");

  const { amount } = parsed.value;
  return {
    status: "success",
    message: `Stock updated — ${amount} ${amount === 1 ? "unit" : "units"} in`,
  };
}

/**
 * Record a Correction — a signed adjustment to an Item's stock at one Shop to
 * fix a miscount, breakage, or loss, with a required reason logged to the
 * append-only ledger. Owner-only: gated here with {@link assertCan} for an early
 * reject and again by is_owner() inside the SECURITY DEFINER `record_correction`
 * RPC, the sole write path. The RPC refuses to drive the Shop's quantity below 0
 * and won't touch an Item the Shop doesn't carry, raising an error this surfaces
 * verbatim. Input is validated by {@link parseCorrectionInput}; the signed value
 * is the RPC's `p_amount` and the reason its `p_note`. Bound to the correction
 * modal via `useActionState`.
 */
export async function recordCorrection(
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const profile = await getCurrentProfile();
  assertCan(profile, "stock:correct");

  const input: CorrectionInput = {
    itemId: String(formData.get("item_id") ?? ""),
    shopId: String(formData.get("shop_id") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  };

  const parsed = parseCorrectionInput(input);
  if (!parsed.ok) {
    return { status: "error", message: parsed.error };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_correction", {
    p_item_id: parsed.value.itemId,
    p_shop_id: parsed.value.shopId,
    p_amount: parsed.value.amount,
    p_note: parsed.value.reason,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/inventory");
  revalidatePath(`/inventory/${parsed.value.itemId}`);

  const magnitude = Math.abs(parsed.value.amount);
  const units = magnitude === 1 ? "unit" : "units";
  return {
    status: "success",
    message:
      parsed.value.amount > 0
        ? `Correction recorded — ${magnitude} ${units} added`
        : `Correction recorded — ${magnitude} ${units} removed`,
  };
}
