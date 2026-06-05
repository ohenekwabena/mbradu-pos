import { describe, it, expect } from "vitest";

import { isSensitiveField, redactForActor, type Actor } from "@/lib/auth/visibility";

import {
  buildDashboard,
  RECENT_SALES_LIMIT,
  type DashboardInput,
  type DashboardScope,
} from "./dashboard";

// ---------------------------------------------------------------------------
// Fixture — two Shops, four Items, and Sales dated across today, yesterday,
// earlier this week, and earlier months, so the figures below are predictable.
//   today = 2026-06-05 (a Friday; its week's Monday is 2026-06-01).
//   settings: low-stock threshold 5, expiry window 30 days.
// ---------------------------------------------------------------------------

const TODAY = "2026-06-05";

const SHOPS = [
  { id: "shopA", name: "Accra Mall" },
  { id: "shopB", name: "Osu Oxford St." },
];

const ITEMS = [
  { id: "wigA", name: "Honey Blonde 20\" Lace Front", category: "wig" as const, costPesewas: 10000, expiry: null },
  { id: "cosA", name: "Matte Lipstick — Coral", category: "cosmetic" as const, costPesewas: 2000, expiry: "2026-06-12" },
  { id: "toolA", name: "Boar-Bristle Brush", category: "wig_tool" as const, costPesewas: 500, expiry: null },
  { id: "cosB", name: "Setting Powder — Translucent", category: "cosmetic" as const, costPesewas: 3000, expiry: "2027-01-01" },
];

// Carried (Item, Shop) positions and their on-hand quantity.
const STOCK = [
  { itemId: "wigA", shopId: "shopA", quantity: 2 }, // low
  { itemId: "cosA", shopId: "shopA", quantity: 0 }, // out
  { itemId: "toolA", shopId: "shopA", quantity: 10 }, // in
  { itemId: "cosB", shopId: "shopA", quantity: 4 }, // low
  { itemId: "wigA", shopId: "shopB", quantity: 8 }, // in
  { itemId: "cosA", shopId: "shopB", quantity: 3 }, // low + expiring
  { itemId: "toolA", shopId: "shopB", quantity: 0 }, // out
];

const SALES = [
  // --- Today (2026-06-05) ---
  {
    id: "s1", shopId: "shopA", sellerName: "Ama O.", customer: null,
    totalPesewas: 52000, createdAt: "2026-06-05T14:14:00Z",
    lines: [ { itemId: "wigA", quantity: 1 }, { itemId: "cosA", quantity: 2 } ],
    payments: [ { method: "cash" as const, amountPesewas: 52000 } ],
  },
  {
    id: "s2", shopId: "shopB", sellerName: "Kojo M.", customer: null,
    totalPesewas: 4500, createdAt: "2026-06-05T13:58:00Z",
    lines: [ { itemId: "toolA", quantity: 3 } ],
    payments: [ { method: "momo" as const, amountPesewas: 4500 } ],
  },
  {
    id: "s3", shopId: "shopA", sellerName: "Ama O.", customer: "Akua",
    totalPesewas: 8000, createdAt: "2026-06-05T12:47:00Z",
    lines: [ { itemId: "cosB", quantity: 1 } ],
    payments: [ { method: "card" as const, amountPesewas: 5000 }, { method: "cash" as const, amountPesewas: 3000 } ],
  },
  // --- Yesterday (2026-06-04) — seller name missing, to exercise the fallback ---
  {
    id: "s0", shopId: "shopA", sellerName: null, customer: null,
    totalPesewas: 30000, createdAt: "2026-06-04T16:00:00Z",
    lines: [ { itemId: "wigA", quantity: 1 } ],
    payments: [ { method: "cash" as const, amountPesewas: 30000 } ],
  },
  // --- Monday of this week (2026-06-01) ---
  {
    id: "swk", shopId: "shopB", sellerName: "Kojo M.", customer: null,
    totalPesewas: 20000, createdAt: "2026-06-01T10:00:00Z",
    lines: [ { itemId: "wigA", quantity: 1 } ],
    payments: [ { method: "cash" as const, amountPesewas: 20000 } ],
  },
  // --- Earlier in May (week of Mon 2026-05-18) ---
  {
    id: "smay", shopId: "shopA", sellerName: "Ama O.", customer: null,
    totalPesewas: 50000, createdAt: "2026-05-20T10:00:00Z",
    lines: [ { itemId: "wigA", quantity: 1 } ],
    payments: [ { method: "cash" as const, amountPesewas: 50000 } ],
  },
  // --- April (in the 6-month window, but outside the 6-week window) ---
  {
    id: "sapr", shopId: "shopA", sellerName: "Ama O.", customer: null,
    totalPesewas: 15000, createdAt: "2026-04-10T10:00:00Z",
    lines: [ { itemId: "wigA", quantity: 1 } ],
    payments: [ { method: "cash" as const, amountPesewas: 15000 } ],
  },
];

