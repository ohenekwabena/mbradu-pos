import { describe, it, expect } from "vitest";

import {
  buildUnclosedFlags,
  dayBoundsUtc,
  expectedDrawerPesewas,
  isStaleClose,
  MAX_DECLARED_PESEWAS,
  overShortKind,
  overShortPesewas,
  parseDayCloseInput,
  unclosedLookbackStart,
  type UnclosedFlagsInput,
} from "./day-close";

const TODAY = "2026-06-05";

/** A valid baseline declaration; tests override one field at a time. */
function input(overrides: Partial<Parameters<typeof parseDayCloseInput>[0]> = {}) {
  return { amount: "1,250.50", note: "", closeDate: TODAY, today: TODAY, ...overrides };
}

describe("parseDayCloseInput — the blind declaration", () => {
  it("parses a GH₵ amount via the Money module, with date and trimmed note", () => {
    const result = parseDayCloseInput(input({ amount: "GH₵ 1,250.50", note: "  two torn notes  " }));
    expect(result).toEqual({
      ok: true,
      value: { closeDate: TODAY, declaredPesewas: 125050, note: "two torn notes" },
    });
  });

  it("accepts zero — an emptied drawer is a real count", () => {
    const result = parseDayCloseInput(input({ amount: "0" }));
    expect(result).toEqual({
      ok: true,
      value: { closeDate: TODAY, declaredPesewas: 0, note: null },
    });
  });

  it("accepts a past day (a missed close stays declarable)", () => {
    const result = parseDayCloseInput(input({ closeDate: "2026-06-01" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.closeDate).toBe("2026-06-01");
  });

  it("rejects a future day", () => {
    const result = parseDayCloseInput(input({ closeDate: "2026-06-06" }));
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/hasn’t ended/) });
  });

  it("rejects a malformed or impossible date", () => {
    for (const closeDate of ["", "05/06/2026", "2026-13-01", "2026-02-30", "yesterday"]) {
      expect(parseDayCloseInput(input({ closeDate })).ok).toBe(false);
    }
  });

  it("rejects a negative, unparseable, or absurd amount", () => {
    for (const amount of ["-5", "abc", "", "12.3.4", String(MAX_DECLARED_PESEWAS / 100 + 1)]) {
      const result = parseDayCloseInput(input({ amount }));
      expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/amount from/) });
    }
  });

  it("nulls a blank note", () => {
    const result = parseDayCloseInput(input({ note: "   " }));
    expect(result.ok && result.value.note).toBeNull();
  });
});

