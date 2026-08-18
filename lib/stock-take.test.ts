import { describe, it, expect } from "vitest";

import {
  checkSubmittable,
  lineResolution,
  lineVariance,
  parseClassifications,
  parseCountedInput,
  parseScopeInput,
  reviewOutcome,
  reviewSummary,
  STOCK_TAKE_STATUSES,
  takeProgress,
  VARIANCE_REASONS,
  type ReviewLine,
  type TakeLineState,
} from "./stock-take";

const pending: TakeLineState = { countedQty: null, skipped: false };
const skipped: TakeLineState = { countedQty: null, skipped: true };
const counted = (qty: number): TakeLineState => ({ countedQty: qty, skipped: false });

describe("STOCK_TAKE_STATUSES", () => {
  it("mirrors the stock_takes.status CHECK (open / submitted / approved / cancelled)", () => {
    expect(STOCK_TAKE_STATUSES).toEqual(["open", "submitted", "approved", "cancelled"]);
  });
});

describe("lineResolution", () => {
  it("classifies pending, counted, and skipped lines", () => {
    expect(lineResolution(pending)).toBe("pending");
    expect(lineResolution(counted(4))).toBe("counted");
    expect(lineResolution(skipped)).toBe("skipped");
  });

  it("treats a count of zero as counted — none on the shelf is a real count", () => {
    expect(lineResolution(counted(0))).toBe("counted");
  });

  it("lets a counted quantity win over a stale skipped flag", () => {
    expect(lineResolution({ countedQty: 2, skipped: true })).toBe("counted");
  });
});

describe("takeProgress", () => {
  it("tallies lines so counted + skipped + pending equals total", () => {
    const lines = [counted(3), counted(0), skipped, pending, pending];
    expect(takeProgress(lines)).toEqual({
      total: 5,
      counted: 2,
      skipped: 1,
      pending: 2,
    });
  });

  it("is all zeros for an empty session", () => {
    expect(takeProgress([])).toEqual({ total: 0, counted: 0, skipped: 0, pending: 0 });
  });
});

