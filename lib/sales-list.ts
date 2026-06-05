/**
 * Completed-sales list — the **pure core** behind the `/sales` archive screen
 * (MP-32). It shapes a completed Sale into one display row, resolves the date
 * window the screen queries over, and filters / summarises the resulting rows.
 *
 * Like Money, Sale, Stock, and Dashboard, this file is deliberately free of any
 * server / Supabase import, so the `/sales` Server Component, the client view,
 * and the unit tests all share one tested core. The Server Component does the I/O
 * (it bounds the query by {@link resolveSalesWindow} and loads the rows), then
 * shapes each row with {@link shapeSaleRow}; the client view filters by method /
 * customer with {@link matchesSaleFilters} and totals with {@link summarizeSales}.
 *
 * **Reuse.** {@link shapeSaleRow} is the single source of sale-row shaping: the
 * dashboard's recent-sales feed ({@link "@/lib/dashboard".RecentSale}) is the
 * capped-at-8 projection of the same shaping, so the two screens can never drift.
 * A {@link SaleListRow} is a {@link "@/lib/dashboard".RecentSale} plus the `date`
 * and `customer` this fuller, browsable list adds.
 *
 * **Determinism.** `today` and every bound are UTC `YYYY-MM-DD` strings or UTC
 * instants — the business runs in Ghana (GMT), so the UTC calendar day is the
 * local one — and no clock is read here, so the whole module is unit-testable and
 * free of timezone drift (mirroring the Dashboard module).
 *
 * **No cost here.** Sales rows carry only revenue (the Sale total), never cost /
 * profit / margin, so there is nothing for the Visibility-policy to redact — the
 * screen is identical for the Owner and a Cashier (scope aside). PRD story 38 is
 * the dashboard feed; this is its full, filterable, paginated counterpart.
 */

import { sum, type Pesewas } from "@/lib/money";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/sale";

// ---------------------------------------------------------------------------
// Row shaping — one completed Sale → one display row.
// ---------------------------------------------------------------------------

/**
 * The minimal slice of a completed Sale {@link shapeSaleRow} needs. The
 * dashboard's `DashboardSale` is structurally assignable to this (it carries
 * these fields plus a few extras), so the dashboard feed reuses the same shaper.
 */
export interface ShapeableSale {
  id: string;
  shopId: string;
  /** The seller's display name (resolved server-side), or `null` when unknown. */
  sellerName: string | null;
  /** The customer's name captured at sale time, or `null`. */
  customer: string | null;
  totalPesewas: Pesewas;
  /** The raw ISO timestamp; bucketed to a UTC day/clock here. */
  createdAt: string;
  /** The Sale's lines — only the quantity matters for the unit count. */
  lines: readonly { quantity: number }[];
  /** The Sale's payments — only the method matters for the method chips. */
  payments: readonly { method: PaymentMethod }[];
}

/**
 * One completed-sales-list row. A superset of the dashboard's `RecentSale`: it
 * adds {@link date} (this list spans many days, not just today) and
 * {@link customer}, and keeps {@link dateIso} for grouping/sorting.
 */
export interface SaleListRow {
  id: string;
  /** UTC calendar day (`YYYY-MM-DD`), `""` if the timestamp can't be parsed. */
  dateIso: string;
  /** Display date, e.g. `"5 Jun 2026"`. */
  date: string;
  /** Display time (UTC 12-hour clock), e.g. `"2:14 PM"`. */
  time: string;
  shopId: string;
  shopName: string;
  /** The seller's name, or `"—"` when unknown (e.g. masked by RLS). */
  sellerName: string;
  /** The customer's name, or `null` when none was captured. */
  customer: string | null;
  /** Total units sold across the Sale's lines. */
  itemCount: number;
  /** Distinct payment methods used, in canonical order. */
  methods: PaymentMethod[];
  totalPesewas: Pesewas;
}

/**
 * Shape one completed Sale into a {@link SaleListRow}: its UTC date & time, the
 * Shop name (resolved from the id map), the seller, the customer, the unit count,
 * the distinct payment methods (canonical order), and the total. Pure.
 */
export function shapeSaleRow(
  sale: ShapeableSale,
  shopNameById: ReadonlyMap<string, string>,
): SaleListRow {
  const ms = toMs(sale.createdAt);
  return {
    id: sale.id,
    dateIso: ms === null ? "" : utcDateKey(ms),
    date: formatDate(ms),
    time: formatClock(ms),
    shopId: sale.shopId,
    shopName: shopNameById.get(sale.shopId) ?? "Unknown shop",
    sellerName: sale.sellerName ?? "—",
    customer: sale.customer,
    itemCount: sale.lines.reduce((n, line) => n + line.quantity, 0),
    methods: PAYMENT_METHODS.filter((method) =>
      sale.payments.some((payment) => payment.method === method),
    ),
    totalPesewas: sale.totalPesewas,
  };
}

// ---------------------------------------------------------------------------
// Date window — the bounded range the screen queries over.
// ---------------------------------------------------------------------------

/** A date-range preset. `custom` reads explicit `from`/`to` dates. */
export type SalesRange = "today" | "7d" | "30d" | "custom";

