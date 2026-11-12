/**
 * Stable error codes raised by the `complete_sale` RPC, and their plain-English
 * copy (ADR-0008, GitHub #27).
 *
 * The RPC raises each rejection with the **code as the error message** and a JSON
 * `detail` payload (item id, available quantity, current prices, …). The app
 * never shows raw database text: {@link parseSaleError} turns a PostgREST error
 * into a typed {@link SaleError}, and {@link saleErrorMessage} renders it for the
 * cashier. Anything that isn't a known code (a network failure, an unexpected
 * database error) becomes `unexpected`. Pure — unit-tested in `sale-errors.test.ts`.
 */

import { format } from "./money";

export const SALE_ERROR_CODES = [
  "not_authorized",
  "sale_id_conflict",
  "empty_sale",
  "invalid_quantity",
  "unknown_item",
  "not_carried",
  "insufficient_stock",
  "invalid_payment",
  "payment_mismatch",
  "price_changed",
] as const;

export type SaleErrorCode = (typeof SALE_ERROR_CODES)[number] | "unexpected";

/** The current server price of one Item, as `price_changed` reports it. */
export interface CurrentPrice {
  itemId: string;
  price: number;
}

export interface SaleError {
  code: SaleErrorCode;
  /** The Item the error is about, when there is one. */
  itemId?: string;
  /** `insufficient_stock`: how many are on hand at the Shop. */
  available?: number;
  /** `price_changed`: the server-side total and each line's current price. */
  total?: number;
  prices?: CurrentPrice[];
}

/** The shape of a PostgREST / supabase-js error (only the fields we read). */
export interface RpcErrorLike {
  message?: string | null;
  details?: string | null;
}

function isCode(value: string): value is (typeof SALE_ERROR_CODES)[number] {
  return (SALE_ERROR_CODES as readonly string[]).includes(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Read a `complete_sale` failure into a typed {@link SaleError}. */
export function parseSaleError(error: RpcErrorLike | null | undefined): SaleError {
  const message = (error?.message ?? "").trim();
  if (!isCode(message)) return { code: "unexpected" };

  let detail: Record<string, unknown> = {};
  if (error?.details) {
    try {
      const parsed: unknown = JSON.parse(error.details);
      if (parsed && typeof parsed === "object") detail = parsed as Record<string, unknown>;
    } catch {
      // A non-JSON detail is ignored — the code alone is enough to explain it.
    }
  }

  const result: SaleError = { code: message };
  if (typeof detail.item_id === "string") result.itemId = detail.item_id;
  const available = asNumber(detail.available);
  if (available !== undefined) result.available = available;
  const total = asNumber(detail.total_pesewas);
  if (message === "price_changed" && total !== undefined) result.total = total;
  if (message === "price_changed" && Array.isArray(detail.prices)) {
    result.prices = detail.prices.flatMap((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      const price = asNumber(r.price_pesewas);
      return typeof r.item_id === "string" && price !== undefined ? [{ itemId: r.item_id, price }] : [];
    });
  }
  return result;
}

/**
 * The cashier-facing sentence for a {@link SaleError}. `itemName` resolves an
 * Item id to its display name (falls back to "an item").
 */
export function saleErrorMessage(error: SaleError, itemName: (itemId: string) => string | undefined = () => undefined): string {
  const name = error.itemId ? itemName(error.itemId) : undefined;
  const label = name ? `“${name}”` : "an item";

  switch (error.code) {
    case "insufficient_stock":
      return error.available !== undefined && error.available > 0
        ? `Only ${error.available} of ${label} left at this shop — the cart has been updated. Check it and complete again.`
        : `${name ? `“${name}” is` : "An item is"} out of stock at this shop — it’s been taken out of the cart.`;
    case "not_carried":
      return `${name ? `“${name}” isn’t` : "An item isn’t"} stocked at this shop. Remove it and try again.`;
    case "unknown_item":
      return "An item in the cart no longer exists. Remove it and try again.";
    case "invalid_quantity":
      return `Set a whole quantity above 0 for ${label}.`;
    case "empty_sale":
      return "Add at least one item to the sale.";
    case "invalid_payment":
      return "Enter how the sale was paid.";
    case "payment_mismatch":
      return "The payments don’t add up to the total. Check the amounts and try again.";
    case "price_changed":
      return error.total !== undefined
        ? `Prices changed since this screen loaded — the total is now ${format(error.total)}. Check the cart and confirm again.`
        : "Prices changed since this screen loaded. Check the cart and confirm again.";
    case "not_authorized":
      return "You can’t sell at this shop. Sign in again or ask the Owner.";
    case "sale_id_conflict":
      return "Something went wrong with this sale. Start a new sale and try again.";
    case "unexpected":
      return "The sale didn’t go through. Check your connection and try again — it won’t be recorded twice.";
  }
}