const OWNER: Actor = { role: "owner", shopId: null };
const CASHIER_B: Actor = { role: "cashier", shopId: "shopB" };

function makeInput(overrides: Partial<DashboardInput> = {}): DashboardInput {
  return {
    actor: OWNER,
    scope: { mode: "all" },
    today: TODAY,
    // Fresh copies so a test can't mutate the shared fixture.
    sales: SALES.map((s) => ({ ...s, lines: [...s.lines], payments: [...s.payments] })),
    stock: STOCK.map((s) => ({ ...s })),
    items: ITEMS.map((i) => ({ ...i })),
    shops: SHOPS.map((s) => ({ ...s })),
    settings: { lowStockThreshold: 5, expiryWarningDays: 30 },
    ...overrides,
  };
}

describe("buildDashboard — scope resolution", () => {
  it("defaults to the all-Shops rollup with the Shop count", () => {
    const vm = buildDashboard(makeInput());
    expect(vm.scope).toEqual({ mode: "all", shopCount: 2 });
  });

  it("resolves a single-Shop scope to that Shop's name", () => {
    const scope: DashboardScope = { mode: "shop", shopId: "shopB" };
    const vm = buildDashboard(makeInput({ scope }));
    expect(vm.scope).toEqual({ mode: "shop", shopId: "shopB", shopName: "Osu Oxford St." });
  });
});

describe("buildDashboard — today's count & revenue (all Shops)", () => {
  it("counts only today's Sales and sums their totals", () => {
    const vm = buildDashboard(makeInput());
    // s1 (52000) + s2 (4500) + s3 (8000) — yesterday/earlier excluded.
    expect(vm.today.salesCount).toBe(3);
    expect(vm.today.revenuePesewas).toBe(64500);
  });

  it("reports today-vs-yesterday revenue as a signed ratio", () => {
    const vm = buildDashboard(makeInput());
    // (64500 − 30000) / 30000 = 1.15
    expect(vm.revenueDeltaRatio).toBeCloseTo(1.15, 10);
  });

  it("has a null delta when yesterday had no revenue", () => {
    // Drop yesterday's sale → no baseline.
    const sales = SALES.filter((s) => s.id !== "s0");
    const vm = buildDashboard(makeInput({ sales }));
    expect(vm.revenueDeltaRatio).toBeNull();
  });
});

describe("buildDashboard — revenue spark (last 7 days)", () => {
  it("is one revenue figure per day, oldest → today", () => {
    const vm = buildDashboard(makeInput());
    // 05-30, 05-31, 06-01, 06-02, 06-03, 06-04, 06-05
    expect(vm.revenueSpark).toEqual([0, 0, 20000, 0, 0, 30000, 64500]);
  });
});

