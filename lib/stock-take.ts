/**
 * Stock-take domain (ADR-0006) — the pure logic of a blind counting session:
 * what state a line is in, how far a session has progressed, when it may be
 * submitted, and the validation of untrusted count / scope input.
 *
 * Deliberately free of any server/Supabase imports (like the Stock and Catalog
 * modules) so the Server Actions, the count screen, and the unit tests all
 * share it. The real writes are the SECURITY DEFINER stock-take RPCs
 * (`…_create_stock_takes.sql`): start creates the session and its pending
 * lines, counting a line snapshots `expected_qty` server-side *at that moment*
 * (the Variance basis — never shown to the counter; entry is blind), and
 * submission changes no stock — posting happens only at Owner approval (MP-37)
 * under the `stock_take` ledger reason (MP-34).
 */

/** Session lifecycle — mirrors the `stock_takes.status` CHECK. `approved` is
 * written by the Owner-review slice (MP-37); the rest by MP-35's RPCs. */
export const STOCK_TAKE_STATUSES = ["open", "submitted", "approved", "cancelled"] as const;
export type StockTakeStatus = (typeof STOCK_TAKE_STATUSES)[number];

/**
 * One line's counting state, as far as the pure logic cares. The database row
 * carries more (ids, the Owner-only `expected_qty` snapshot, timestamps); the
 * session's progress and submittability are a function of these two fields.
 */
export interface TakeLineState {
  /** Whole units physically counted, or `null` while pending / skipped. */
  countedQty: number | null;
  /** Explicitly skipped — "not counted" as a recorded decision, not an omission. */
  skipped: boolean;
}

/** What has happened to a line: still `pending`, `counted`, or `skipped`. */
export type LineResolution = "pending" | "counted" | "skipped";

/** Classify one line. A counted quantity wins over a stale skipped flag —
 * the RPC clears `skipped` on a recount, so both set is a non-state. */
export function lineResolution(line: TakeLineState): LineResolution {
  if (line.countedQty !== null) return "counted";
  if (line.skipped) return "skipped";
  return "pending";
}

/** A session's progress: every line is exactly one of counted / skipped /
 * pending, so `counted + skipped + pending === total`. */
export interface TakeProgress {
  total: number;
  counted: number;
  skipped: number;
  pending: number;
}

/** Tally a session's lines by {@link lineResolution}. */
export function takeProgress(lines: readonly TakeLineState[]): TakeProgress {
  const progress: TakeProgress = { total: lines.length, counted: 0, skipped: 0, pending: 0 };
  for (const line of lines) progress[lineResolution(line)]++;
  return progress;
}

export type SubmitCheck = { ok: true } | { ok: false; reason: string };

/**
 * May this session be submitted? Every line must be counted or explicitly
 * skipped (an unresolved line is an unanswered question, not a zero), and at
 * least one line must actually be *counted* — an all-skipped session records
 * nothing and would only clutter the Owner's review queue. Mirrors the
 * `submit_stock_take` RPC, which re-checks both against live data.
 */
export function checkSubmittable(lines: readonly TakeLineState[]): SubmitCheck {
  const progress = takeProgress(lines);
  if (progress.pending > 0) {
    const noun = progress.pending === 1 ? "line still needs" : "lines still need";
    return { ok: false, reason: `${progress.pending} ${noun} a count or a skip.` };
  }
  if (progress.counted === 0) {
    return { ok: false, reason: "Count at least one item before submitting." };
  }
  return { ok: true };
}

export type CountParseResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Parse a counted quantity from form text: a whole number of units, **zero
 * allowed** — finding none on the shelf is a real count (and, against a
 * non-zero expectation, exactly the shrinkage signal a Stock take exists to
 * catch). Signs, fractions, and anything non-numeric are rejected, as are
 * values beyond the safe-integer range.
 */
export function parseCountedInput(raw: string): CountParseResult {
  const cleaned = raw.trim();
  if (!/^\d+$/.test(cleaned)) {
    return { ok: false, error: "Enter the counted units as a whole number (0 or more)." };
  }
  const value = Number(cleaned);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, error: "Enter the counted units as a whole number (0 or more)." };
  }
  return { ok: true, value };
}

/** Raw scope-picker input: count everything, or a chosen subset of item ids. */
export interface ScopeInput {
  /** `"all"` (the default) or `"subset"` for a targeted spot-count. */
  mode: string;
  /** The chosen item ids — only meaningful in `subset` mode. */
  selectedIds: readonly string[];
}

export type ScopeParseResult =
  | { ok: true; value: { itemIds: string[] | null } }
  | { ok: false; error: string };

/**
 * Validate + normalize the scope choice for `start_stock_take`: `all` maps to
 * `itemIds: null` (the RPC scopes to every carried, non-archived Item —
 * resolved server-side, never trusted from the client); `subset` requires at
 * least one id (trimmed, de-duplicated). The RPC re-checks that every chosen
 * Item is actually carried at the Shop.
 */
export function parseScopeInput(input: ScopeInput): ScopeParseResult {
  if (input.mode === "all") return { ok: true, value: { itemIds: null } };
  if (input.mode !== "subset") {
    return { ok: false, error: "Choose what to count — everything, or a set of items." };
  }

  const ids = [...new Set(input.selectedIds.map((id) => id.trim()).filter((id) => id !== ""))];
  if (ids.length === 0) {
    return { ok: false, error: "Pick at least one item to count." };
  }
  return { ok: true, value: { itemIds: ids } };
}

