/**
 * Dashboard view-model — the **pure transform** from a window of Sales, the
 * per-Shop stock, the catalog, the business-wide settings, the acting **role**,
 * the active **Shop scope**, and a selected **date-range window** into the
 * figures the dashboard renders: the period's sales count and revenue, the
 * revenue trend (auto-bucketed to the span — by hour / day / week / month /
 * year), the by-Shop revenue comparison (in the all-Shops rollup), the payment
 * mix, stock health (low / out / expiring), a recent-sales feed, and — for the
 * Owner only — cost of goods, gross profit / margin, and on-hand inventory value.
 *
 * **Date-range window.** The Owner picks a range (Today / last 7 / last 30 days /
 * this month / this year / a custom span that may cross years); a Cashier is
 * always pinned to Today. The range is resolved once, server-side, by
 * {@link resolveDashboardWindow} into a {@link ResolvedDashboardWindow}, then
 * every *flow* figure (revenue, count, COGS/profit/margin, payment mix, by-Shop
 * comparison, the trend) is computed over that window. **Point-in-time** figures
 * — stock health and inventory value — are always "as of now" (current stock),
 * independent of the window, because there is no historical stock to value a past
 * date. The day-over-day delta generalises to **vs the immediately-preceding
 * period** of equal length.
 *
 * Like the Money, Sale, Stock, Settings, and Sales-list modules it sits beside,
 * this file is deliberately free of any server / Supabase import, so the
 * dashboard Server Component, the client view, and the unit tests can all share
 * one tested core. The Server Component does the I/O (it resolves the window,
 * loads the rows, and stamps `today`), then hands everything to
 * {@link buildDashboard}; the result is presentational data only.
 *
 * **Visibility-policy.** Money that derives from *cost* — COGS, gross profit,
 * margin, inventory value — is Owner-only (CONTEXT.md, ADR-0005). Those figures
 * live under the optional {@link DashboardViewModel.owner} block, which is built
 * **only** when {@link can}`(actor, "cost:view")` — i.e. absent (not nulled) from
 * a Cashier's payload, mirroring `redactForActor`. Everything else (revenue,
 * counts, payment mix, stock health, recent feed) is visible to both roles; a
 * Cashier's payload is additionally confined to their one Shop by the scope.
 *
 * **Scope.** The Owner's dashboard defaults to the all-Shops rollup (`mode:
 * "all"`) and can be scoped to a single Shop (`mode: "shop"`) via the Shop-context
 * switcher; a Cashier is always scoped to their Shop. Scope filters the Sales and
 * stock the figures are computed from. In the all-Shops rollup the Owner also
 * gets a by-Shop revenue comparison ({@link DashboardViewModel.shopComparison});
 * it is empty under a single-Shop scope.
 *
 * **Determinism.** `today` is passed in as a UTC `YYYY-MM-DD` string (the caller
 * stamps it server-side — the business runs in Ghana / GMT, so the UTC calendar
 * day is the local one), and every bucket / window boundary is derived from it
 * with explicit UTC date math — no clock is read here, so the transform is fully
 * unit-testable and free of timezone drift.
 *
 * PRD → "Dashboard view-model" and stories 31–38, 44. MP-24 ships the Owner
 * all-Shops rollup; MP-25 adds per-Shop drill-down & the revenue-by-Shop
 * comparison; MP-26 the Cashier variant and its hard redaction test. The Owner
 * date-range report generalises the today-only figures to any span.
 */

import { can, type Actor } from "@/lib/auth/visibility";
import { type Category } from "@/lib/catalog";
import { multiply, sum, ZERO, type Pesewas } from "@/lib/money";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/sale";
import { shapeSaleRow } from "@/lib/sales-list";
import { isExpiringSoon, stockStatus } from "@/lib/stock";

// ---------------------------------------------------------------------------
// Inputs — already-loaded rows, as the Server Component hands them over. Money
// is integer pesewas throughout (mirroring the Money module and the DB).
// ---------------------------------------------------------------------------

/** One line of a Sale: which Item and how many were sold. */
export interface DashboardSaleLine {
  itemId: string;
  quantity: number;
}

/** One payment toward a Sale, by method (mirrors the `payments` table). */
export interface DashboardPayment {
  method: PaymentMethod;
  amountPesewas: Pesewas;
}

/**
 * A completed Sale within the loaded window, with the seller's display name
 * resolved server-side (the `sales.seller` FK points at `auth.users`, so the
 * name is joined via `profiles` before it reaches here). `createdAt` is the raw
 * ISO timestamp; all hour/day/week/month/year bucketing is done in UTC.
 */
