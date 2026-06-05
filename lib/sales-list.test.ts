import { describe, it, expect } from "vitest";

import {
  DEFAULT_SALES_RANGE,
  matchesSaleFilters,
  parseSalesRange,
  resolveSalesWindow,
  shapeSaleRow,
  summarizeSales,
  type SaleListRow,
  type ShapeableSale,
} from "./sales-list";

const SHOPS = new Map([
  ["shop-a", "Accra Mall"],
  ["shop-b", "Kumasi City"],
]);

function sale(overrides: Partial<ShapeableSale> = {}): ShapeableSale {
  return {
    id: "sale-1",
    shopId: "shop-a",
    sellerName: "Ama",
    customer: "Kofi",
    totalPesewas: 5_000,
    createdAt: "2026-06-05T14:09:00.000Z",
    lines: [{ quantity: 2 }, { quantity: 1 }],
    payments: [{ method: "cash" }],
    ...overrides,
  };
}

function row(overrides: Partial<SaleListRow> = {}): SaleListRow {
  return {
    id: "sale-1",
    dateIso: "2026-06-05",
    date: "5 Jun 2026",
    time: "2:09 PM",
    shopId: "shop-a",
    shopName: "Accra Mall",
    sellerName: "Ama",
    customer: "Kofi",
    itemCount: 3,
    methods: ["cash"],
    totalPesewas: 5_000,
    ...overrides,
  };
}

describe("shapeSaleRow", () => {
  it("shapes the UTC date, 12-hour clock, units, and resolved shop name", () => {
    const r = shapeSaleRow(sale(), SHOPS);
    expect(r).toMatchObject({
      id: "sale-1",
      dateIso: "2026-06-05",
      date: "5 Jun 2026",
      time: "2:09 PM",
      shopName: "Accra Mall",
      sellerName: "Ama",
      customer: "Kofi",
      itemCount: 3,
      methods: ["cash"],
      totalPesewas: 5_000,
    });
  });

  it("renders midnight and noon on the 12-hour clock", () => {
    expect(shapeSaleRow(sale({ createdAt: "2026-06-05T00:30:00.000Z" }), SHOPS).time).toBe(
      "12:30 AM",
    );
    expect(shapeSaleRow(sale({ createdAt: "2026-06-05T12:00:00.000Z" }), SHOPS).time).toBe(
      "12:00 PM",
    );
  });

  it("lists distinct methods in canonical order, regardless of payment order", () => {
    const r = shapeSaleRow(
      sale({ payments: [{ method: "momo" }, { method: "cash" }, { method: "momo" }] }),
      SHOPS,
    );
    expect(r.methods).toEqual(["cash", "momo"]);
  });

  it("falls back when the shop is unknown or the seller is null", () => {
    const r = shapeSaleRow(sale({ shopId: "ghost", sellerName: null }), SHOPS);
    expect(r.shopName).toBe("Unknown shop");
    expect(r.sellerName).toBe("—");
  });

  it("keeps a null customer null (no filtering applied here)", () => {
    expect(shapeSaleRow(sale({ customer: null }), SHOPS).customer).toBeNull();
  });

  it("shows dashes and an empty dateIso when the timestamp is unparseable", () => {
    const r = shapeSaleRow(sale({ createdAt: "not-a-date" }), SHOPS);
    expect(r).toMatchObject({ date: "—", time: "—", dateIso: "" });
  });
});

describe("resolveSalesWindow (presets)", () => {
  const today = "2026-06-05";

  it("'today' is the single day, with an exclusive next-midnight upper bound", () => {
    expect(resolveSalesWindow(today, { range: "today" })).toEqual({
      range: "today",
      fromDate: "2026-06-05",
      toDate: "2026-06-05",
      startIso: "2026-06-05T00:00:00.000Z",
      endIso: "2026-06-06T00:00:00.000Z",
    });
  });

  it("'7d' counts back six days (seven inclusive)", () => {
    const w = resolveSalesWindow(today, { range: "7d" });
    expect(w.fromDate).toBe("2026-05-30");
    expect(w.toDate).toBe("2026-06-05");
  });

  it("'30d' counts back 29 days (thirty inclusive)", () => {
    const w = resolveSalesWindow(today, { range: "30d" });
    expect(w.fromDate).toBe("2026-05-07");
    expect(w.toDate).toBe("2026-06-05");
  });

  it("defaults to the 30-day window for a missing or unknown range", () => {
    expect(resolveSalesWindow(today, {}).range).toBe(DEFAULT_SALES_RANGE);
    expect(resolveSalesWindow(today, { range: "garbage" }).range).toBe("30d");
    expect(resolveSalesWindow(today, { range: "garbage" }).fromDate).toBe("2026-05-07");
  });
});

