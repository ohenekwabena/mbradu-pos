/**
 * Dashboard view-model — the **pure transform** from a window of Sales, the
 * per-Shop stock, the catalog, the business-wide settings, the acting **role**,
 * and the active **Shop scope** into the figures the dashboard renders: today's
 * sales count and revenue, the revenue trend (by week / by month), the payment
 * mix, stock health (low / out / expiring), a recent-sales feed, and — for the
 * Owner only — cost of goods, gross profit / margin, and on-hand inventory value.
 *
 * Like the Money, Sale, Stock, and Settings modules it sits beside, this file is
 * deliberately free of any server / Supabase import, so the dashboard Server
 * Component, a Cashier's trimmed dashboard (MP-26), and the unit tests can all
 * share one tested core. The Server Component does the I/O (it loads the rows and
 * stamps `today`), then hands everything to {@link buildDashboard}; the result is
 * presentational data only.
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
 * stock the figures are computed from.
 *
 * **Determinism.** `today` is passed in as a UTC `YYYY-MM-DD` string (the caller
 * stamps it server-side — the business runs in Ghana / GMT, so the UTC calendar
 * day is the local one), and every bucket boundary is derived from it with
 * explicit UTC date math — no clock is read here, so the transform is fully
 * unit-testable and free of timezone drift.
 *
 * PRD → "Dashboard view-model" and stories 31–38, 44. MP-24 ships the Owner
 * all-Shops rollup; MP-25 adds per-Shop drill-down & the revenue-by-Shop
 * comparison; MP-26 the Cashier variant and its hard redaction test.
 */

import { can, type Actor } from "@/lib/auth/visibility";
import { type Category } from "@/lib/catalog";
import { multiply, sum, ZERO, type Pesewas } from "@/lib/money";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/sale";
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
 * A completed Sale within the trend window, with the seller's display name
 * resolved server-side (the `sales.seller` FK points at `auth.users`, so the
 * name is joined via `profiles` before it reaches here). `createdAt` is the raw
 * ISO timestamp; all day/week/month bucketing is done in UTC.
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

/** Everything {@link buildDashboard} needs; pure data, no I/O. */
export interface DashboardInput {
  actor: Actor;
  scope: DashboardScope;
  /** Today as a UTC `YYYY-MM-DD` string, stamped server-side. */
  today: string;
  /** Completed Sales within the trend window (≥ the last 6 months). */
  sales: DashboardSale[];
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

/** One point on the revenue trend: a period's label, its UTC start, its revenue. */
export interface TrendPoint {
  label: string;
  startIso: string;
  revenuePesewas: Pesewas;
}

/** One method's slice of today's takings: amount and its share of the total. */
export interface PaymentMixSlice {
  method: PaymentMethod;
  label: string;
  amountPesewas: Pesewas;
  /** Fraction of today's total payments, 0–1 (0 when nothing was taken). */
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
  /** Cost of goods sold today (today's lines × current Item cost). */
  cogsPesewas: Pesewas;
  /** Today's revenue − today's COGS. */
  grossProfitPesewas: Pesewas;
  /** Gross profit ÷ revenue, 0–1; `null` when there was no revenue today. */
  marginRatio: number | null;
  /** On-hand stock valued at cost, across the scope. */
  inventoryValuePesewas: Pesewas;
}

/** The resolved scope, carrying the Shop name / count for the header. */
export type ResolvedScope =
  | { mode: "all"; shopCount: number }
  | { mode: "shop"; shopId: string; shopName: string };

/** The full dashboard payload. {@link owner} is present iff the actor may view cost. */
export interface DashboardViewModel {
  scope: ResolvedScope;
  today: { salesCount: number; revenuePesewas: Pesewas };
  /** Today's revenue vs yesterday's, as a signed fraction; `null` when yesterday
   * had no revenue (no baseline to compare against). */
  revenueDeltaRatio: number | null;
  /** Daily revenue for the last 7 days (oldest → today) — drives the KPI spark. */
  revenueSpark: Pesewas[];
  trend: { week: TrendPoint[]; month: TrendPoint[] };
  /** Today's takings by method, canonical order, all four methods present. */
  paymentMix: PaymentMixSlice[];
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
/** How many trailing periods each trend series spans. */
export const TREND_PERIODS = 6;
/** Days in the KPI sparkline window. */
const SPARK_DAYS = 7;

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

/**
 * Compute the whole dashboard from a window of Sales + stock + catalog +
 * settings, for the given actor and Shop scope. Pure and deterministic.
 *
 * The figures, in order: the resolved scope (name/count for the header); today's
 * count & revenue and the day-over-day delta; the 7-day revenue spark; the week
 * and month revenue trends; today's payment mix; stock health (low / out /
 * expiring at the (Item, Shop) grain) and their counts; the recent-sales feed;
 * and, only when the actor may view cost, the Owner block (COGS, gross profit,
 * margin, inventory value).
 */
export function buildDashboard(input: DashboardInput): DashboardViewModel {
  const { actor, scope, today, settings } = input;

  const shopName = new Map(input.shops.map((shop) => [shop.id, shop.name]));
  const itemsById = new Map(input.items.map((item) => [item.id, item]));

  // Scope the Sales and stock the figures are computed from.
  const sales =
    scope.mode === "shop"
      ? input.sales.filter((sale) => sale.shopId === scope.shopId)
      : input.sales;
  const stock =
    scope.mode === "shop"
      ? input.stock.filter((row) => row.shopId === scope.shopId)
      : input.stock;

  const resolvedScope: ResolvedScope =
    scope.mode === "shop"
      ? { mode: "shop", shopId: scope.shopId, shopName: shopName.get(scope.shopId) ?? "this shop" }
      : { mode: "all", shopCount: input.shops.length };

  // --- Day buckets: today, yesterday, and the 7-day spark window. ----------
  const todayStart = dayStartMs(today);
  const revenueByDay = new Map<string, Pesewas>();
  for (const sale of sales) {
    const ms = toMs(sale.createdAt);
    if (ms === null) continue;
    const key = utcDateKey(ms);
    revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + sale.totalPesewas);
  }
  const todayKey = utcDateKey(todayStart);
  const yesterdayKey = utcDateKey(todayStart - MS_PER_DAY);
  const todayRevenue = revenueByDay.get(todayKey) ?? ZERO;
  const yesterdayRevenue = revenueByDay.get(yesterdayKey) ?? ZERO;

