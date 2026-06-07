"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DatePicker } from "@/components/date-picker";
import { CATEGORY_LABEL, formatExpiry } from "@/lib/catalog";
import {
  DASHBOARD_RANGES,
  RANGE_LABEL,
  type DashboardRange,
  type DashboardViewModel,
  type PaymentMixSlice,
  type StockHealthEntry,
  type TrendGranularity,
  type TrendPoint,
} from "@/lib/dashboard";
import { format } from "@/lib/money";
import type { PaymentMethod } from "@/lib/sale";

/** Full GH₵ string, e.g. "GH₵ 1,250.00". */
function cedis(pesewas: number): string {
  return format(pesewas, { symbol: true });
}
/** Amount without the symbol, for the split KPI unit/value, e.g. "1,250.00". */
function cedisPlain(pesewas: number): string {
  return format(pesewas, { symbol: false });
}
/** A ratio (0–1, or signed for the delta) as a percentage string. */
function pct(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  momo: "MoMo",
  card: "Card",
  transfer: "Transfer",
};

/** How the trend's bucket size reads in the chart legend. */
const GRANULARITY_LABEL: Record<TrendGranularity, string> = {
  hour: "Hourly",
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Fixed payment-mix palette (per the design — a violet sequence, independent of
 * the themeable accent so the four methods stay visually distinct). */
const MIX_COLORS: Record<PaymentMethod, string> = {
  cash: "#673ab7",
  momo: "#9575cd",
  card: "#b39ddb",
  transfer: "#d1c4e9",
};

/** Per-series palette for the by-Shop comparison bars (design §5 — a violet /
 * green / orange / pink / blue / teal sequence), cycled across Shops in rank
 * order, so the top Shop is always the themeable violet. */
const SHOP_COLORS = ["#673ab7", "#2e7d32", "#f57c00", "#ec407a", "#0288d1", "#00897b"];

type Window = DashboardViewModel["window"];

/** "2026-06-05" → "5 Jun 2026" (the dates are already UTC calendar days). */
function prettyDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Human range, e.g. "5 Jun 2026" (single day) or "7 May – 5 Jun 2026". */
function rangeText(window: Window): string {
  if (window.fromDate === window.toDate) return prettyDate(window.fromDate);
  return `${prettyDate(window.fromDate)} – ${prettyDate(window.toDate)}`;
}

/** The friendly period name for card captions — the preset label, or the explicit
 * dates for a custom span. */
function periodLabel(window: Window): string {
  return window.range === "custom" ? rangeText(window) : RANGE_LABEL[window.range];
}

/**
 * The dashboard surface. Presentational only — every figure comes precomputed
 * from the pure {@link DashboardViewModel}; this component just lays it out and
 * formats money via the Money module. The Owner gets a **date-range selector**
 * that drives every flow figure (revenue, profit, payment mix, by-Shop
 * comparison, and the trend); a Cashier is pinned to Today with no selector.
 * Stock health and inventory value are point-in-time ("as of now"), independent
 * of the range. MP-24, MP-25.
 */
export function DashboardView({ vm }: { vm: DashboardViewModel }) {
  const isOwner = vm.owner !== undefined;
  const isAllShops = vm.scope.mode === "all";

  return (
    <>
      {isOwner && <RangeToolbar window={vm.window} />}

      <div className={`kpi-row section ${isOwner ? "" : "kpi-row-2"}`}>
        {isOwner ? <OwnerKpis vm={vm} /> : <CashierKpis vm={vm} />}
      </div>

      {isOwner && (
        <div className="dash-grid section">
          <RevenueCard vm={vm} />
          <div className="stack gap-16">
            {isAllShops && <ShopComparisonCard vm={vm} />}
            <PaymentMixCard vm={vm} />
          </div>
        </div>
      )}

      <div className="dash-grid section">
        <RecentSalesCard vm={vm} showShop={isAllShops} />
        <StockHealthCard vm={vm} showShop={isAllShops} isOwner={isOwner} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Date-range selector (Owner only).
// ---------------------------------------------------------------------------

/**
 * The Owner's report range: preset chips plus a Custom from/to date picker, all
 * URL-driven (`router.push` → the server re-queries the bounded window), mirroring
 * the `/sales` archive. The drafts seed from the active window; the page keys this
 * view by the window, so navigating re-seeds them. Spans may cross years.
 */
function RangeToolbar({ window }: { window: Window }) {
  const router = useRouter();
  const [fromDraft, setFromDraft] = useState(window.fromDate);
  const [toDraft, setToDraft] = useState(window.toDate);

  function goToRange(range: DashboardRange) {
    if (range === "custom") {
      router.push(`/dashboard?range=custom&from=${fromDraft}&to=${toDraft}`);
    } else {
      router.push(`/dashboard?range=${range}`);
    }
  }

  return (
    <div className="inv-toolbar">
      <div className="pills">
        {DASHBOARD_RANGES.map((range) => (
          <button
            key={range}
            type="button"
            className={"pill" + (window.range === range ? " active" : "")}
            onClick={() => goToRange(range)}
          >
            {RANGE_LABEL[range]}
          </button>
        ))}
      </div>

      {window.range === "custom" && (
        <div className="date-range">
          <DatePicker
            value={fromDraft}
            onChange={setFromDraft}
            max={toDraft || undefined}
            aria-label="From date"
          />
          <span className="sep">–</span>
          <DatePicker
            value={toDraft}
            onChange={setToDraft}
            min={fromDraft || undefined}
            aria-label="To date"
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => goToRange("custom")}
            disabled={!fromDraft || !toDraft}
          >
            Apply
          </button>
        </div>
      )}

      <span className="caption text-faint" style={{ marginLeft: "auto" }}>
        {rangeText(window)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI rows.
// ---------------------------------------------------------------------------

/** Period-over-period delta (or a muted dash when there's no baseline). */
function Delta({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="delta">—</span>;
  const up = ratio >= 0;
  return (
    <span className={`delta ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {pct(Math.abs(ratio), 1)}
    </span>
  );
}

function OwnerKpis({ vm }: { vm: DashboardViewModel }) {
  const owner = vm.owner!;
  const isToday = vm.window.range === "today";
  const deltaCtx = isToday ? "from yesterday" : "vs prev. period";
  return (
    <>
      <div className="kpi">
        <div className="kpi-label">{isToday ? "Today’s Revenue" : "Revenue"}</div>
        <div className="kpi-top">
          <span className="kpi-unit">GH₵</span>
          <span className="kpi-value">{cedisPlain(vm.period.revenuePesewas)}</span>
        </div>
        <div className="kpi-foot">
          <div>
            <Delta ratio={vm.revenueDeltaRatio} />
            <span className="ctx">{deltaCtx}</span>
          </div>
          <Sparkline values={vm.revenueSpark} color="var(--primary)" />
        </div>
      </div>

      <div className="kpi">
        <div className="kpi-label">Gross Profit</div>
        <div className="kpi-top">
          <span className="kpi-unit">GH₵</span>
          <span className="kpi-value">{cedisPlain(owner.grossProfitPesewas)}</span>
        </div>
        <div className="kpi-foot">
          <div>
            <span className="ctx">
              {owner.marginRatio === null ? "no sales yet" : `${pct(owner.marginRatio)} margin`}
            </span>
          </div>
        </div>
      </div>

      <div className="kpi">
        <div className="kpi-label">Inventory Value</div>
        <div className="kpi-top">
          <span className="kpi-unit">GH₵</span>
          <span className="kpi-value">{cedisPlain(owner.inventoryValuePesewas)}</span>
        </div>
        <div className="kpi-foot">
          <div>
            <span className="ctx">at cost, on hand</span>
          </div>
        </div>
      </div>

      <div className="kpi">
        <div className="kpi-label">Low-stock items</div>
        <div className="kpi-top">
          <span className="kpi-value">{vm.lowStockCount}</span>
          <span className="kpi-unit">to restock</span>
        </div>
        <div className="kpi-foot">
          <div>
            <span className="ctx">{vm.outOfStockCount} out of stock</span>
          </div>
        </div>
      </div>
    </>
  );
}

function CashierKpis({ vm }: { vm: DashboardViewModel }) {
  return (
    <>
      <div className="kpi">
        <div className="kpi-label">Today&rsquo;s Sales</div>
        <div className="kpi-top">
          <span className="kpi-value">{vm.period.salesCount}</span>
          <span className="kpi-unit">{vm.period.salesCount === 1 ? "sale" : "sales"}</span>
        </div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Today&rsquo;s Revenue</div>
        <div className="kpi-top">
          <span className="kpi-unit">GH₵</span>
          <span className="kpi-value">{cedisPlain(vm.period.revenuePesewas)}</span>
        </div>
        <div className="kpi-foot">
          <div>
            <Delta ratio={vm.revenueDeltaRatio} />
            <span className="ctx">from yesterday</span>
          </div>
          <Sparkline values={vm.revenueSpark} color="var(--primary)" />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Revenue trend.
// ---------------------------------------------------------------------------

function RevenueCard({ vm }: { vm: DashboardViewModel }) {
  const points = vm.trend;
  const total = points.reduce((sum, p) => sum + p.revenuePesewas, 0);

  return (
    <div className="card chart-card">
      <div className="card-head">
        <div>
          <h2 className="h2">Revenue Overview</h2>
          <div className="legend mt-8">
            <span className="dot" />
            {GRANULARITY_LABEL[vm.window.granularity]} · {periodLabel(vm.window)}
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div className="chart-empty text-faint">No revenue in this period yet.</div>
      ) : (
        <RevenueChart points={points} />
      )}
    </div>
  );
}

/** A dependency-free SVG area chart over the trend points, with a hover tooltip.
 * The viewBox scales to the card width via `width: 100%`. X-axis labels are
 * thinned when there are many buckets, so a 24-hour or 30-day span doesn't crowd. */
function RevenueChart({ points }: { points: TrendPoint[] }) {
  const [active, setActive] = useState<number | null>(null);

  const W = 760;
  const H = 260;
  const padL = 14;
  const padR = 14;
  const padT = 16;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const geom = useMemo(() => {
    const values = points.map((p) => p.revenuePesewas);
    const max = Math.max(...values, 1);
    const n = points.length;
    const xs = points.map((_, i) => (n <= 1 ? padL + plotW / 2 : padL + (i * plotW) / (n - 1)));
    const ys = values.map((v) => padT + plotH * (1 - v / max));
    const baseline = padT + plotH;
    const line = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
    const area = `M ${xs[0].toFixed(1)} ${baseline} ${xs
      .map((x, i) => `L ${x.toFixed(1)} ${ys[i].toFixed(1)}`)
      .join(" ")} L ${xs[n - 1].toFixed(1)} ${baseline} Z`;
    return { values, max, xs, ys, baseline, line, area };
  }, [points, plotH, plotW]);

  const gridYs = [0, 0.5, 1].map((f) => padT + plotH * f);

  // Show at most ~8 x-labels: the first, every k-th, and always the last.
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const showLabel = (i: number) => i % labelEvery === 0 || i === points.length - 1;

  // Hover dots scale down when the series is dense (hourly / daily) so they don't merge.
  const dotR = points.length > 14 ? 2.5 : 3.5;

  return (
    <div className="chart-card-inner">
      <svg viewBox={`0 0 ${W} ${H}`} className="rev-chart" role="img" aria-label="Revenue trend">
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridYs.map((y, i) => (
          <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} className="rev-grid" />
        ))}

        <path d={geom.area} fill="url(#revGrad)" />
        <path d={geom.line} className="rev-line" fill="none" />

        {geom.xs.map((x, i) => (
          <circle key={i} cx={x} cy={geom.ys[i]} r={active === i ? dotR + 1.5 : dotR} className="rev-dot" />
        ))}

        {/* Per-point hover bands (invisible) drive the tooltip. */}
        {geom.xs.map((x, i) => {
          const left = i === 0 ? 0 : (geom.xs[i - 1] + x) / 2;
          const right = i === geom.xs.length - 1 ? W : (x + geom.xs[i + 1]) / 2;
          return (
            <rect
              key={i}
              x={left}
              y={0}
              width={right - left}
              height={H}
              fill="transparent"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
            />
          );
        })}

        {points.map((p, i) =>
          showLabel(i) ? (
            <text key={i} x={geom.xs[i]} y={H - 10} className="rev-xlabel" textAnchor="middle">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>

      {active !== null && (
        <div
          className="chart-tip"
          style={{ left: `${(geom.xs[active] / W) * 100}%`, top: `${(geom.ys[active] / H) * 100}%` }}
        >
          <div className="per">{points[active].label}</div>
          <div className="val">{cedis(points[active].revenuePesewas)}</div>
        </div>
      )}
    </div>
  );
}

/** Tiny inline trend line for a KPI foot. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 96;
  const H = 36;
  const pad = 3;
  const max = Math.max(...values, 1);
  const n = values.length;
  const pts = values
    .map((v, i) => {
      const x = n <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1);
      const y = pad + (H - 2 * pad) * (1 - v / max);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Revenue by shop (all-Shops comparison).
// ---------------------------------------------------------------------------

/** The by-Shop revenue comparison: one bar per Shop over the period, ranked
 * high→low (the view-model already sorted them). Bars are sized against the top
 * Shop and coloured by rank from {@link SHOP_COLORS}. Rendered only in the
 * all-Shops scope; a single-Shop drill-down has nothing to compare. */
function ShopComparisonCard({ vm }: { vm: DashboardViewModel }) {
  const rows = vm.shopComparison;
  const max = rows.reduce((m, r) => Math.max(m, r.revenuePesewas), 0);

  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: 12 }}>
        <h2 className="h2">Revenue by shop</h2>
        <span className="caption text-faint">{periodLabel(vm.window)}</span>
      </div>

      {max === 0 ? (
        <div className="text-faint" style={{ padding: "4px 0" }}>
          No sales in this period yet.
        </div>
      ) : (
        <div className="rbs">
          {rows.map((row, i) => (
            <div className="rbs-row" key={row.shopId}>
              <div className="rbs-name">{row.shopName}</div>
              <div className="rbs-track">
                <div
                  className="rbs-fill"
                  style={{
                    width: `${Math.round((row.revenuePesewas / max) * 100)}%`,
                    background: SHOP_COLORS[i % SHOP_COLORS.length],
                  }}
                />
              </div>
              <div className="rbs-amt">{cedis(row.revenuePesewas)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment mix.
// ---------------------------------------------------------------------------

function PaymentMixCard({ vm }: { vm: DashboardViewModel }) {
  const hasTakings = vm.paymentMix.some((s) => s.amountPesewas > 0);
  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: 10 }}>
        <h2 className="h2">Payment mix</h2>
        <span className="caption text-faint">{periodLabel(vm.window)}</span>
      </div>

      {hasTakings ? (
        <div className="paymix-bar">
          {vm.paymentMix
            .filter((s) => s.share > 0)
            .map((s) => (
              <div key={s.method} style={{ width: `${s.share * 100}%`, background: MIX_COLORS[s.method] }} />
            ))}
        </div>
      ) : (
        <div className="paymix-bar paymix-bar-empty" />
      )}

      <div className="paymix-legend">
        {vm.paymentMix.map((s: PaymentMixSlice) => (
          <div className="lg" key={s.method}>
            <span className="sw" style={{ background: MIX_COLORS[s.method] }} />
            {s.label}
            <span className="amt tnum">{cedis(s.amountPesewas)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock health.
// ---------------------------------------------------------------------------

type HealthTab = "low" | "out" | "expiring";

const TAB_CHIP: Record<HealthTab, { chip: string; label: string }> = {
  low: { chip: "chip-warning", label: "Low stock" },
  out: { chip: "chip-danger", label: "Out of stock" },
  expiring: { chip: "chip-accent", label: "Expiring soon" },
};

function StockHealthCard({
  vm,
  showShop,
  isOwner,
}: {
  vm: DashboardViewModel;
  showShop: boolean;
  isOwner: boolean;
}) {
  const [tab, setTab] = useState<HealthTab>("low");
  const entries = vm.stockHealth[tab];

  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <h2 className="h2">Stock health</h2>
        <span className="caption text-faint">As of now</span>
      </div>
      <div className="seg-tabs" style={{ marginBottom: 8 }}>
        <button type="button" className={`pill ${tab === "low" ? "active" : ""}`} onClick={() => setTab("low")}>
          Low · {vm.lowStockCount}
        </button>
        <button type="button" className={`pill ${tab === "out" ? "active" : ""}`} onClick={() => setTab("out")}>
          Out · {vm.outOfStockCount}
        </button>
        <button
          type="button"
          className={`pill ${tab === "expiring" ? "active" : ""}`}
          onClick={() => setTab("expiring")}
        >
          Expiring · {vm.expiringCount}
        </button>
      </div>

      <div>
        {entries.length === 0 ? (
          <div className="health-item" style={{ borderBottom: "none" }}>
            <div className="meta">Nothing here — all good.</div>
          </div>
        ) : (
          entries.map((entry) => (
            <HealthRow key={`${entry.itemId}:${entry.shopId}`} entry={entry} tab={tab} showShop={showShop} />
          ))
        )}
      </div>

      {isOwner && (
        <Link className="btn btn-secondary btn-block btn-sm mt-16" href="/inventory">
          View in Inventory
        </Link>
      )}
    </div>
  );
}

function HealthRow({
  entry,
  tab,
  showShop,
}: {
  entry: StockHealthEntry;
  tab: HealthTab;
  showShop: boolean;
}) {
  const { chip, label } = TAB_CHIP[tab];
  const detail =
    tab === "expiring" && entry.expiry
      ? `Exp ${formatExpiry(entry.expiry)}`
      : `${entry.quantity} left`;
  const meta = `${CATEGORY_LABEL[entry.category]} · ${detail}${showShop ? ` · ${entry.shopName}` : ""}`;

  return (
    <div className="health-item">
      <div>
        <div className="body-med">{entry.name}</div>
        <div className="meta">{meta}</div>
      </div>
      <span className={`chip ${chip}`}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent sales.
// ---------------------------------------------------------------------------

function RecentSalesCard({ vm, showShop }: { vm: DashboardViewModel; showShop: boolean }) {
  const colSpan = showShop ? 6 : 5;
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="h2">Recent sales</h2>
        <Link className="btn btn-ghost btn-sm" href="/sales">
          View all
        </Link>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Time</th>
              {showShop && <th>Shop</th>}
              <th>Seller</th>
              <th>Items</th>
              <th>Payment</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {vm.recentSales.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="text-muted" style={{ padding: "18px 0" }}>
                  No sales yet.
                </td>
              </tr>
            ) : (
              vm.recentSales.map((sale) => (
                <tr key={sale.id}>
                  <td className="text-muted tnum">{sale.time}</td>
                  {showShop && <td>{sale.shopName}</td>}
                  <td>{sale.sellerName}</td>
                  <td className="text-muted">
                    {sale.itemCount} {sale.itemCount === 1 ? "item" : "items"}
                  </td>
                  <td>
                    {sale.methods.map((m) => (
                      <span key={m} className="chip chip-neutral" style={{ marginRight: 4 }}>
                        {METHOD_LABEL[m]}
                      </span>
                    ))}
                  </td>
                  <td className="num">
                    <Link href={`/sales/${sale.id}`}>{cedis(sale.totalPesewas)}</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