// ===========================================================================
// Owner review & approval (MP-37) — the pure logic of settling a submitted
// take: what each line's Variance is, which lines can post (vs stale /
// verified / skipped), and the validation of the Owner's classifications
// before they reach the `approve_stock_take` RPC (which re-derives staleness
// and re-requires a classification per postable Variance, under row locks).
// ===========================================================================

/** How the Owner explains a non-zero Variance at approval — mirrors the
 * `stock_take_lines.variance_reason` CHECK. `unexplained` is the theft
 * signal: it's what the Shrinkage figure (MP-39) sums, valued at cost. */
export const VARIANCE_REASONS = ["damaged", "expired", "other", "unexplained"] as const;
export type VarianceReason = (typeof VARIANCE_REASONS)[number];

/** Display names for the classification picker and the ledger note. */
export const VARIANCE_REASON_LABEL: Record<VarianceReason, string> = {
  damaged: "Damaged",
  expired: "Expired",
  other: "Other (explained)",
  unexplained: "Unexplained",
};

/**
 * One line of a submitted take as the review screen sees it. `expectedQty` is
 * the Owner-only snapshot (non-null exactly when counted); `stale` is derived
 * *server-side at render time* — any ledger movement on the line's *(Item,
 * Shop)* after its snapshot, or a current quantity that no longer matches it.
 */
export interface ReviewLine extends TakeLineState {
  /** The ledger quantity snapshotted when the line was counted (Owner-only). */
  expectedQty: number | null;
  /** The *(Item, Shop)* moved after the snapshot — excluded from posting. */
  stale: boolean;
}

/**
 * What approval will do with a line:
 *   - `skipped` — never counted; nothing to review;
 *   - `stale` — counted, but invalidated by a later movement: never posted,
 *     listed for a recount (false shrinkage is the worst failure mode);
 *   - `verified` — counted dead-on (Variance 0): posts nothing, stands as a
 *     "verified correct" record;
 *   - `variance` — a non-zero, postable Variance the Owner must classify.
 */
export type ReviewOutcome = "skipped" | "stale" | "verified" | "variance";

/** Classify one review line. Staleness beats the Variance — a stale number
 * isn't evidence either way. */
export function reviewOutcome(line: ReviewLine): ReviewOutcome {
  if (line.countedQty === null) return "skipped";
  if (line.stale) return "stale";
  return lineVariance(line) === 0 ? "verified" : "variance";
}

/** A counted line's Variance (counted − expected snapshot), or `null` while
 * there's nothing to compare (skipped, or the Owner-only snapshot withheld). */
export function lineVariance(line: ReviewLine): number | null {
  if (line.countedQty === null || line.expectedQty === null) return null;
  return line.countedQty - line.expectedQty;
}

/** Per-outcome tallies for a take's review header and approve confirmation. */
export interface ReviewSummary {
  total: number;
  skipped: number;
  stale: number;
  verified: number;
  variance: number;
}

/** Tally a submitted take's lines by {@link reviewOutcome}. */
export function reviewSummary(lines: readonly ReviewLine[]): ReviewSummary {
  const summary: ReviewSummary = { total: lines.length, skipped: 0, stale: 0, verified: 0, variance: 0 };
  for (const line of lines) summary[reviewOutcome(line)]++;
  return summary;
}

/** One raw classification row from the review form (all strings). */
export interface ClassificationInput {
  lineId: string;
  reason: string;
  note: string;
}

/** A validated classification, ready for `approve_stock_take`. */
export interface Classification {
  lineId: string;
  reason: VarianceReason;
  /** Trimmed optional note, `null` when blank. */
  note: string | null;
}

export type ClassificationsParseResult =
  | { ok: true; value: Classification[] }
  | { ok: false; error: string };

function isVarianceReason(value: string): value is VarianceReason {
  return (VARIANCE_REASONS as readonly string[]).includes(value);
}

/**
 * Validate + normalize the Owner's classification rows: every row needs a line
 * id and a reason from {@link VARIANCE_REASONS} (fail closed on anything
 * else), notes are trimmed (blank → `null`), and a duplicated line id is
 * rejected rather than silently last-write-wins. *Which* lines require a
 * classification is not decided here — the `approve_stock_take` RPC re-derives
 * the postable set under row locks and refuses to approve any uncovered
 * Variance, so a stale-since-render line simply has its row ignored.
 */
export function parseClassifications(
  rows: readonly ClassificationInput[],
): ClassificationsParseResult {
  const seen = new Set<string>();
  const value: Classification[] = [];
  for (const row of rows) {
    const lineId = row.lineId.trim();
    if (!lineId) return { ok: false, error: "A classification is missing its line — reload and try again." };
    if (seen.has(lineId)) {
      return { ok: false, error: "A line was classified twice — reload and try again." };
    }
    seen.add(lineId);

    if (!isVarianceReason(row.reason)) {
      return { ok: false, error: "Classify every difference before approving." };
    }

    const noteText = row.note.trim();
    value.push({ lineId, reason: row.reason, note: noteText === "" ? null : noteText });
  }
  return { ok: true, value };
}
