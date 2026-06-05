"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { assertCan } from "@/lib/auth/visibility";
import { getCurrentProfile } from "@/lib/dal";
import { parseSaleInput, type SaleLineInput } from "@/lib/sale";
import { ALL_SHOPS } from "@/lib/shop-context";
import { readShopScope } from "@/lib/shop-context-server";
import { createClient } from "@/lib/supabase/server";

export type SaleFormState =
  | { status: "idle" }
  | { status: "error"; message: string };

/** One cart line as the sell screen submits it (a JSON array in the form). */
interface CartEntry {
  itemId: string;
  quantity: number;
}

/**
 * Complete a cash sale at the current Shop. A Cashier sells at their own Shop;
 * the Owner sells at their active Shop context (never "all"). The cart arrives as
 * a JSON array of `{ itemId, quantity }`; prices and on-hand stock are re-read
 * **server-side** (never trusted from the client) to build the validated payload,
 * which {@link parseSaleInput} checks (non-empty, whole quantities, carried, no
 * oversell, cash ≥ total). The write goes through the atomic, authorization-
 * checked `complete_sale` RPC — the final authority — which decrements stock,
 * writes one Sale + a line item + a Sale movement per line, and records the cash
 * payment, all in one transaction. On success we redirect to the immutable
 * receipt. Bound to the sell form via `useActionState`.
 */
export async function completeSale(
  _prev: SaleFormState,
  formData: FormData,
): Promise<SaleFormState> {
  const profile = await getCurrentProfile();

  // Resolve the Shop the sale belongs to. The DB RPC re-checks this; resolving it
  // here lets us gate early and fix the shop_id to the server's view, not a
  // client-supplied value.
  let shopId: string;
  if (profile.role === "cashier") {
    if (!profile.shopId) {
      return { status: "error", message: "Your account isn’t assigned to a shop yet." };
    }
    shopId = profile.shopId;
  } else {
    const scope = await readShopScope();
    if (scope === ALL_SHOPS) {
      return { status: "error", message: "Pick a shop to sell from first." };
    }
    shopId = scope;
  }
  assertCan(profile, "sale:create", shopId);

  // The cart: a JSON array of { itemId, quantity } the sell screen serializes.
  let rawCart: unknown;
  try {
    rawCart = JSON.parse(String(formData.get("cart") ?? "[]"));
  } catch {
    return { status: "error", message: "Couldn’t read the cart — please try again." };
  }
  const cart: CartEntry[] = Array.isArray(rawCart)
    ? rawCart.map((entry) => {
        const row = (entry ?? {}) as Record<string, unknown>;
        return { itemId: String(row.itemId ?? ""), quantity: Number(row.quantity ?? 0) };
      })
    : [];
  if (cart.length === 0) {
    return { status: "error", message: "Add at least one item to the sale." };
  }

  // Resolve each line's authoritative unit price + on-hand stock at this Shop.
  // Price comes from the cost-masking items_catalog (price is visible to all);
  // availability from this Shop's shop_stock — a missing row means "not carried".
  const supabase = await createClient();
  const itemIds = [...new Set(cart.map((c) => c.itemId).filter(Boolean))];
  const [{ data: itemRows }, { data: stockRows }] = await Promise.all([
    supabase.from("items_catalog").select("id, name, price_pesewas").in("id", itemIds),
    supabase.from("shop_stock").select("item_id, quantity").eq("shop_id", shopId).in("item_id", itemIds),
  ]);

  const catalogById = new Map(
    (itemRows ?? []).map((r) => [r.id as string, { name: r.name as string, price: r.price_pesewas as number }]),
  );
  const stockById = new Map((stockRows ?? []).map((r) => [r.item_id as string, r.quantity as number]));

  const lines: SaleLineInput[] = cart.map((c) => {
    const catalog = catalogById.get(c.itemId);
    return {
      itemId: c.itemId,
      name: catalog?.name,
      quantity: c.quantity,
      unitPrice: catalog?.price ?? 0,
      available: stockById.has(c.itemId) ? (stockById.get(c.itemId) as number) : null,
    };
  });

  const parsed = parseSaleInput({
    shopId,
    customer: String(formData.get("customer") ?? ""),
    lines,
    tendered: String(formData.get("tendered") ?? ""),
  });
  if (!parsed.ok) {
    return { status: "error", message: parsed.error };
  }

  const { data: saleId, error } = await supabase.rpc("complete_sale", {
    p_shop_id: parsed.value.shopId,
    p_customer: parsed.value.customer ?? "",
    p_lines: parsed.value.lines,
    p_payments: parsed.value.payments,
  });
  if (error) {
    return { status: "error", message: error.message };
  }

  // The sale changed this Shop's stock; the inventory views read it.
  revalidatePath("/sell");
  revalidatePath("/inventory");

  // Hand off to the immutable receipt. The cash tendered isn't persisted (only
  // the payment, which equals the total), so it rides along for the change line.
  redirect(`/sales/${saleId}?tendered=${parsed.value.tendered}`);
}