export interface DashboardSale {
  id: string;
  shopId: string;
  sellerName: string | null;
  customer: string | null;
  totalPesewas: Pesewas;
  createdAt: string;
  lines: DashboardSaleLine[];
  payments: DashboardPayment[];
}

/** One Shop's stock of one Item. A row's existence means the Shop carries it. */
export interface DashboardStock {
  itemId: string;
  shopId: string;
  quantity: number;
}

/**
 * The catalog facts the dashboard needs per Item: its name/category for the
 * stock-health rows, its cosmetic `expiry` (or `null`) for the expiring list,
 * and its `costPesewas` for COGS and inventory value. `costPesewas` is `null`
 * when masked for a non-Owner (the `items_catalog` view) — the Owner block,
 * which is the only consumer of cost, is never built in that case.
 */
export interface DashboardItem {
  id: string;
  name: string;
  category: Category;
  costPesewas: Pesewas | null;
  expiry: string | null;
  /** Archived/discontinued (MP-31). Kept in the map for cost/COGS resolution of
   * historical Sales, but skipped from stock health so a 0-stock discontinued
   * Item isn't reported as "out of stock". Defaults to active when absent. */
  archived?: boolean;
}

/** A Shop (id + display name). */
export interface DashboardShop {
  id: string;
  name: string;
}

/**
 * The active Shop scope: the all-Shops rollup, or one Shop. The Owner defaults
 * to `all` and narrows via the switcher; a Cashier is always `shop`.
 */
export type DashboardScope = { mode: "all" } | { mode: "shop"; shopId: string };

// ---------------------------------------------------------------------------
// Date-range window — the span the flow figures are computed over.
// ---------------------------------------------------------------------------

/** A date-range preset. `custom` reads explicit `from`/`to` dates (may span years).
 * `month`/`year` are to-date (1st of this month / Jan 1 → today). */
export type DashboardRange = "today" | "7d" | "30d" | "month" | "year" | "custom";

/** The presets, in display order. */
export const DASHBOARD_RANGES: readonly DashboardRange[] = [
  "today",
  "7d",
  "30d",
  "month",
  "year",
  "custom",
];

/** Default range — Today, so the dashboard opens on the day at a glance. */
export const DEFAULT_DASHBOARD_RANGE: DashboardRange = "today";

/** Short label per range (for the preset pills + KPI captions). */
export const RANGE_LABEL: Record<DashboardRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
  year: "This year",
  custom: "Custom",
};

/** How the trend chart buckets the window — picked from the range / span. */
export type TrendGranularity = "hour" | "day" | "week" | "month" | "year";

/**
 * A resolved, bounded date window: the inclusive day bounds (for the inputs /
 * labels), the half-open instant bounds (for the `created_at` query), the lower
 * bound of the immediately-preceding equal-length period (for the delta), and the
 * trend bucket granularity.
 */
export interface ResolvedDashboardWindow {
  range: DashboardRange;
  /** Inclusive first day (UTC `YYYY-MM-DD`). */
  fromDate: string;
  /** Inclusive last day (UTC `YYYY-MM-DD`). */
  toDate: string;
  /** Inclusive lower-bound instant — UTC midnight of {@link fromDate}. */
  startIso: string;
  /** **Exclusive** upper-bound instant — UTC midnight *after* {@link toDate}. */
  endIso: string;
  /** Inclusive lower-bound instant of the preceding equal-length window — the
   * baseline for the period-over-period delta (`[prevStartIso, startIso)`). */
  prevStartIso: string;
  /** Trend bucket size for this window. */
  granularity: TrendGranularity;
}

/**
 * Resolve the date window from `today` (UTC `YYYY-MM-DD`) and the raw URL params.
 * Presets count back from `today`: `today` is the single day, `7d`/`30d` the last
 * 7/30 days, `month`/`year` are to-date (from the 1st of the month / Jan 1).
 * `custom` reads `from`/`to` — both must be valid `YYYY-MM-DD`, else it falls back
 * to Today; reversed dates are swapped so `fromDate ≤ toDate`, and the span may
 * cross years. Pure and UTC throughout (mirrors `resolveSalesWindow`).
 */