describe("checkSubmittable", () => {
  it("allows a session where every line is counted or skipped", () => {
    expect(checkSubmittable([counted(3), skipped, counted(0)])).toEqual({ ok: true });
  });

  it("refuses while any line is still pending, naming how many", () => {
    const result = checkSubmittable([counted(3), pending, pending]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("2");
  });

  it("refuses an all-skipped session — at least one line must be counted", () => {
    const result = checkSubmittable([skipped, skipped]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/at least one/i);
  });

  it("refuses an empty session", () => {
    expect(checkSubmittable([]).ok).toBe(false);
  });
});

describe("parseCountedInput", () => {
  it("accepts whole unit counts, including zero", () => {
    expect(parseCountedInput("12")).toEqual({ ok: true, value: 12 });
    expect(parseCountedInput(" 0 ")).toEqual({ ok: true, value: 0 });
  });

  it("rejects signs, fractions, blanks, and non-numbers", () => {
    for (const raw of ["-1", "+3", "2.5", "", "  ", "abc", "3 units"]) {
      expect(parseCountedInput(raw).ok).toBe(false);
    }
  });

  it("rejects values beyond the safe-integer range", () => {
    expect(parseCountedInput("9007199254740993").ok).toBe(false);
  });
});

describe("parseScopeInput", () => {
  it("maps 'all' to a null item set (the RPC resolves the carried Items)", () => {
    expect(parseScopeInput({ mode: "all", selectedIds: [] })).toEqual({
      ok: true,
      value: { itemIds: null },
    });
    // In "all" mode any stray selection is irrelevant and ignored.
    expect(parseScopeInput({ mode: "all", selectedIds: ["item-1"] })).toEqual({
      ok: true,
      value: { itemIds: null },
    });
  });

  it("passes a subset through trimmed and de-duplicated", () => {
    expect(
      parseScopeInput({ mode: "subset", selectedIds: [" item-1", "item-2", "item-1", ""] }),
    ).toEqual({ ok: true, value: { itemIds: ["item-1", "item-2"] } });
  });

  it("refuses an empty subset", () => {
    expect(parseScopeInput({ mode: "subset", selectedIds: [] }).ok).toBe(false);
    expect(parseScopeInput({ mode: "subset", selectedIds: ["  ", ""] }).ok).toBe(false);
  });

  it("refuses an unknown mode (fail closed)", () => {
    expect(parseScopeInput({ mode: "everything", selectedIds: [] }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Owner review & approval (MP-37)
// ---------------------------------------------------------------------------

/** A review line: counted against an expected snapshot, optionally stale. */
const reviewed = (expected: number, counted: number, stale = false): ReviewLine => ({
  expectedQty: expected,
  countedQty: counted,
  skipped: false,
  stale,
});
const skippedLine: ReviewLine = { expectedQty: null, countedQty: null, skipped: true, stale: false };

describe("VARIANCE_REASONS", () => {
  it("mirrors the stock_take_lines.variance_reason CHECK", () => {
    expect(VARIANCE_REASONS).toEqual(["damaged", "expired", "other", "unexplained"]);
  });
});

describe("lineVariance", () => {
  it("is counted minus the expected snapshot, either sign", () => {
    expect(lineVariance(reviewed(5, 3))).toBe(-2); // shrinkage
    expect(lineVariance(reviewed(5, 7))).toBe(2); // surplus
    expect(lineVariance(reviewed(5, 5))).toBe(0);
  });

  it("is null when there is nothing to compare (skipped, or snapshot withheld)", () => {
    expect(lineVariance(skippedLine)).toBeNull();
    expect(lineVariance({ expectedQty: null, countedQty: 4, skipped: false, stale: false })).toBeNull();
  });
});

describe("reviewOutcome", () => {
  it("classifies skipped, verified, and postable-variance lines", () => {
    expect(reviewOutcome(skippedLine)).toBe("skipped");
    expect(reviewOutcome(reviewed(5, 5))).toBe("verified");
    expect(reviewOutcome(reviewed(5, 3))).toBe("variance");
    expect(reviewOutcome(reviewed(0, 2))).toBe("variance");
  });

  it("lets staleness beat the variance — a stale number is not evidence", () => {
    expect(reviewOutcome(reviewed(5, 3, true))).toBe("stale");
    // even a dead-on stale count is listed for recount, not claimed verified
    expect(reviewOutcome(reviewed(5, 5, true))).toBe("stale");
  });
});

describe("reviewSummary", () => {
  it("tallies lines so every outcome sums back to the total", () => {
    const lines = [
      reviewed(5, 3), // variance
      reviewed(2, 2), // verified
      reviewed(9, 1, true), // stale
      skippedLine,
      reviewed(0, 0), // verified
    ];
    expect(reviewSummary(lines)).toEqual({
      total: 5,
      skipped: 1,
      stale: 1,
      verified: 2,
      variance: 1,
    });
  });

  it("is all zeros for no lines", () => {
    expect(reviewSummary([])).toEqual({ total: 0, skipped: 0, stale: 0, verified: 0, variance: 0 });
  });
});

describe("parseClassifications", () => {
  it("passes valid rows through with notes trimmed (blank → null)", () => {
    expect(
      parseClassifications([
        { lineId: " line-1 ", reason: "damaged", note: " crushed box " },
        { lineId: "line-2", reason: "unexplained", note: "   " },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { lineId: "line-1", reason: "damaged", note: "crushed box" },
        { lineId: "line-2", reason: "unexplained", note: null },
      ],
    });
  });

  it("accepts an empty set — a take can be all verified / stale / skipped", () => {
    expect(parseClassifications([])).toEqual({ ok: true, value: [] });
  });

  it("fails closed on a reason outside the classification set", () => {
    for (const reason of ["", "stolen", "OTHER", "damaged "]) {
      expect(parseClassifications([{ lineId: "line-1", reason, note: "" }]).ok).toBe(false);
    }
  });

  it("rejects a missing line id and a duplicated one", () => {
    expect(parseClassifications([{ lineId: "  ", reason: "damaged", note: "" }]).ok).toBe(false);
    expect(
      parseClassifications([
        { lineId: "line-1", reason: "damaged", note: "" },
        { lineId: "line-1", reason: "expired", note: "" },
      ]).ok,
    ).toBe(false);
  });
});