  const todaySales = sales.filter((sale) => {
    const ms = toMs(sale.createdAt);
    return ms !== null && utcDateKey(ms) === todayKey;
  });

  const revenueSpark: Pesewas[] = [];
  for (let i = SPARK_DAYS - 1; i >= 0; i--) {
    revenueSpark.push(revenueByDay.get(utcDateKey(todayStart - i * MS_PER_DAY)) ?? ZERO);
  }

  // --- Trends: revenue by week (Mondays) and by calendar month. ------------
  const trend = {
    week: buildWeekTrend(sales, todayStart),
    month: buildMonthTrend(sales, today),
  };

  // --- Payment mix (today). ------------------------------------------------
  const paymentMix = buildPaymentMix(todaySales);

  // --- Stock health (scoped). ----------------------------------------------
  const stockHealth = buildStockHealth(stock, itemsById, shopName, settings, today);

  // --- Recent-sales feed (latest, scoped). ---------------------------------
  const recentSales = buildRecentSales(sales, shopName);

  const viewModel: DashboardViewModel = {
    scope: resolvedScope,
    today: { salesCount: todaySales.length, revenuePesewas: todayRevenue },
    revenueDeltaRatio:
      yesterdayRevenue === 0 ? null : (todayRevenue - yesterdayRevenue) / yesterdayRevenue,
    revenueSpark,
    trend,
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
    viewModel.owner = buildOwnerFigures(todaySales, stock, itemsById, todayRevenue);
  }

