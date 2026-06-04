/**
 * Stock-ledger domain — the append-only ledger of Stock movements at the
 * *(Item, Shop)* grain and the pure logic over it: a Shop stock's current
 * quantity is the sum of its movements and never goes negative, plus the
 * construction and validation of an Owner **Restock** (units in).
 *
 * Deliberately free of any server/Supabase imports (like the Money and Catalog
 * modules) so the Server Action that records a Restock, a later inventory view,
 * and the unit tests can all share it. The real write is the Owner-gated, atomic
 * `record_restock` RPC (see `…_create_shop_stock_and_movements.sql`); this
 * module is its application-layer mirror — the denormalized `shop_stock.quantity`
 * the RPC maintains must always equal {@link quantityFromMovements} over that
 * *(Item, Shop)*'s movements (the ADR-0004 invariant, now per-Shop under
 * ADR-0005).
 *
 * MP-19 ships Restock and the quantity math; Corrections (MP-20) and the
 * per-Shop inventory list with status / low-stock (MP-21) build on it.
 */

/**
 * Why a Stock movement happened — mirrors the `stock_movements.reason` CHECK and
 * CONTEXT.md: a **Sale** (out), a **Restock** (in), or a **Correction** (a
 * manual fix, either direction).
 */
export const STOCK_REASONS = ["sale", "restock", "correction"] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

/**
 * A ledger entry's effect on quantity: a signed `amount` and its `reason`. The
 * database row carries more (ids, actor, note, timestamp), but a *(Item, Shop)*'s
 * quantity is a function of the amounts alone. Sign follows reason — restock
 * `> 0`, sale `< 0`, correction either way but never `0`.
 */
export interface Movement {
  reason: StockReason;
  amount: number;
}

/**
 * The raw signed sum of a *(Item, Shop)*'s movement amounts. For a ledger built
 * only through the RPCs this is already `≥ 0` — a Sale can't oversell and a
 * Correction can't drive stock negative — but {@link quantityFromMovements}
 * floors it regardless.
 */
export function sumMovements(movements: readonly Movement[]): number {
  let total = 0;
  for (const movement of movements) total += movement.amount;
  return total;
}

/**
 * A Shop stock's current quantity: the sum of its movements, floored at 0 so a
 * derived count is **never negative** (mirroring the `shop_stock.quantity >= 0`
 * CHECK). The floor is defence-in-depth — the write path keeps the true sum
 * non-negative, so for any real ledger this equals {@link sumMovements}.
 */
export function quantityFromMovements(movements: readonly Movement[]): number {
  return Math.max(0, sumMovements(movements));
}

/**
 * The ledger Movement an Owner Restock appends: reason `"restock"` with the
 * units received as a positive `amount` — the sign-matches-reason rule from the
 * `stock_movements_sign` CHECK, expressed in app code. Throws on a non-positive
 * or non-integer amount (you can't restock zero, a fraction, or a negative);
 * {@link parseRestockInput} is what turns untrusted form text into a safe value.
 */
export function buildRestockMovement(amount: number): Movement {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError(`restock amount must be a positive integer, got ${amount}`);
  }
  return { reason: "restock", amount };
}

/** Raw restock input from the modal form (all strings). */
export interface RestockInput {
  itemId: string;
  shopId: string;
  /** Whole units received — a positive integer. */
  amount: string;
  /** Optional free-text reason, e.g. "New supplier delivery". */
  note: string;
}

/** A validated Restock, ready for the `record_restock` RPC. */
export interface RestockWrite {
  itemId: string;
  shopId: string;
  /** Positive integer units to add. */
  amount: number;
  /** Trimmed note, or `null` when blank. */
  note: string | null;
}

export type RestockParseResult =
  | { ok: true; value: RestockWrite }
  | { ok: false; error: string };

/**
 * Validate + normalize raw restock input into a {@link RestockWrite}, or return
 * the first problem as a human message:
 *   - an Item and a Shop must both be chosen;
 *   - the quantity in must be a whole number greater than 0;
 *   - the note is optional (blank → `null`), trimmed.
 *
 * Pure (no I/O), so it's the unit-tested core the Server Action wraps before the
 * Owner-only `record_restock` RPC, which re-checks authorization and applies the
 * shop_stock + ledger write in one transaction.
 */
export function parseRestockInput(input: RestockInput): RestockParseResult {
  const itemId = input.itemId.trim();
  if (!itemId) return { ok: false, error: "Choose an item to restock." };

  const shopId = input.shopId.trim();
  if (!shopId) return { ok: false, error: "Choose a shop to restock." };

  const amount = parseWholeUnits(input.amount);
  if (amount === null || amount <= 0) {
    return { ok: false, error: "Enter how many units came in — a whole number above 0." };
  }

  const noteText = input.note.trim();
  const note = noteText === "" ? null : noteText;

  return { ok: true, value: { itemId, shopId, amount, note } };
}

/**
 * Parse a whole, non-negative unit count from a form string ("12" → 12). Stock
 * is counted in whole units, so — unlike Money — decimals, signs, and anything
 * non-numeric are rejected (`null`); values beyond the safe-integer range are
 * rejected too.
 */
function parseWholeUnits(raw: string): number | null {
  const cleaned = raw.trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}