describe("resolveSalesWindow (custom)", () => {
  const today = "2026-06-05";

  it("uses explicit from/to and an exclusive upper bound across a month boundary", () => {
    expect(resolveSalesWindow(today, { range: "custom", from: "2026-01-01", to: "2026-03-31" })).toEqual(
      {
        range: "custom",
        fromDate: "2026-01-01",
        toDate: "2026-03-31",
        startIso: "2026-01-01T00:00:00.000Z",
        endIso: "2026-04-01T00:00:00.000Z",
      },
    );
  });

  it("swaps reversed dates so fromDate ≤ toDate", () => {
    const w = resolveSalesWindow(today, { range: "custom", from: "2026-03-31", to: "2026-01-01" });
    expect(w.fromDate).toBe("2026-01-01");
    expect(w.toDate).toBe("2026-03-31");
  });

  it("crosses a year boundary on the exclusive end bound", () => {
    const w = resolveSalesWindow(today, { range: "custom", from: "2025-12-31", to: "2025-12-31" });
    expect(w.endIso).toBe("2026-01-01T00:00:00.000Z");
  });

  it("falls back to the 30-day window when custom dates are missing or invalid", () => {
    expect(resolveSalesWindow(today, { range: "custom" }).range).toBe("30d");
    expect(resolveSalesWindow(today, { range: "custom", from: "2026-13-40", to: "x" }).range).toBe(
      "30d",
    );
    expect(resolveSalesWindow(today, { range: "custom", from: "2026-01-01" }).range).toBe("30d");
  });
});

describe("parseSalesRange", () => {
  it("passes known presets through and defaults the rest", () => {
    expect(parseSalesRange("7d")).toBe("7d");
    expect(parseSalesRange("custom")).toBe("custom");
    expect(parseSalesRange(null)).toBe(DEFAULT_SALES_RANGE);
    expect(parseSalesRange("weekly")).toBe(DEFAULT_SALES_RANGE);
  });
});

describe("matchesSaleFilters", () => {
  it("passes every row when method is 'all' and the query is blank", () => {
    expect(matchesSaleFilters(row(), { method: "all", customer: "" })).toBe(true);
  });

  it("keeps only sales that used the chosen method (including split payments)", () => {
    const split = row({ methods: ["cash", "momo"] });
    expect(matchesSaleFilters(split, { method: "momo", customer: "" })).toBe(true);
    expect(matchesSaleFilters(split, { method: "card", customer: "" })).toBe(false);
  });

  it("matches the customer name case-insensitively as a substring", () => {
    expect(matchesSaleFilters(row({ customer: "Kofi Mensah" }), { method: "all", customer: "mensah" })).toBe(
      true,
    );
    expect(matchesSaleFilters(row({ customer: "Kofi" }), { method: "all", customer: "ama" })).toBe(
      false,
    );
  });

  it("excludes a row with no customer once a query is typed, but ignores whitespace-only queries", () => {
    expect(matchesSaleFilters(row({ customer: null }), { method: "all", customer: "k" })).toBe(false);
    expect(matchesSaleFilters(row({ customer: null }), { method: "all", customer: "   " })).toBe(true);
  });
});

describe("summarizeSales", () => {
  it("counts the rows and sums their totals (in pesewas)", () => {
    const rows = [row({ totalPesewas: 5_000 }), row({ totalPesewas: 2_500 }), row({ totalPesewas: 1 })];
    expect(summarizeSales(rows)).toEqual({ count: 3, totalPesewas: 7_501 });
  });

  it("is zero for an empty set", () => {
    expect(summarizeSales([])).toEqual({ count: 0, totalPesewas: 0 });
  });
});