export function resolveDashboardWindow(
  today: string,
  params: { range?: string | null; from?: string | null; to?: string | null },
): ResolvedDashboardWindow {
  const range = parseDashboardRange(params.range);

  if (range === "custom") {
    const from = isDateKey(params.from) ? params.from : null;
    const to = isDateKey(params.to) ? params.to : null;
    if (from && to) {
      const [fromDate, toDate] = from <= to ? [from, to] : [to, from];
      return windowFromDays("custom", fromDate, toDate);
    }
    // Incomplete/invalid custom range → fall back to Today.
    return windowFromDays("today", today, today);
  }

  let fromDate: string;
  switch (range) {
    case "7d":
      fromDate = addDaysUtc(today, -6);
      break;
    case "30d":
      fromDate = addDaysUtc(today, -29);
      break;
    case "month":
      fromDate = monthStartKey(today);
      break;
    case "year":
      fromDate = yearStartKey(today);
      break;
    case "today":
    default:
      fromDate = today;
      break;
  }
  return windowFromDays(range, fromDate, today);
}

/** Normalise a raw `range` param to a known preset, defaulting to {@link DEFAULT_DASHBOARD_RANGE}. */
export function parseDashboardRange(raw: string | null | undefined): DashboardRange {
  return DASHBOARD_RANGES.includes(raw as DashboardRange)
    ? (raw as DashboardRange)
    : DEFAULT_DASHBOARD_RANGE;
}

/** Assemble a window from its inclusive day bounds (instant bounds + previous
 * period + granularity all derive from the range and span). */
function windowFromDays(
  range: DashboardRange,
  fromDate: string,
  toDate: string,
): ResolvedDashboardWindow {
  const span = daySpan(fromDate, toDate);
  return {
    range,
    fromDate,
    toDate,
    startIso: `${fromDate}T00:00:00.000Z`,
    endIso: `${addDaysUtc(toDate, 1)}T00:00:00.000Z`,
    prevStartIso: `${addDaysUtc(fromDate, -span)}T00:00:00.000Z`,
    granularity: granularityFor(range, span),
  };
}

/** Trend bucket size: presets read naturally (Today → hourly, week/month spans →
 * daily, this-year → monthly); a custom span auto-scales by length. */
function granularityFor(range: DashboardRange, span: number): TrendGranularity {
  switch (range) {
    case "today":
      return "hour";
    case "7d":
    case "30d":
    case "month":
      return "day";
    case "year":
      return "month";
    default:
      return granularityForSpan(span); // custom
  }
}

/** Auto-scale a custom span to a sensible bucket count: hour ≤1d, day ≤31d,
 * week ≤~26w, month ≤~3y, else year. */
function granularityForSpan(span: number): TrendGranularity {
  if (span <= 1) return "hour";
  if (span <= 31) return "day";
  if (span <= 182) return "week";
  if (span <= 1095) return "month";
  return "year";
}

// ---------------------------------------------------------------------------
// Inputs (cont.) — everything {@link buildDashboard} needs; pure data, no I/O.
// ---------------------------------------------------------------------------

/** Everything {@link buildDashboard} needs; pure data, no I/O. */
export interface DashboardInput {
  actor: Actor;
  scope: DashboardScope;
  /** Today as a UTC `YYYY-MM-DD` string, stamped server-side (for stock expiry). */
  today: string;
  /** The resolved date-range window every flow figure is computed over. */
  window: ResolvedDashboardWindow;
  /** Completed Sales spanning the window **and** the preceding period — i.e.
   * `[window.prevStartIso, window.endIso)` — so both the period figures and the
   * period-over-period delta can be computed from one set. */
  sales: DashboardSale[];
  /** The latest Sales for the recent-sales feed, newest-first (loaded
   * independently of the window so the feed is never empty). Capped here too. */
  recentFeedSales: DashboardSale[];
  /** Every per-Shop stock row in view (Owner: all Shops; Cashier: their Shop). */
  stock: DashboardStock[];
  /** Catalog facts keyed by Item id (name/category/expiry/cost). */
  items: DashboardItem[];
  /** Every Shop (for names + the all-Shops count). */
  shops: DashboardShop[];
  settings: { lowStockThreshold: number; expiryWarningDays: number };
}

// ---------------------------------------------------------------------------
// Outputs — presentational figures.
// ---------------------------------------------------------------------------

/** One point on the revenue trend: a bucket's label, its UTC start, its revenue. */
export interface TrendPoint {
  label: string;
  startIso: string;
  revenuePesewas: Pesewas;
}

/** One method's slice of the period's takings: amount and its share of the total. */
export interface PaymentMixSlice {
  method: PaymentMethod;
  label: string;
  amountPesewas: Pesewas;
  /** Fraction of the period's total payments, 0–1 (0 when nothing was taken). */
  share: number;
}

