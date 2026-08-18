/**
 * Day-close domain (ADR-0007) — the pure logic of ending a selling day: the
 * validation of the blind drawer declaration, the Ghana-calendar-day boundary
 * math, the expected-drawer formula, the Over/short arithmetic, and the stale
 * rule. Deliberately free of any server/Supabase imports (like the Money,
 * Sale, and Stock-take modules) so the close screen's Server Action, the
 * Owner surfaces (MP-41), and the unit tests all share one tested core.
 *
 * The real write is the SECURITY DEFINER `record_day_close` RPC
 * (`…_create_day_closes.sql`), which recomputes everything here server-side —
 * expected drawer cash = the business-wide **Float** + that day's cash
 * Payments at the Shop (cash only: MoMo/Card/Bank reconcile against provider
 * statements outside the app), Over/short = declared − expected, and the
 * stale flag — from data the declarer never sees. **Entry is blind**: no
 * expected figure ever reaches the close screen, and the declarer gets a
 * success response, not a readback; Over/short is Owner-only money.
 *
 * The stale rule: a missed day stays closable until the Shop's **next Sale**
 * rings — after that the drawer no longer represents that day, so a late
 * declaration is still recorded but marked stale (never trusted), mirroring
 * the Stock take's stale-line rule. A missing close never blocks selling.
 */

import { add, format, subtract, tryParse, type Pesewas } from "./money";

/** A seven-figure cedi drawer is almost certainly a typo: GH₵ 1,000,000.
 * (Generous — a big day at the Float ceiling still sits far below it.) */
export const MAX_DECLARED_PESEWAS: Pesewas = 100_000_000;

/** Raw close-form input (all strings, plus the server-stamped `today`). */
export interface DayCloseInput {
  /** The counted drawer as a human GH₵ amount ("250", "GH₵ 1,250.50"). */
  amount: string;
  /** Optional note ("two torn notes", "float short from Monday"). */
  note: string;
  /** The day being closed, `YYYY-MM-DD` (today, or a missed earlier day). */
  closeDate: string;
  /** Today as a UTC `YYYY-MM-DD`, stamped server-side (the business runs in
   * Ghana / GMT, so the UTC calendar day is the local one). */
  today: string;
}

/** A validated declaration, ready for the `record_day_close` RPC. */
export interface DayCloseDeclaration {
  closeDate: string;
  declaredPesewas: Pesewas;
  /** Trimmed optional note, `null` when blank. */
  note: string | null;
}

export type DayCloseParseResult =
  | { ok: true; value: DayCloseDeclaration }
  | { ok: false; error: string };

/**
 * Validate + normalize the blind declaration:
 *   - the close date must be a real `YYYY-MM-DD` calendar day, no later than
 *     `today` (a future day hasn't been sold yet — nothing to count);
 *   - the counted drawer must be a GH₵ amount from 0 to
 *     {@link MAX_DECLARED_PESEWAS}, read via the Money module's
 *     {@link tryParse} (zero is a real count — an emptied drawer);
 *   - the note is trimmed, blank → `null`.
 * The RPC re-checks the date and amount server-side; this is the early,
 * human-message reject.
 */
export function parseDayCloseInput(input: DayCloseInput): DayCloseParseResult {
  const closeDate = input.closeDate.trim();
  if (!isDateKey(closeDate)) {
    return { ok: false, error: "Pick the day you are closing." };
  }
  if (closeDate > input.today) {
    return { ok: false, error: "You can’t close a day that hasn’t ended — pick today or an earlier day." };
  }

  const declaredPesewas = tryParse(input.amount);
  if (declaredPesewas === null || declaredPesewas < 0 || declaredPesewas > MAX_DECLARED_PESEWAS) {
    return {
      ok: false,
      error: `Enter the counted drawer as an amount from ${format(0)} to ${format(MAX_DECLARED_PESEWAS)}.`,
    };
  }

  const noteText = input.note.trim();
  return {
    ok: true,
    value: { closeDate, declaredPesewas, note: noteText === "" ? null : noteText },
  };
}

/** The half-open instant bounds of one business day. */
export interface DayBounds {
  /** Inclusive lower bound — UTC midnight of the day. */
  startIso: string;
  /** **Exclusive** upper bound — UTC midnight of the next day. */
  endIso: string;
}

/**
 * The `[start, end)` instant bounds of a `YYYY-MM-DD` business day. The
 * business runs in Ghana (GMT year-round), so the UTC calendar day *is* the
 * local selling day — the same boundary the RPC uses to sum the day's cash
 * Payments and to judge staleness. Pure UTC math, no clock read.
 */
export function dayBoundsUtc(dateKey: string): DayBounds {
  const [y, m, d] = dateKey.split("-").map(Number);
  const startMs = Date.UTC(y, m - 1, d);
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(startMs + MS_PER_DAY).toISOString() };
}

/**
 * Expected drawer cash at close: the business-wide Float (the fixed overnight
 * change cash, ADR-0007) plus the day's recorded **cash** Payments at the
 * Shop. Assumes cash leaves the drawer only at close — mid-day cash removal
 * is a documented operational don't (it would fabricate a shortage).
 */
export function expectedDrawerPesewas(
  floatPesewas: Pesewas,
  cashPaymentsPesewas: Pesewas,
): Pesewas {
  return add(floatPesewas, cashPaymentsPesewas);
}

/**
 * Over/short: declared − expected, signed — positive is an overage, negative
 * a shortage, zero balanced. Owner-only money (the theft signal ADR-0007
 * exists for); the declarer never sees it.
 */
export function overShortPesewas(declaredPesewas: Pesewas, expectedPesewas: Pesewas): Pesewas {
  return subtract(declaredPesewas, expectedPesewas);
}

/**
 * The stale rule, mirrored from the `record_day_close` RPC: a declaration for
 * `closeDate` is stale iff any Sale at the Shop rang **at or after the end of
 * that day** — the drawer has since taken new money, so the count can no
 * longer be verified against that day. Sales *during* the day never stale a
 * close (closing tonight while today's Sales stand is the normal ritual);
 * an unparseable timestamp is ignored rather than trusted either way.
 */
export function isStaleClose(closeDate: string, saleTimes: readonly string[]): boolean {
  const endMs = Date.parse(dayBoundsUtc(closeDate).endIso);
  return saleTimes.some((time) => {
    const ms = Date.parse(time);
    return Number.isFinite(ms) && ms >= endMs;
  });
}

const MS_PER_DAY = 86_400_000;

/** Whether a value is a real `YYYY-MM-DD` calendar date (round-trips through
 * UTC — rejects "2026-13-40"). Mirrors the dashboard's private guard. */
function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(ms)) return false;
  const date = new Date(ms);
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}
