/**
 * The Sell screen's own stock figures (ADR-0008, GitHub #29/#31).
 *
 * The catalogue loads once per visit, so the phone keeps its stock current
 * locally: sold quantities come off after each confirmed Sale, a quiet
 * background refresh adopts the Shop's live quantities (the Owner may restock,
 * correct, or approve a Stock take meanwhile), and an `insufficient_stock`
 * rejection clamps the cart to what's really left. The phone's figure is a hint;
 * `complete_sale` stays the authority on no overselling. Pure; unit-tested.
 */

interface Stocked {
  id: string;
  stock: number;
}

/** Take a confirmed Sale's quantities off the matching Items (floored at 0). */
export function deductSold<T extends Stocked>(items: readonly T[], sold: readonly { item_id: string; quantity: number }[]): T[] {
  const byId = new Map<string, number>();
  for (const line of sold) byId.set(line.item_id, (byId.get(line.item_id) ?? 0) + line.quantity);
  return items.map((item) =>
    byId.has(item.id) ? { ...item, stock: Math.max(0, item.stock - (byId.get(item.id) as number)) } : item,
  );
}

/**
 * Adopt the Shop's live quantities. Items missing from `rows` keep their figure.
 * Returns the **same array** when nothing changed, so a no-op refresh doesn't
 * re-render the screen.
 */
export function applyStock<T extends Stocked>(items: readonly T[], rows: readonly { item_id: string; quantity: number }[]): T[] {
  const qtyById = new Map(rows.map((row) => [row.item_id, row.quantity]));
  let changed = false;
  const next = items.map((item) => {
    const qty = qtyById.get(item.id);
    if (qty === undefined || qty === item.stock) return item;
    changed = true;
    return { ...item, stock: Math.max(0, qty) };
  });
  return changed ? next : (items as T[]);
}

/** Set one Item's stock to what the server says is left. */
export function setAvailable<T extends Stocked>(items: readonly T[], itemId: string, available: number): T[] {
  return items.map((item) => (item.id === itemId ? { ...item, stock: Math.max(0, available) } : item));
}

/**
 * Clamp one cart line to what's available: lower its quantity (and the stock it
 * carries for the stepper cap), or drop it when none are left.
 */
export function clampCartLine<L extends { item: Stocked; qty: number }>(
  cart: ReadonlyMap<string, L>,
  itemId: string,
  available: number,
): Map<string, L> {
  const next = new Map(cart);
  const line = next.get(itemId);
  if (!line) return next;
  const left = Math.max(0, available);
  if (left === 0) next.delete(itemId);
  else next.set(itemId, { ...line, qty: Math.min(line.qty, left), item: { ...line.item, stock: left } });
  return next;
}