/**
 * One Shop's row in the by-Shop revenue comparison: the period's revenue and its
 * share of all Shops' period total. The Owner sees this only in the all-Shops
 * rollup (there is nothing to compare against from inside one Shop).
 */
export interface ShopRevenueEntry {
  shopId: string;
  shopName: string;
  revenuePesewas: Pesewas;
  /** This Shop's share of all Shops' period revenue, 0–1 (0 when none sold). */
  share: number;
}

/** One row of the recent-sales feed. `time` is a UTC 12-hour clock string. */
export interface RecentSale {
  id: string;
  time: string;
  shopName: string;
  sellerName: string;
  /** Total units sold across the Sale's lines. */
  itemCount: number;
  /** Distinct payment methods used, in canonical order. */
  methods: PaymentMethod[];
  totalPesewas: Pesewas;
}

/**
 * One stock position needing attention, at the *(Item, Shop)* grain — so in the
 * all-Shops rollup an Item low at two Shops is two rows (two restocks to make).
 */
export interface StockHealthEntry {
  itemId: string;
  shopId: string;
  name: string;
  category: Category;
  quantity: number;
  shopName: string;
  /** The cosmetic expiry (`YYYY-MM-DD`) when this is an expiring row, else `null`. */
  expiry: string | null;
}

/** The Owner-only, cost-derived figures (absent from a Cashier's payload). */
export interface DashboardOwnerFigures {
  /** Cost of goods sold in the period (period lines × current Item cost). */
  cogsPesewas: Pesewas;
  /** The period's revenue − the period's COGS. */
  grossProfitPesewas: Pesewas;
  /** Gross profit ÷ revenue, 0–1; `null` when there was no revenue in the period. */
  marginRatio: number | null;
  /** On-hand stock valued at cost, across the scope — **as of now**. */
  inventoryValuePesewas: Pesewas;
}

/** The resolved scope, carrying the Shop name / count for the header. */
export type ResolvedScope =
  | { mode: "all"; shopCount: number }
  | { mode: "shop"; shopId: string; shopName: string };

/** The full dashboard payload. {@link owner} is present iff the actor may view cost. */
export interface DashboardViewModel {
  scope: ResolvedScope;
  /** The resolved window the flow figures cover (for labels + the active pill). */
  window: {
    range: DashboardRange;
    fromDate: string;
    toDate: string;
    granularity: TrendGranularity;
  };
  /** Sales count + revenue over the selected window (the day, for a Cashier). */
  period: { salesCount: number; revenuePesewas: Pesewas };
  /** This period's revenue vs the immediately-preceding equal-length period, as a
   * signed fraction; `null` when that baseline had no revenue, or when the span is
   * too long to compare cheaply (> ~1 year). */
  revenueDeltaRatio: number | null;
  /** Revenue per trend bucket (oldest → newest) — drives the KPI spark; matches
   * {@link trend}. */
  revenueSpark: Pesewas[];
  /** The revenue trend over the window, auto-bucketed by {@link window.granularity}. */
  trend: TrendPoint[];
  /** The period's revenue per Shop, high→low — the all-Shops comparison; empty when
   * scoped to one Shop. The shares sum to 1 (when any revenue), and the figures
   * reconcile with {@link period} and each Shop's single-Shop rollup. */
  shopComparison: ShopRevenueEntry[];
  /** The period's takings by method, canonical order, all four methods present. */
  paymentMix: PaymentMixSlice[];
  /** Point-in-time (as of now), independent of the window. */
  stockHealth: {
    low: StockHealthEntry[];
    out: StockHealthEntry[];
    expiring: StockHealthEntry[];
  };
  lowStockCount: number;
  outOfStockCount: number;
  expiringCount: number;
  recentSales: RecentSale[];
  owner?: DashboardOwnerFigures;
}

/** How many Sales the recent-sales feed shows. */
export const RECENT_SALES_LIMIT = 8;

const MS_PER_DAY = 86_400_000;
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;
const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  momo: "MoMo",
  card: "Card",
  transfer: "Transfer",
};

/** Spans longer than this skip the period-over-period delta — the preceding
 * period would double a large scan for little insight. */
const MAX_DELTA_SPAN_DAYS = 366;