describe("dayBoundsUtc — the Ghana business day", () => {
  it("bounds a day as [UTC midnight, next UTC midnight)", () => {
    expect(dayBoundsUtc("2026-06-05")).toEqual({
      startIso: "2026-06-05T00:00:00.000Z",
      endIso: "2026-06-06T00:00:00.000Z",
    });
  });

  it("rolls month and year ends correctly", () => {
    expect(dayBoundsUtc("2026-06-30").endIso).toBe("2026-07-01T00:00:00.000Z");
    expect(dayBoundsUtc("2026-12-31").endIso).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("expected drawer & Over/short arithmetic", () => {
  it("expected = Float + the day's cash payments", () => {
    expect(expectedDrawerPesewas(20000, 64500)).toBe(84500);
    expect(expectedDrawerPesewas(0, 0)).toBe(0);
  });

  it("Over/short is signed: positive over, negative short, zero balanced", () => {
    expect(overShortPesewas(85000, 84500)).toBe(500); // over
    expect(overShortPesewas(80000, 84500)).toBe(-4500); // short
    expect(overShortPesewas(84500, 84500)).toBe(0); // balanced
  });
});

describe("isStaleClose — the next-Sale rule", () => {
  const CLOSE = "2026-06-04";

  it("is fresh with no sales, or with sales only during/before the day", () => {
    expect(isStaleClose(CLOSE, [])).toBe(false);
    expect(
      isStaleClose(CLOSE, [
        "2026-06-04T09:00:00Z", // during the day being closed
        "2026-06-04T23:59:59.999Z", // right up to the boundary
        "2026-06-03T12:00:00Z", // an earlier day
      ]),
    ).toBe(false);
  });

  it("goes stale the moment a sale rings at or after the day's end", () => {
    expect(isStaleClose(CLOSE, ["2026-06-05T00:00:00Z"])).toBe(true); // the boundary itself
    expect(isStaleClose(CLOSE, ["2026-06-04T10:00:00Z", "2026-06-05T08:30:00Z"])).toBe(true);
  });

  it("closing today is never stale (no sale can ring after a day still running)", () => {
    expect(isStaleClose(TODAY, ["2026-06-05T18:45:00Z"])).toBe(false);
  });

  it("ignores an unparseable timestamp rather than trusting it either way", () => {
    expect(isStaleClose(CLOSE, ["not-a-time"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Owner surfaces (MP-41).
// ---------------------------------------------------------------------------

describe("overShortKind — which way a close leans", () => {
  it("negative is short, positive over, zero balanced", () => {
    expect(overShortKind(-4500)).toBe("short");
    expect(overShortKind(500)).toBe("over");
    expect(overShortKind(0)).toBe("balanced");
  });
});

describe("unclosedLookbackStart", () => {
  it("counts back the lookback from today, crossing month and year ends", () => {
    expect(unclosedLookbackStart("2026-06-05")).toBe("2026-05-22"); // default 14 days
    expect(unclosedLookbackStart("2026-01-05")).toBe("2025-12-22");
    expect(unclosedLookbackStart("2026-06-05", 7)).toBe("2026-05-29");
  });
});

describe("buildUnclosedFlags — the stopped-closing pattern", () => {
  // today = 2026-06-05 → the lookback is [2026-05-22 .. 2026-06-04] (ended days).
  const SHOPS = [
    { id: "osu", name: "Osu" },
    { id: "accra", name: "Accra Mall" },
  ];

  /** A sale instant on `day` at the shop (the time of day is irrelevant). */
  const sale = (shopId: string, day: string) => ({ shopId, createdAt: `${day}T10:00:00Z` });
  const closed = (shopId: string, closeDate: string) => ({ shopId, closeDate });

  function flags(overrides: Partial<UnclosedFlagsInput> = {}) {
    return buildUnclosedFlags({
      shops: SHOPS,
      saleTimes: [],
      closedDays: [],
      today: TODAY,
      ...overrides,
    });
  }

  it("flags an ended selling day with no close", () => {
    expect(flags({ saleTimes: [sale("osu", "2026-06-04")] })).toEqual([
      {
        shopId: "osu",
        shopName: "Osu",
        unclosedDays: ["2026-06-04"],
        streak: 1,
        latestLabel: "Yesterday",
      },
    ]);
  });

  it("a closed selling day is not flagged", () => {
    expect(
      flags({
        saleTimes: [sale("osu", "2026-06-04")],
        closedDays: [closed("osu", "2026-06-04")],
      }),
    ).toEqual([]);
  });

  it("a day with no Sales and no close is not flagged — nothing to close", () => {
    // Osu closed its one selling day; every other lookback day is silent.
    expect(
      flags({
        saleTimes: [sale("osu", "2026-06-01")],
        closedDays: [closed("osu", "2026-06-01")],
      }),
    ).toEqual([]);
  });

  it("today is never flagged — the day hasn't ended", () => {
    expect(flags({ saleTimes: [sale("osu", TODAY)] })).toEqual([]);
  });

  it("streak counts consecutive unclosed selling days, stopping at the first closed one", () => {
    const result = flags({
      saleTimes: [
        sale("osu", "2026-06-04"),
        sale("osu", "2026-06-03"),
        sale("osu", "2026-06-02"),
        sale("osu", "2026-06-01"), // closed — breaks the run
        sale("osu", "2026-05-30"), // older miss: flagged, but not in the streak
      ],
      closedDays: [closed("osu", "2026-06-01")],
    });
    expect(result).toHaveLength(1);
    expect(result[0].unclosedDays).toEqual(["2026-06-04", "2026-06-03", "2026-06-02", "2026-05-30"]);
    expect(result[0].streak).toBe(3);
  });

  it("a no-sale calendar day doesn't break the streak — there was nothing to close", () => {
    const result = flags({
      saleTimes: [sale("osu", "2026-06-04"), sale("osu", "2026-06-02")], // no sales on 06-03
    });
    expect(result[0].streak).toBe(2);
  });

  it("a closed latest selling day resets the streak, but an older miss stays flagged", () => {
    const result = flags({
      saleTimes: [sale("osu", "2026-06-04"), sale("osu", "2026-06-03")],
      closedDays: [closed("osu", "2026-06-04")],
    });
    expect(result[0]).toMatchObject({ unclosedDays: ["2026-06-03"], streak: 0 });
  });

  it("selling days before the lookback are ignored; the first day is inside it", () => {
    expect(flags({ saleTimes: [sale("osu", "2026-05-21")] })).toEqual([]); // one day too old
    const boundary = flags({ saleTimes: [sale("osu", "2026-05-22")] });
    expect(boundary[0]).toMatchObject({ unclosedDays: ["2026-05-22"], latestLabel: "22 May" });
  });

  it("many Sales on one day are one selling day", () => {
    const result = flags({
      saleTimes: [sale("osu", "2026-06-04"), { shopId: "osu", createdAt: "2026-06-04T18:30:00Z" }],
    });
    expect(result[0].unclosedDays).toEqual(["2026-06-04"]);
  });

  it("ignores an unparseable sale timestamp", () => {
    expect(flags({ saleTimes: [{ shopId: "osu", createdAt: "garbage" }] })).toEqual([]);
  });

  it("ranks the worst pattern first: longest streak, then most unclosed days", () => {
    const result = flags({
      saleTimes: [
        sale("accra", "2026-06-04"),
        sale("osu", "2026-06-04"),
        sale("osu", "2026-06-03"),
        sale("osu", "2026-06-02"),
      ],
    });
    expect(result.map((flag) => flag.shopId)).toEqual(["osu", "accra"]);
  });
});