  return viewModel;
}

// ---------------------------------------------------------------------------
// Section builders.
// ---------------------------------------------------------------------------

/** Today's takings split by method — all four methods, canonical order, each
 * with its share of the day's total (0 when nothing was taken). */
function buildPaymentMix(todaySales: readonly DashboardSale[]): PaymentMixSlice[] {
  const byMethod = new Map<PaymentMethod, Pesewas>();
  for (const sale of todaySales) {
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

/** Classify every carried *(Item, Shop)* position in scope into out / low /
 * expiring lists. A position is "out" (qty 0) or "low" (≤ threshold) by
 * {@link stockStatus}; a carried, in-stock cosmetic within the expiry window is
 * additionally flagged "expiring" (it can be both low and expiring). */
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

/** The latest {@link RECENT_SALES_LIMIT} Sales in scope, newest first, shaped
 * for the feed (time, Shop, seller, unit count, methods, total). */
function buildRecentSales(
  sales: readonly DashboardSale[],
  shopName: ReadonlyMap<string, string>,
): RecentSale[] {
  return [...sales]
    .sort((a, b) => (toMs(b.createdAt) ?? 0) - (toMs(a.createdAt) ?? 0))
    .slice(0, RECENT_SALES_LIMIT)
    .map((sale) => ({
      id: sale.id,
      time: formatClock(toMs(sale.createdAt)),
      shopName: shopName.get(sale.shopId) ?? "Unknown shop",
      sellerName: sale.sellerName ?? "—",
      itemCount: sale.lines.reduce((n, line) => n + line.quantity, 0),
      methods: PAYMENT_METHODS.filter((method) =>
        sale.payments.some((payment) => payment.method === method),
      ),
      totalPesewas: sale.totalPesewas,
    }));
}

/** Owner-only money: today's COGS and gross profit/margin (from today's lines ×
 * current Item cost), and on-hand inventory value across the scope. A missing
 * cost is treated as 0 (defensive — the Owner reads cost through items_catalog). */
function buildOwnerFigures(
  todaySales: readonly DashboardSale[],
  stock: readonly DashboardStock[],
  itemsById: ReadonlyMap<string, DashboardItem>,
  todayRevenue: Pesewas,
): DashboardOwnerFigures {
  const cogsParts: Pesewas[] = [];
  for (const sale of todaySales) {
    for (const line of sale.lines) {
      const cost = itemsById.get(line.itemId)?.costPesewas ?? 0;
      cogsParts.push(multiply(cost, line.quantity));
    }
  }
  const cogsPesewas = sum(cogsParts);
  const grossProfitPesewas = todayRevenue - cogsPesewas;

  const valueParts: Pesewas[] = [];
  for (const row of stock) {
    const cost = itemsById.get(row.itemId)?.costPesewas ?? 0;
    valueParts.push(multiply(cost, row.quantity));
  }

  return {
    cogsPesewas,
    grossProfitPesewas,
    marginRatio: todayRevenue === 0 ? null : grossProfitPesewas / todayRevenue,
    inventoryValuePesewas: sum(valueParts),
  };
}

// ---------------------------------------------------------------------------
// Trend bucketing — explicit, deterministic UTC date math.
// ---------------------------------------------------------------------------

/** Revenue for the last {@link TREND_PERIODS} calendar months, ending with the
 * month containing `today` (oldest → newest). */
function buildMonthTrend(sales: readonly DashboardSale[], today: string): TrendPoint[] {
  const revenueByMonth = new Map<string, Pesewas>();
  for (const sale of sales) {
    const ms = toMs(sale.createdAt);
    if (ms === null) continue;
    const key = utcMonthKey(ms);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + sale.totalPesewas);
  }

  const [ty, tm] = today.split("-").map(Number);
  const points: TrendPoint[] = [];
  for (let i = TREND_PERIODS - 1; i >= 0; i--) {
    // Step back i months from (ty, tm) without Date arithmetic.
    const monthIndex = (ty * 12 + (tm - 1)) - i;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1; // 1–12
    const key = `${year}-${pad2(month)}`;
    points.push({
      label: MONTH_LABELS[month - 1],
      startIso: `${key}-01`,
      revenuePesewas: revenueByMonth.get(key) ?? ZERO,
    });
  }
  return points;
}

/** Revenue for the last {@link TREND_PERIODS} weeks, each starting on its Monday
 * (UTC), ending with the week containing `today` (oldest → newest). */
function buildWeekTrend(sales: readonly DashboardSale[], todayStart: number): TrendPoint[] {
  const revenueByWeek = new Map<string, Pesewas>();
  for (const sale of sales) {
    const ms = toMs(sale.createdAt);
    if (ms === null) continue;
    revenueByWeek.set(
      mondayKey(ms),
      (revenueByWeek.get(mondayKey(ms)) ?? 0) + sale.totalPesewas,
    );
  }

  const thisMonday = mondayStartMs(todayStart);
  const points: TrendPoint[] = [];
  for (let i = TREND_PERIODS - 1; i >= 0; i--) {
    const start = thisMonday - i * 7 * MS_PER_DAY;
    const key = utcDateKey(start);
    points.push({
      label: dayMonthLabel(start),
      startIso: key,
      revenuePesewas: revenueByWeek.get(key) ?? ZERO,
    });
  }
  return points;
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

/** Short "6 Jun"-style label for a week-start instant. */
function dayMonthLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]}`;
}

/** UTC 12-hour clock string ("2:14 PM") for an instant, or "—" when missing. */
function formatClock(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const period = hours < 12 ? "AM" : "PM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${pad2(minutes)} ${period}`;
}

/** Zero-pad an integer to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