/**
 * Compute the whole dashboard from a window of Sales + stock + catalog +
 * settings, for the given actor, Shop scope, and date-range window. Pure and
 * deterministic.
 *
 * The figures, in order: the resolved scope (name/count for the header) and
 * window (range/granularity for the labels); the period's count & revenue and the
 * period-over-period delta; the trend (auto-bucketed) and the spark derived from
 * it; the payment mix; the by-Shop comparison (all-Shops rollup); stock health
 * (low / out / expiring at the (Item, Shop) grain, **as of now**) and their
 * counts; the recent-sales feed; and, only when the actor may view cost, the
 * Owner block (COGS, gross profit, margin over the window; inventory value as of
 * now).
 */
export function buildDashboard(input: DashboardInput): DashboardViewModel {
  const { actor, scope, window, today, settings } = input;

  const shopName = new Map(input.shops.map((shop) => [shop.id, shop.name]));
  const itemsById = new Map(input.items.map((item) => [item.id, item]));

  // Scope the Sales, feed, and stock the figures are computed from. A Cashier (or
  // an Owner drilled into one Shop) sees only their Shop; the all-Shops rollup
  // keeps everything. Defence-in-depth: even if the loader pre-scoped, this is a
  // no-op, never a leak.
  const inScope = <T extends { shopId: string }>(rows: readonly T[]): T[] =>
    rows.filter((row) => scope.mode !== "shop" || row.shopId === scope.shopId);

  const sales = inScope(input.sales);
  const feed = inScope(input.recentFeedSales);
  const stock = inScope(input.stock);

  const resolvedScope: ResolvedScope =
    scope.mode === "shop"
      ? { mode: "shop", shopId: scope.shopId, shopName: shopName.get(scope.shopId) ?? "this shop" }
      : { mode: "all", shopCount: input.shops.length };

  // --- Split the loaded Sales into the window and the preceding period. -----
  const startMs = toMs(window.startIso) ?? 0;
  const endMs = toMs(window.endIso) ?? 0;
  const prevStartMs = toMs(window.prevStartIso) ?? 0;

  const windowSales: DashboardSale[] = [];
  let prevRevenue: Pesewas = ZERO;
  for (const sale of sales) {
    const ms = toMs(sale.createdAt);
    if (ms === null) continue;
    if (ms >= startMs && ms < endMs) windowSales.push(sale);
    else if (ms >= prevStartMs && ms < startMs) prevRevenue += sale.totalPesewas;
  }
  const windowRevenue = sum(windowSales.map((sale) => sale.totalPesewas));

  // --- Trend (auto-bucketed) + the spark derived from the same buckets. -----
  const trend = buildTrend(windowSales, window);
  const revenueSpark = trend.map((point) => point.revenuePesewas);

  // --- Period-over-period delta (skipped for very long spans). --------------
  const span = daySpan(window.fromDate, window.toDate);
  const revenueDeltaRatio =
    span > MAX_DELTA_SPAN_DAYS || prevRevenue === 0
      ? null
      : (windowRevenue - prevRevenue) / prevRevenue;

  // --- By-Shop revenue comparison — the all-Shops rollup only, where
  // `windowSales` / `windowRevenue` span every Shop, so the rows reconcile with
  // the headline period figure and with each Shop's single-Shop rollup. -------
  const shopComparison =
    scope.mode === "all" ? buildShopComparison(windowSales, input.shops, windowRevenue) : [];

  // --- Payment mix (period). ------------------------------------------------
  const paymentMix = buildPaymentMix(windowSales);

  // --- Stock health (scoped, as of now — not the window). -------------------
  const stockHealth = buildStockHealth(stock, itemsById, shopName, settings, today);

  // --- Recent-sales feed (latest, scoped — independent of the window). ------
  const recentSales = buildRecentSales(feed, shopName);

  const viewModel: DashboardViewModel = {
    scope: resolvedScope,
    window: {
      range: window.range,
      fromDate: window.fromDate,
      toDate: window.toDate,
      granularity: window.granularity,
    },
    period: { salesCount: windowSales.length, revenuePesewas: windowRevenue },
    revenueDeltaRatio,
    revenueSpark,
    trend,
    shopComparison,
    paymentMix,
    stockHealth,
    lowStockCount: stockHealth.low.length,
    outOfStockCount: stockHealth.out.length,
    expiringCount: stockHealth.expiring.length,
    recentSales,
  };

  // Owner-only, cost-derived figures — built only when the actor may view cost,
  // so they are absent (not nulled) from a Cashier's payload (Visibility-policy).
  if (can(actor, "cost:view")) {
    viewModel.owner = buildOwnerFigures(windowSales, stock, itemsById, windowRevenue);
  }

  return viewModel;
}

// ---------------------------------------------------------------------------
// Section builders.
// ---------------------------------------------------------------------------

