import { describe, it, expect } from "vitest";

import {
  checkSubmittable,
  lineResolution,
  parseCountedInput,
  parseScopeInput,
  STOCK_TAKE_STATUSES,
  takeProgress,
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