describe("buildDashboard — revenue trend", () => {
  it("buckets the last 6 calendar months, oldest → current", () => {
    const vm = buildDashboard(makeInput());
    expect(vm.trend.month.map((p) => [p.label, p.startIso, p.revenuePesewas])).toEqual([
      ["Jan", "2026-01-01", 0],
      ["Feb", "2026-02-01", 0],
      ["Mar", "2026-03-01", 0],
      ["Apr", "2026-04-01", 15000],
      ["May", "2026-05-01", 50000],
      ["Jun", "2026-06-01", 114500], // swk 20000 + s0 30000 + today 64500
    ]);
  });

  it("buckets the last 6 weeks by Monday, oldest → current", () => {
    const vm = buildDashboard(makeInput());
    expect(vm.trend.week.map((p) => [p.label, p.startIso, p.revenuePesewas])).toEqual([
      ["27 Apr", "2026-04-27", 0], // April sale is before this window
      ["4 May", "2026-05-04", 0],
      ["11 May", "2026-05-11", 0],
      ["18 May", "2026-05-18", 50000], // smay (2026-05-20)
      ["25 May", "2026-05-25", 0],
      ["1 Jun", "2026-06-01", 114500], // swk + s0 + today
    ]);
  });
});

describe("buildDashboard — payment mix (today)", () => {
  it("splits today's takings by method in canonical order, with shares", () => {
    const vm = buildDashboard(makeInput());
    expect(vm.paymentMix.map((s) => s.method)).toEqual(["cash", "momo", "card", "transfer"]);

    const byMethod = Object.fromEntries(vm.paymentMix.map((s) => [s.method, s]));
    // cash: s1 52000 + s3 3000 = 55000; momo 4500; card 5000; transfer 0.
    expect(byMethod.cash.amountPesewas).toBe(55000);
    expect(byMethod.momo.amountPesewas).toBe(4500);
    expect(byMethod.card.amountPesewas).toBe(5000);
    expect(byMethod.transfer.amountPesewas).toBe(0);

    expect(byMethod.cash.share).toBeCloseTo(55000 / 64500, 10);
    expect(byMethod.transfer.share).toBe(0);
    expect(byMethod.cash.label).toBe("Cash");
    expect(byMethod.momo.label).toBe("MoMo");
  });
});

describe("buildDashboard — stock health (all Shops, (Item, Shop) grain)", () => {
  it("classifies each carried position into low / out / expiring", () => {
    const vm = buildDashboard(makeInput());

    expect(vm.stockHealth.low.map((e) => [e.itemId, e.shopId])).toEqual(
      // sorted by name: cosB (Setting Powder) … cosA (Matte) … wigA (Honey) —
      // localeCompare on the display names.
      expect.arrayContaining([
        ["wigA", "shopA"],
        ["cosB", "shopA"],
        ["cosA", "shopB"],
      ]),
    );
    expect(vm.lowStockCount).toBe(3);

    expect(vm.stockHealth.out.map((e) => [e.itemId, e.shopId])).toEqual(
      expect.arrayContaining([
        ["cosA", "shopA"],
        ["toolA", "shopB"],
      ]),
    );
    expect(vm.outOfStockCount).toBe(2);

    // Only the carried, in-stock cosmetic within the window: cosA @ shopB (qty 3).
    expect(vm.stockHealth.expiring.map((e) => [e.itemId, e.shopId])).toEqual([["cosA", "shopB"]]);
    expect(vm.expiringCount).toBe(1);
    expect(vm.stockHealth.expiring[0].expiry).toBe("2026-06-12");
    expect(vm.stockHealth.expiring[0].shopName).toBe("Osu Oxford St.");
  });

  it("carries the Shop name and quantity on each entry", () => {
    const vm = buildDashboard(makeInput());
    const wigLow = vm.stockHealth.low.find((e) => e.itemId === "wigA" && e.shopId === "shopA");
    expect(wigLow).toMatchObject({ shopName: "Accra Mall", quantity: 2, category: "wig" });
  });
});