/** The period's takings split by method — all four methods, canonical order, each
 * with its share of the period's total (0 when nothing was taken). */
function buildPaymentMix(windowSales: readonly DashboardSale[]): PaymentMixSlice[] {
  const byMethod = new Map<PaymentMethod, Pesewas>();
  for (const sale of windowSales) {
    for (const payment of sale.payments) {
      byMethod.set(payment.method, (byMethod.get(payment.method) ?? 0) + payment.amountPesewas);
    }
  }
  const total = sum([...byMethod.values()]);
  return PAYMENT_METHODS.map((method) => {
    const amountPesewas = byMethod.get(method) ?? ZERO;
    return {
      method,
      label: METHOD_LABELS[method],
      amountPesewas,
      share: total === 0 ? 0 : amountPesewas / total,
    };
  });
}

/** The period's revenue per Shop, high→low, with each Shop's share of the
 * period's all-Shops total — the by-Shop comparison. Every Shop appears (a Shop
 * with no sale is a zero row, sorted last by name), so the rows reconcile exactly
 * with the period's all-Shops revenue and with each Shop's single-Shop rollup. */
function buildShopComparison(
  windowSales: readonly DashboardSale[],
  shops: readonly DashboardShop[],
  windowRevenue: Pesewas,
): ShopRevenueEntry[] {
  const revenueByShop = new Map<string, Pesewas>();
  for (const sale of windowSales) {
    revenueByShop.set(sale.shopId, (revenueByShop.get(sale.shopId) ?? 0) + sale.totalPesewas);
  }
  return shops
    .map((shop) => {
      const revenuePesewas = revenueByShop.get(shop.id) ?? ZERO;
      return {
        shopId: shop.id,
        shopName: shop.name,
        revenuePesewas,
        share: windowRevenue === 0 ? 0 : revenuePesewas / windowRevenue,
      };
    })
    .sort((a, b) => b.revenuePesewas - a.revenuePesewas || a.shopName.localeCompare(b.shopName));
}

/** Classify every carried *(Item, Shop)* position in scope into out / low /
 * expiring lists. A position is "out" (qty 0) or "low" (≤ threshold) by
 * {@link stockStatus}; a carried, in-stock cosmetic within the expiry window is
 * additionally flagged "expiring" (it can be both low and expiring). Point-in-time. */
function buildStockHealth(
  stock: readonly DashboardStock[],
  itemsById: ReadonlyMap<string, DashboardItem>,
  shopName: ReadonlyMap<string, string>,
  settings: { lowStockThreshold: number; expiryWarningDays: number },
  today: string,
): DashboardViewModel["stockHealth"] {
  const low: StockHealthEntry[] = [];
  const out: StockHealthEntry[] = [];
  const expiring: StockHealthEntry[] = [];

  for (const row of stock) {
    const item = itemsById.get(row.itemId);
    // Skip a stock row with no catalog match, and any archived/discontinued Item:
    // it sits at 0 stock and must not surface as an "out of stock" alert (MP-31).
    if (!item || item.archived) continue;

    const base = {
      itemId: row.itemId,
      shopId: row.shopId,
      name: item.name,
      category: item.category,
      quantity: row.quantity,
      shopName: shopName.get(row.shopId) ?? "Unknown shop",
    };

    const status = stockStatus(row.quantity, settings.lowStockThreshold);
    if (status === "out") out.push({ ...base, expiry: null });
    else if (status === "low") low.push({ ...base, expiry: item.expiry });

    if (
      row.quantity > 0 &&
      item.category === "cosmetic" &&
      isExpiringSoon(item.expiry, today, settings.expiryWarningDays)
    ) {
      expiring.push({ ...base, expiry: item.expiry });
    }
  }

  const byName = (a: StockHealthEntry, b: StockHealthEntry) => a.name.localeCompare(b.name);
  return { low: low.sort(byName), out: out.sort(byName), expiring: expiring.sort(byName) };
}

/** The latest {@link RECENT_SALES_LIMIT} Sales in the feed, newest first, shaped
 * for the feed. Projects the shared {@link shapeSaleRow} (the one shaper the full
 * `/sales` list also uses, MP-32) down to the feed's `RecentSale` fields, so the
 * two screens can never drift — the feed just omits date/customer and caps at 8. */
