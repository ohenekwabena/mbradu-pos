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
 * MP-19 ships Restock and the quantity math; MP-20 adds Corrections (signed,
 * either-direction); the per-Shop inventory list with status / low-stock
 * (MP-21) builds on it.
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

/**
 * The ledger Movement an Owner Correction appends: reason `"correction"` with a
 * **signed** `amount` — positive to add (found/miscounted-up units), negative to
 * remove (damage, loss, miscounted-down). The `stock_movements_sign` CHECK only
 * requires a correction to be non-zero in either direction, so that's the rule
 * mirrored here. Throws on zero or a non-integer; {@link parseCorrectionInput}
 * turns untrusted form text into a safe value, and the `record_correction` RPC
 * is what guarantees the result can't drive a Shop's quantity below 0.
 */
export function buildCorrectionMovement(amount: number): Movement {
  if (!Number.isInteger(amount) || amount === 0) {
    throw new RangeError(`correction amount must be a non-zero integer, got ${amount}`);
  }
  return { reason: "correction", amount };
}

/** Raw correction input from the modal form (all strings). */
export interface CorrectionInput {
  itemId: string;
  shopId: string;
  /** Signed whole units — negative to reduce, e.g. "-2". */
  amount: string;
  /** Why the count is being fixed, e.g. "Damaged in storage" — required. */
  reason: string;
}

/** A validated Correction, ready for the `record_correction` RPC. */
export interface CorrectionWrite {
  itemId: string;
  shopId: string;
  /** Signed, non-zero integer — negative reduces the Shop's quantity. */
  amount: number;
  /** Trimmed, non-empty reason (a Correction must be justified). */
  reason: string;
}

export type CorrectionParseResult =
  | { ok: true; value: CorrectionWrite }
  | { ok: false; error: string };

/**
 * Validate + normalize raw correction input into a {@link CorrectionWrite}, or
 * return the first problem as a human message:
 *   - an Item and a Shop must both be chosen;
 *   - the amount must be a whole, non-zero number (negative reduces);
 *   - a reason is **required** — unlike a Restock note, a Correction must say
 *     why, since the append-only ledger is the only record of the adjustment.
 *
 * Pure (no I/O): the unit-tested core the Server Action wraps before the
 * Owner-only `record_correction` RPC, which re-checks authorization and refuses
 * both to drive the Shop's quantity below 0 and to touch an Item the Shop does
 * not carry.
 */
export function parseCorrectionInput(input: CorrectionInput): CorrectionParseResult {
  const itemId = input.itemId.trim();
  if (!itemId) return { ok: false, error: "Choose an item to correct." };

  const shopId = input.shopId.trim();
  if (!shopId) return { ok: false, error: "Choose a shop to correct." };

  const amount = parseSignedUnits(input.amount);
  if (amount === null) {
    return { ok: false, error: "Enter the correction as a whole number of units — negative to reduce." };
  }
  if (amount === 0) {
    return { ok: false, error: "A correction can’t be zero — add or remove at least one unit." };
  }

  const reason = input.reason.trim();
  if (reason === "") return { ok: false, error: "Add a reason for the correction." };

  return { ok: true, value: { itemId, shopId, amount, reason } };
}

/**
 * Parse a whole, possibly-negative unit count from a form string ("-2" → -2).
 * Like {@link parseWholeUnits} but allows a leading sign, since a Correction can
 * go either way; fractions and anything non-numeric are rejected (`null`), as
 * are values beyond the safe-integer range. Zero parses to 0 — the non-zero
 * rule is enforced by the callers, not here.
 */
function parseSignedUnits(raw: string): number | null {
  const cleaned = raw.trim();
  if (!/^[+-]?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

// ===========================================================================
// Stock health (MP-21) — the pure status logic the per-Shop inventory list,
// the Item-detail stock cards, and (later) the dashboards share. Driven by the
// single business-wide `shop_settings` row (one low-stock threshold, one expiry
// window — ADR-0005), not per-Shop or per-Item.
// ===========================================================================

/**
 * The stock-health of one **carried** Shop stock, from its quantity and the
 * business-wide low-stock threshold (`shop_settings.low_stock_threshold`):
 *   - `"out"` — carried but nothing on hand (quantity 0);
 *   - `"low"` — at or below the threshold (and above 0);
 *   - `"in"`  — above the threshold.
 *
 * Only meaningful where the Shop **carries** the Item (a `shop_stock` row
 * exists). "Out of stock" (carried, 0) is deliberately distinct from "not
 * carried" (no row) — the caller represents the latter separately (CONTEXT.md).
 */
export type StockStatus = "out" | "low" | "in";

/** Classify a carried Shop stock's {@link StockStatus} against the threshold.
 * A `<= 0` quantity is "out"; `<= threshold` is "low"; anything more is "in". */
export function stockStatus(quantity: number, lowStockThreshold: number): StockStatus {
  if (quantity <= 0) return "out";
  if (quantity <= lowStockThreshold) return "low";
  return "in";
}

/** Whole-day milliseconds — the unit the expiry window counts in. */
const MS_PER_DAY = 86_400_000;

/**
 * Whether a cosmetic's `expiry` falls within the business-wide warning window —
 * i.e. the expiry date is on or before `today + windowDays`. **Already-past**
 * dates count too: there's no separate "expired" state in v1, and an expired
 * Item still needs the Owner's attention. Items without an expiry (wigs, wig
 * tools, or a cosmetic missing the field) are never flagged.
 *
 * Pure and deterministic: `today` is passed in as an ISO `YYYY-MM-DD` string
 * (the caller stamps it server-side) rather than read from the clock here, so
 * the rule is unit-testable and free of timezone drift — the business runs in
 * Ghana (GMT/UTC). A missing or malformed date is treated as "not expiring".
 */
export function isExpiringSoon(
  expiry: string | null | undefined,
  today: string,
  windowDays: number,
): boolean {
  if (!expiry) return false;
  const expiryMs = isoDateToUtcMs(expiry);
  const todayMs = isoDateToUtcMs(today);
  if (expiryMs === null || todayMs === null) return false;
  return expiryMs <= todayMs + windowDays * MS_PER_DAY;
}

/**
 * Parse a strict `YYYY-MM-DD` string to its UTC-midnight epoch ms, or `null`
 * when it isn't a real calendar date (malformed, or an impossible day like
 * `2026-02-30`). Built from explicit components — no `Date` *string* parsing —
 * so it's deterministic across engines and timezones.
 *
 * (Mirrors `isValidISODate` in the Catalog module; duplicated rather than
 * imported to keep this Stock module dependency-free, as its header intends.)
 */
function isoDateToUtcMs(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}