/** The presets, in display order. */
export const SALES_RANGES: readonly SalesRange[] = ["today", "7d", "30d", "custom"];

/** Default range — a bounded window so the initial query never scans all history. */
export const DEFAULT_SALES_RANGE: SalesRange = "30d";

/** Short label per range (for the preset pills). */
export const RANGE_LABEL: Record<SalesRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  custom: "Custom",
};

/** A resolved, bounded date window: the day bounds (for the inputs/labels) and
 * the half-open instant bounds (for the `created_at` query). */
export interface ResolvedSalesWindow {
  range: SalesRange;
  /** Inclusive first day (UTC `YYYY-MM-DD`). */
  fromDate: string;
  /** Inclusive last day (UTC `YYYY-MM-DD`). */
  toDate: string;
  /** Inclusive lower bound instant — UTC midnight of {@link fromDate}. */
  startIso: string;
  /** **Exclusive** upper bound instant — UTC midnight *after* {@link toDate}, so
   * the whole of {@link toDate} is included (`created_at < endIso`). */
  endIso: string;
}

/**
 * Resolve the date window from `today` (UTC `YYYY-MM-DD`) and the raw URL params.
 * Presets count back from `today`: `today` is the single day, `7d` the last 7
 * days, `30d` (default) the last 30. `custom` reads `from`/`to` — both must be
 * valid `YYYY-MM-DD`, else it falls back to the 30-day window; reversed dates are
 * swapped so `fromDate ≤ toDate`. Pure and UTC throughout.
 */
export function resolveSalesWindow(
  today: string,
  params: { range?: string | null; from?: string | null; to?: string | null },
): ResolvedSalesWindow {
  const range = parseSalesRange(params.range);

  if (range === "custom") {
    const from = isDateKey(params.from) ? params.from : null;
    const to = isDateKey(params.to) ? params.to : null;
    if (from && to) {
      const [fromDate, toDate] = from <= to ? [from, to] : [to, from];
      return windowFromDays("custom", fromDate, toDate);
    }
    // Incomplete/invalid custom range → fall back to the bounded default.
    return windowFromDays("30d", addDaysUtc(today, -29), today);
  }

  const spanDays = range === "today" ? 1 : range === "7d" ? 7 : 30;
  return windowFromDays(range, addDaysUtc(today, -(spanDays - 1)), today);
}

/** Normalise a raw `range` param to a known preset, defaulting to {@link DEFAULT_SALES_RANGE}. */
export function parseSalesRange(raw: string | null | undefined): SalesRange {
  return SALES_RANGES.includes(raw as SalesRange) ? (raw as SalesRange) : DEFAULT_SALES_RANGE;
}

/** Assemble a window from its inclusive day bounds (the instant bounds derive). */
function windowFromDays(range: SalesRange, fromDate: string, toDate: string): ResolvedSalesWindow {
  return {
    range,
    fromDate,
    toDate,
    startIso: `${fromDate}T00:00:00.000Z`,
    endIso: `${addDaysUtc(toDate, 1)}T00:00:00.000Z`,
  };
}

// ---------------------------------------------------------------------------
// Filtering & summary — over the already-shaped, already-windowed rows.
// ---------------------------------------------------------------------------

/** The fast, in-window filters applied client-side (the date window is the query bound). */
export interface SaleFilters {
  /** A single payment method, or `"all"`. A Sale matches if it *used* the method. */
  method: PaymentMethod | "all";
  /** Free-text customer-name search (case-insensitive substring); `""` = no filter. */
  customer: string;
}

/** Whether a row passes the method + customer filters. Pure. */
export function matchesSaleFilters(row: SaleListRow, filters: SaleFilters): boolean {
  if (filters.method !== "all" && !row.methods.includes(filters.method)) return false;
  const query = filters.customer.trim().toLowerCase();
  if (query !== "" && !(row.customer ?? "").toLowerCase().includes(query)) return false;
  return true;
}

/** The filtered-set summary header: how many Sales and their summed total. */
export interface SalesSummary {
  count: number;
  totalPesewas: Pesewas;
}

/** Count and total a set of rows (the lightweight on-screen "report"). Pure. */
export function summarizeSales(rows: readonly SaleListRow[]): SalesSummary {
  return { count: rows.length, totalPesewas: sum(rows.map((row) => row.totalPesewas)) };
}

// ---------------------------------------------------------------------------
// Date helpers — all UTC, all deterministic (no clock read).
// ---------------------------------------------------------------------------

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const MS_PER_DAY = 86_400_000;

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

/** Short `"5 Jun 2026"` date for an instant, or `"—"` when missing/unparseable. */
function formatDate(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** UTC 12-hour clock string (`"2:14 PM"`) for an instant, or `"—"` when missing. */
function formatClock(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const period = hours < 12 ? "AM" : "PM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${pad2(minutes)} ${period}`;
}

/** `dateKey` shifted by `days` (may be negative), as a UTC `YYYY-MM-DD` string. */
function addDaysUtc(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return utcDateKey(Date.UTC(y, m - 1, d) + days * MS_PER_DAY);
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