function buildRecentSales(
  sales: readonly DashboardSale[],
  shopName: ReadonlyMap<string, string>,
): RecentSale[] {
  return [...sales]
    .sort((a, b) => (toMs(b.createdAt) ?? 0) - (toMs(a.createdAt) ?? 0))
    .slice(0, RECENT_SALES_LIMIT)
    .map((sale) => {
      const row = shapeSaleRow(sale, shopName);
      return {
        id: row.id,
        time: row.time,
        shopName: row.shopName,
        sellerName: row.sellerName,
        itemCount: row.itemCount,
        methods: row.methods,
        totalPesewas: row.totalPesewas,
      };
    });
}

/** Owner-only money: the period's COGS and gross profit/margin (from the period's
 * lines × current Item cost), and on-hand inventory value across the scope (as of
 * now). A missing cost is treated as 0 (defensive — the Owner reads cost through
 * items_catalog). */
function buildOwnerFigures(
  windowSales: readonly DashboardSale[],
  stock: readonly DashboardStock[],
  itemsById: ReadonlyMap<string, DashboardItem>,
  windowRevenue: Pesewas,
): DashboardOwnerFigures {
  const cogsParts: Pesewas[] = [];
  for (const sale of windowSales) {
    for (const line of sale.lines) {
      const cost = itemsById.get(line.itemId)?.costPesewas ?? 0;
      cogsParts.push(multiply(cost, line.quantity));
    }
  }
  const cogsPesewas = sum(cogsParts);
  const grossProfitPesewas = windowRevenue - cogsPesewas;

  const valueParts: Pesewas[] = [];
  for (const row of stock) {
    const cost = itemsById.get(row.itemId)?.costPesewas ?? 0;
    valueParts.push(multiply(cost, row.quantity));
  }

  return {
    cogsPesewas,
    grossProfitPesewas,
    marginRatio: windowRevenue === 0 ? null : grossProfitPesewas / windowRevenue,
    inventoryValuePesewas: sum(valueParts),
  };
}

// ---------------------------------------------------------------------------
// Trend bucketing — one generic pass, parameterised by granularity. Explicit,
// deterministic UTC date math (no clock read).
// ---------------------------------------------------------------------------

/** Revenue per bucket across the window (oldest → newest), at the window's
 * {@link ResolvedDashboardWindow.granularity}. Every bucket in the span appears
 * (a bucket with no sale is a zero point), so the chart x-axis is contiguous. */
function buildTrend(
  windowSales: readonly DashboardSale[],
  window: ResolvedDashboardWindow,
): TrendPoint[] {
  const buckets = enumerateBuckets(window);
  const revenueByBucket = new Map<string, Pesewas>();
  for (const sale of windowSales) {
    const ms = toMs(sale.createdAt);
    if (ms === null) continue;
    const key = bucketKey(window.granularity, ms);
    revenueByBucket.set(key, (revenueByBucket.get(key) ?? 0) + sale.totalPesewas);
  }
  return buckets.map((bucket) => ({
    label: bucket.label,
    startIso: bucket.startIso,
    revenuePesewas: revenueByBucket.get(bucket.key) ?? ZERO,
  }));
}

interface Bucket {
  key: string;
  label: string;
  startIso: string;
}

/** The contiguous list of buckets spanning the window, at its granularity. */
function enumerateBuckets(window: ResolvedDashboardWindow): Bucket[] {
  const { granularity, fromDate, toDate } = window;
  switch (granularity) {
    case "hour":
      return enumerateHours(fromDate);
    case "day":
      return enumerateDays(fromDate, toDate);
    case "week":
      return enumerateWeeks(fromDate, toDate);
    case "month":
      return enumerateMonths(fromDate, toDate);
    case "year":
      return enumerateYears(fromDate, toDate);
  }
}

/** Which bucket an instant falls in, keyed to match {@link enumerateBuckets}. */
function bucketKey(granularity: TrendGranularity, ms: number): string {
  switch (granularity) {
    case "hour":
      return `${utcDateKey(ms)}H${pad2(new Date(ms).getUTCHours())}`;
    case "day":
      return utcDateKey(ms);
    case "week":
      return mondayKey(ms);
    case "month":
      return utcMonthKey(ms);
    case "year":
      return String(new Date(ms).getUTCFullYear());
  }
}

/** 24 hourly buckets for a single UTC day. */
function enumerateHours(dateKey: string): Bucket[] {
  const buckets: Bucket[] = [];
  for (let h = 0; h < 24; h++) {
    buckets.push({
      key: `${dateKey}H${pad2(h)}`,
      label: hourLabel(h),
      startIso: `${dateKey}T${pad2(h)}:00:00.000Z`,
    });
  }
  return buckets;
}

