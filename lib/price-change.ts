/**
 * A price changed since the Sell screen loaded (ADR-0008, GitHub #30).
 *
 * `complete_sale` refuses a Sale whose server total differs from what the
 * cashier was shown, raising `price_changed` with each cart Item's current price.
 * The phone then shows the cashier what changed and the new total, and only a
 * confirmed resend (same Sale id, new expected total) can write the Sale — no
 * Sale is ever charged at a total the cashier wasn't shown. Pure; unit-tested.
 */

import type { CurrentPrice } from "./sale-errors";

/** One cart line as the cashier last saw it. */
export interface ShownLine {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface PriceChange {
  /** Only the lines whose unit price moved. */
  changed: { itemId: string; name: string; quantity: number; oldPrice: number; newPrice: number }[];
  oldTotal: number;
  newTotal: number;
}

/**
 * Compare what the cashier was shown with the server's current prices. Lines the
 * server didn't report keep their shown price. Returns `null` when nothing moved
 * (nothing to confirm).
 */
export function priceChange(shown: readonly ShownLine[], current: readonly CurrentPrice[]): PriceChange | null {
  const priceById = new Map(current.map((p) => [p.itemId, p.price]));
  let oldTotal = 0;
  let newTotal = 0;
  const changed: PriceChange["changed"] = [];
  for (const line of shown) {
    const newPrice = priceById.get(line.itemId) ?? line.unitPrice;
    oldTotal += line.unitPrice * line.quantity;
    newTotal += newPrice * line.quantity;
    if (newPrice !== line.unitPrice) {
      changed.push({ itemId: line.itemId, name: line.name, quantity: line.quantity, oldPrice: line.unitPrice, newPrice });
    }
  }
  return changed.length === 0 ? null : { changed, oldTotal, newTotal };
}

/** Apply the server's current prices to anything carrying `{ id, price }`. */
export function applyPrices<T extends { id: string; price: number }>(items: readonly T[], current: readonly CurrentPrice[]): T[] {
  const priceById = new Map(current.map((p) => [p.itemId, p.price]));
  return items.map((item) => {
    const price = priceById.get(item.id);
    return price === undefined || price === item.price ? item : { ...item, price };
  });
}
