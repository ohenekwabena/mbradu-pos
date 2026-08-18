/**
 * Settings domain — the business-wide preferences that live on the single
 * `shop_settings` row (ADR-0005): one **low-stock threshold**, one
 * **expiry-warning window**, and one **drawer Float**, applied to every Shop
 * (not per-Shop, not per-Item). Currency is fixed to GH₵ in v1 (a DB CHECK),
 * so it isn't editable here.
 *
 * Deliberately free of any server/Supabase imports — like the Money, Catalog,
 * and Stock modules — so the Settings editor and the Server Action that writes
 * the row can share this pure validation. The threshold feeds
 * {@link "@/lib/stock".stockStatus} and the window feeds
 * {@link "@/lib/stock".isExpiringSoon}, which together drive the inventory
 * status chips and low-stock / expiring filters (MP-21). The Float (ADR-0007)
 * is the fixed cash left in every drawer overnight to make change; the
 * Day-close slice (MP-40) reconciles against it — expected drawer cash =
 * Float + the day's cash Payments.
 */

import { format, tryParse, type Pesewas } from "@/lib/money";

/** The expiry-warning windows the Settings select offers (in days). The stored
 * value can be any whole number in range; these are just the menu choices. */
export const EXPIRY_WINDOW_OPTIONS = [7, 14, 30, 60, 90] as const;

/** Upper bounds — generous, just to reject nonsense (a four-figure threshold or
 * a multi-year expiry window is almost certainly a typo). Mirrors the
 * `>= 0` CHECKs on `shop_settings`, adding a sane ceiling the DB doesn't. */
export const MAX_LOW_STOCK_THRESHOLD = 9_999;
export const MAX_EXPIRY_WINDOW_DAYS = 365;
/** A six-figure cedi drawer float is almost certainly a typo: GH₵ 100,000. */
export const MAX_FLOAT_PESEWAS: Pesewas = 10_000_000;

/** The validated, business-wide settings — integers, ready for the DB row. */
export interface Settings {
  /** Shop stock at or below this (and > 0) is flagged "low"; 0 is "out". */
  lowStockThreshold: number;
  /** Cosmetics expiring within this many days show "Expiring soon". */
  expiryWarningDays: number;
  /** The drawer Float (ADR-0007): fixed overnight change cash, in pesewas. */
  floatPesewas: Pesewas;
}

/** Raw settings input from the editor form (all strings). */
export interface SettingsInput {
  lowStockThreshold: string;
  expiryWarningDays: string;
  /** A human GH₵ amount ("250", "GH₵ 1,250.50") — parsed by the Money module. */
  floatAmount: string;
}

export type SettingsParseResult =
  | { ok: true; value: Settings }
  | { ok: false; error: string };

/**
 * Validate + normalize raw settings input into a {@link Settings}, or return the
 * first problem as a human message:
 *   - the low-stock threshold must be a whole number from 0 to
 *     {@link MAX_LOW_STOCK_THRESHOLD} (0 means only a true stock-out is flagged);
 *   - the expiry-warning window must be a whole number of days from 0 to
 *     {@link MAX_EXPIRY_WINDOW_DAYS};
 *   - the drawer float must be a GH₵ amount from 0 to
 *     {@link MAX_FLOAT_PESEWAS} (0 means the drawer starts empty), read via
 *     the Money module's {@link tryParse} so "GH₵ 250.00" and "250" both work.
 *
 * Pure (no I/O): the unit-tested core the Server Action wraps before the
 * Owner-only update to the single `shop_settings` row (re-gated by the
 * "Owner updates settings" RLS policy).
 */
export function parseSettingsInput(input: SettingsInput): SettingsParseResult {
  const lowStockThreshold = parseWholeUnits(input.lowStockThreshold);
  if (lowStockThreshold === null || lowStockThreshold > MAX_LOW_STOCK_THRESHOLD) {
    return {
      ok: false,
      error: `Enter a low-stock threshold from 0 to ${MAX_LOW_STOCK_THRESHOLD}.`,
    };
  }

  const expiryWarningDays = parseWholeUnits(input.expiryWarningDays);
  if (expiryWarningDays === null || expiryWarningDays > MAX_EXPIRY_WINDOW_DAYS) {
    return {
      ok: false,
      error: `Enter an expiry-warning window from 0 to ${MAX_EXPIRY_WINDOW_DAYS} days.`,
    };
  }

  const floatPesewas = tryParse(input.floatAmount);
  if (floatPesewas === null || floatPesewas < 0 || floatPesewas > MAX_FLOAT_PESEWAS) {
    return {
      ok: false,
      error: `Enter a drawer float from ${format(0)} to ${format(MAX_FLOAT_PESEWAS)}.`,
    };
  }

  return { ok: true, value: { lowStockThreshold, expiryWarningDays, floatPesewas } };
}

/**
 * Parse a whole, non-negative count from a form string ("30" → 30). Decimals,
 * signs, and anything non-numeric are rejected (`null`), as are values beyond
 * the safe-integer range. (Mirrors the Stock module's unit parser — a setting
 * is a count, not money.)
 */
function parseWholeUnits(raw: string): number | null {
  const cleaned = raw.trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}