describe("buildDashboard — recent-sales feed", () => {
  it("lists Sales newest-first, capped, with time / shop / seller / units / methods", () => {
    const vm = buildDashboard(makeInput());
    expect(vm.recentSales.length).toBeLessThanOrEqual(RECENT_SALES_LIMIT);
    expect(vm.recentSales[0]).toMatchObject({
      id: "s1",
      time: "2:14 PM",
      shopName: "Accra Mall",
      sellerName: "Ama O.",
      itemCount: 3, // wigA×1 + cosA×2
      methods: ["cash"],
      totalPesewas: 52000,
    });
    expect(vm.recentSales.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s0", "swk", "smay", "sapr"]);
  });

  it("lists split-payment methods in canonical order and falls back for a missing seller", () => {
    const vm = buildDashboard(makeInput());
    const s3 = vm.recentSales.find((s) => s.id === "s3");
    expect(s3?.methods).toEqual(["cash", "card"]); // card+cash → canonical [cash, card]
    const s0 = vm.recentSales.find((s) => s.id === "s0");
    expect(s0?.sellerName).toBe("—");
  });
});

describe("buildDashboard — Owner-only figures (Visibility-policy)", () => {
  it("includes the Owner block for the Owner", () => {
    const vm = buildDashboard(makeInput({ actor: OWNER }));
    expect(vm.owner).toBeDefined();

    // COGS today: s1 (wigA 10000×1 + cosA 2000×2 = 14000) + s2 (toolA 500×3 = 1500)
    //           + s3 (cosB 3000×1 = 3000) = 18500.
    expect(vm.owner!.cogsPesewas).toBe(18500);
    // Gross profit = revenue 64500 − COGS 18500 = 46000.
    expect(vm.owner!.grossProfitPesewas).toBe(46000);
    expect(vm.owner!.marginRatio).toBeCloseTo(46000 / 64500, 10);
    // Inventory value at cost, on hand (all Shops): 123000.
    expect(vm.owner!.inventoryValuePesewas).toBe(123000);
  });

  it("omits the Owner block entirely for a Cashier (absent, not nulled)", () => {
    const vm = buildDashboard(
      makeInput({ actor: CASHIER_B, scope: { mode: "shop", shopId: "shopB" } }),
    );
    expect(vm.owner).toBeUndefined();
    expect("owner" in vm).toBe(false);
  });

  it("has a null margin when there was no revenue today", () => {
    const sales = SALES.filter((s) => !["s1", "s2", "s3"].includes(s.id));
    const vm = buildDashboard(makeInput({ sales }));
    expect(vm.today.revenuePesewas).toBe(0);
    expect(vm.owner!.marginRatio).toBeNull();
  });
});

describe("buildDashboard — single-Shop scope confines every figure", () => {
  it("computes a Cashier's Shop-only payload (covers only their Shop)", () => {
    const vm = buildDashboard(
      makeInput({ actor: CASHIER_B, scope: { mode: "shop", shopId: "shopB" } }),
    );

    // Today @ shopB: only s2 (4500).
    expect(vm.today.salesCount).toBe(1);
    expect(vm.today.revenuePesewas).toBe(4500);

    // Stock health @ shopB: cosA low+expiring, toolA out, wigA in.
    expect(vm.lowStockCount).toBe(1);
    expect(vm.outOfStockCount).toBe(1);
    expect(vm.expiringCount).toBe(1);
    expect(vm.stockHealth.out[0].itemId).toBe("toolA");

    // Recent feed is shopB-only.
    expect(vm.recentSales.every((s) => s.shopName === "Osu Oxford St.")).toBe(true);
    expect(vm.recentSales.map((s) => s.id)).toEqual(["s2", "swk"]);
  });

  it("scopes the Owner block to one Shop when the Owner narrows scope", () => {
    const vm = buildDashboard(makeInput({ scope: { mode: "shop", shopId: "shopB" } }));
    // Inventory value @ shopB: wigA 8×10000 + cosA 3×2000 + toolA 0×500 = 86000.
    expect(vm.owner!.inventoryValuePesewas).toBe(86000);
    // COGS today @ shopB: s2 toolA 500×3 = 1500; profit = 4500 − 1500 = 3000.
    expect(vm.owner!.cogsPesewas).toBe(1500);
    expect(vm.owner!.grossProfitPesewas).toBe(3000);
  });
});

describe("buildDashboard — by-Shop revenue comparison (all Shops)", () => {
  it("ranks every Shop by today's revenue, high→low, with shares of the day's total", () => {
    const vm = buildDashboard(makeInput());
    // Today: shopA = s1 52000 + s3 8000 = 60000; shopB = s2 4500. Total 64500.
    expect(vm.shopComparison.map((r) => [r.shopId, r.revenuePesewas])).toEqual([
      ["shopA", 60000],
      ["shopB", 4500],
    ]);
    expect(vm.shopComparison[0].shopName).toBe("Accra Mall");
    expect(vm.shopComparison[1].shopName).toBe("Osu Oxford St.");

    expect(vm.shopComparison[0].share).toBeCloseTo(60000 / 64500, 10);
    expect(vm.shopComparison[1].share).toBeCloseTo(4500 / 64500, 10);
    // Shares of the day's takings sum to 1.
    expect(vm.shopComparison.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 10);
  });

  it("reconciles with the all-Shops today revenue (rows sum to the headline)", () => {
    const vm = buildDashboard(makeInput());
    const summed = vm.shopComparison.reduce((s, r) => s + r.revenuePesewas, 0);
    expect(summed).toBe(vm.today.revenuePesewas);
    expect(summed).toBe(64500);
  });

  it("each Shop's comparison figure equals that Shop's single-Shop rollup", () => {
    const all = buildDashboard(makeInput());
    // The reconciliation guarantee: narrowing scope to a Shop yields the same
    // today revenue that Shop contributes to the all-Shops comparison.
    for (const row of all.shopComparison) {
      const scoped = buildDashboard(makeInput({ scope: { mode: "shop", shopId: row.shopId } }));
      expect(scoped.today.revenuePesewas).toBe(row.revenuePesewas);
    }
  });

  it("includes a Shop with no sales today as a zero row, sorted last", () => {
    const shops = [...SHOPS, { id: "shopC", name: "Tema Mall" }];
    const vm = buildDashboard(makeInput({ shops }));
    expect(vm.shopComparison.map((r) => r.shopId)).toEqual(["shopA", "shopB", "shopC"]);
    expect(vm.shopComparison[2]).toMatchObject({
      shopName: "Tema Mall",
      revenuePesewas: 0,
      share: 0,
    });
  });

  it("is empty under a single-Shop scope (nothing to compare)", () => {
    const vm = buildDashboard(makeInput({ scope: { mode: "shop", shopId: "shopB" } }));
    expect(vm.shopComparison).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Hard redaction — the dashboard payload is tied to the Visibility-policy
// (lib/auth/visibility): no cost-derived field may appear *anywhere* in a
// Cashier's payload, and the policy's own redactor agrees (defence-in-depth).
// This is stronger than the "owner block absent" check above — it would catch a
// cost field leaking onto any nested row (a stock-health entry, a recent sale),
// not just the top level. MP-26 (PRD stories 39, 40, 47).
// ---------------------------------------------------------------------------

/** Every object key anywhere in `value` (recursing through arrays and nested
 * objects) that the Visibility-policy treats as Owner-only money. */
function collectSensitiveKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectSensitiveKeys(entry, found);
  } else if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (isSensitiveField(key)) found.push(key);
      collectSensitiveKeys(val, found);
    }
  }
  return found;
}

describe("buildDashboard — hard redaction (Visibility-policy, end-to-end)", () => {
  const cashierVm = () =>
    buildDashboard(makeInput({ actor: CASHIER_B, scope: { mode: "shop", shopId: "shopB" } }));
  const ownerVm = () => buildDashboard(makeInput({ actor: OWNER }));

  it("a Cashier payload carries no cost-derived field anywhere (deep scan)", () => {
    expect(collectSensitiveKeys(cashierVm())).toEqual([]);
  });

  it("the Owner payload does carry the cost-derived figures (the scan has teeth)", () => {
    // All four live under vm.owner; the scan must find them, or the Cashier
    // assertion above would pass vacuously.
    expect([...new Set(collectSensitiveKeys(ownerVm()))].sort()).toEqual(
      ["cogsPesewas", "grossProfitPesewas", "inventoryValuePesewas", "marginRatio"].sort(),
    );
  });

  it("redactForActor strips every Owner figure when an Owner payload is bound for a Cashier", () => {
    expect(collectSensitiveKeys(redactForActor(CASHIER_B, ownerVm()))).toEqual([]);
  });

  it("leaves a Cashier's already-clean payload untouched (redactForActor is a no-op)", () => {
    const vm = cashierVm();
    expect(redactForActor(CASHIER_B, vm)).toEqual(vm);
  });
});