/** One bucket per UTC day, inclusive of both ends. */
function enumerateDays(fromDate: string, toDate: string): Bucket[] {
  const buckets: Bucket[] = [];
  const endMs = dayStartMs(toDate);
  for (let ms = dayStartMs(fromDate); ms <= endMs; ms += MS_PER_DAY) {
    const key = utcDateKey(ms);
    buckets.push({ key, label: dayMonthLabel(ms), startIso: key });
  }
  return buckets;
}

/** One bucket per Monday-started week covering the span. */
function enumerateWeeks(fromDate: string, toDate: string): Bucket[] {
  const buckets: Bucket[] = [];
  const endMs = dayStartMs(toDate);
  for (let ms = mondayStartMs(dayStartMs(fromDate)); ms <= endMs; ms += 7 * MS_PER_DAY) {
    const key = utcDateKey(ms);
    buckets.push({ key, label: dayMonthLabel(ms), startIso: key });
  }
  return buckets;
}

/** One bucket per calendar month covering the span (year suffix when multi-year). */
function enumerateMonths(fromDate: string, toDate: string): Bucket[] {
  const [fy, fm] = fromDate.split("-").map(Number);
  const [ty, tm] = toDate.split("-").map(Number);
  const multiYear = fy !== ty;
  const buckets: Bucket[] = [];
  for (let idx = fy * 12 + (fm - 1); idx <= ty * 12 + (tm - 1); idx++) {
    const year = Math.floor(idx / 12);
    const month = (idx % 12) + 1; // 1–12
    const key = `${year}-${pad2(month)}`;
    const label = multiYear ? `${MONTH_LABELS[month - 1]} '${String(year).slice(2)}` : MONTH_LABELS[month - 1];
    buckets.push({ key, label, startIso: `${key}-01` });
  }
  return buckets;
}

/** One bucket per calendar year covering the span. */
function enumerateYears(fromDate: string, toDate: string): Bucket[] {
  const fromYear = Number(fromDate.slice(0, 4));
  const toYear = Number(toDate.slice(0, 4));
  const buckets: Bucket[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    buckets.push({ key: String(year), label: String(year), startIso: `${year}-01-01` });
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Date helpers — all UTC, all deterministic (no clock read).
// ---------------------------------------------------------------------------

/** Epoch ms of an ISO timestamp, or `null` if it can't be parsed. */
function toMs(iso: string): number | null {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** UTC `YYYY-MM-DD` for an epoch-ms instant. */
function utcDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** UTC `YYYY-MM` for an epoch-ms instant. */
function utcMonthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** UTC-midnight epoch ms for a `YYYY-MM-DD` string. */
function dayStartMs(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** The UTC-midnight ms of the Monday on or before the given instant. */
function mondayStartMs(ms: number): number {
  const d = new Date(ms);
  const startOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(startOfDay).getUTCDay(); // 0 = Sun … 6 = Sat
  const sinceMonday = (dow + 6) % 7;
  return startOfDay - sinceMonday * MS_PER_DAY;
}

/** `YYYY-MM-DD` of the Monday of the week containing the given instant. */
function mondayKey(ms: number): string {
  return utcDateKey(mondayStartMs(ms));
}

/** Short "6 Jun"-style label for a day/week-start instant. */
function dayMonthLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]}`;
}

/** Short 12-hour clock label for an hour bucket, e.g. `"2 PM"`. */
function hourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${period}`;
}

/** The first day of `dateKey`'s month, as a UTC `YYYY-MM-DD` string. */
function monthStartKey(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number);
  return `${y}-${pad2(m)}-01`;
}

/** Jan 1 of `dateKey`'s year, as a UTC `YYYY-MM-DD` string. */
function yearStartKey(dateKey: string): string {
  const [y] = dateKey.split("-").map(Number);
  return `${y}-01-01`;
}

/** `dateKey` shifted by `days` (may be negative), as a UTC `YYYY-MM-DD` string. */
function addDaysUtc(dateKey: string, days: number): string {
  return utcDateKey(dayStartMs(dateKey) + days * MS_PER_DAY);
}

/** Inclusive day count of `[fromDate, toDate]` (≥ 1 for fromDate ≤ toDate). */
function daySpan(fromDate: string, toDate: string): number {
  return Math.round((dayStartMs(toDate) - dayStartMs(fromDate)) / MS_PER_DAY) + 1;
}

/** Whether a value is a real `YYYY-MM-DD` calendar date (round-trips through UTC). */
function isDateKey(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  return Number.isFinite(ms) && utcDateKey(ms) === value;
}

/** Zero-pad an integer to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
