"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/icon";
import { format } from "@/lib/money";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/sale";
import {
  matchesSaleFilters,
  RANGE_LABEL,
  SALES_RANGES,
  summarizeSales,
  type SaleListRow,
  type SalesRange,
} from "@/lib/sales-list";

/** The active Shop scope for the header + Shop column (resolved server-side). */
export type SalesScope =
  | { mode: "all"; shopCount: number }
  | { mode: "shop"; shopName: string };

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  momo: "MoMo",
  card: "Card",
  transfer: "Transfer",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** How many rows the list reveals at a time (the "Load more" page size). */
const PAGE_SIZE = 25;

/**
 * The completed-sales archive surface. Presentational + interactive: the rows are
 * shaped server-side (revenue only — no cost/profit anywhere), and this view adds
 * the controls. The **date range** drives the URL (`router.push` → the server
 * re-queries the bounded window); **payment method + customer** filter the loaded
 * window client-side; the **summary** (count + GH₵ total) recomputes over the
 * filtered set; and the list reveals {@link PAGE_SIZE} rows at a time. Each row
 * links to its receipt. MP-32.
 */
export function SalesView({
  rows,
  scope,
  dateWindow,
}: {
  rows: SaleListRow[];
  scope: SalesScope;
  dateWindow: { range: SalesRange; fromDate: string; toDate: string };
}) {
  const router = useRouter();
  const showShop = scope.mode === "all";

  const [method, setMethod] = useState<PaymentMethod | "all">("all");
  const [customer, setCustomer] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  // Drafts for the custom-range inputs (seeded from the active window).
  const [fromDraft, setFromDraft] = useState(dateWindow.fromDate);
  const [toDraft, setToDraft] = useState(dateWindow.toDate);

  const filtered = useMemo(
    () => rows.filter((row) => matchesSaleFilters(row, { method, customer })),
    [rows, method, customer],
  );
  const summary = useMemo(() => summarizeSales(filtered), [filtered]);
  const shown = filtered.slice(0, visible);

  function goToRange(range: SalesRange) {
    if (range === "custom") {
      router.push(`/sales?range=custom&from=${fromDraft}&to=${toDraft}`);
    } else {
      router.push(`/sales?range=${range}`);
    }
  }

  function pickMethod(next: PaymentMethod | "all") {
    setMethod(next);
    setVisible(PAGE_SIZE);
  }

  function searchCustomer(next: string) {
    setCustomer(next);
    setVisible(PAGE_SIZE);
  }

  return (
    <>
      <div className="scope-note">
        {scope.mode === "shop" ? (
          <>
            <Icon name="store" /> Showing <strong>{scope.shopName}</strong> — switch shops in the
            top bar.
          </>
        ) : (
          <>
            <Icon name="dashboard" /> Showing <strong>all shops</strong> combined. Pick a shop in
            the top bar to narrow.
          </>
        )}
      </div>

      <div className="inv-toolbar">
        <div className="pills">
          {SALES_RANGES.map((range) => (
            <button
              key={range}
              type="button"
              className={"pill" + (dateWindow.range === range ? " active" : "")}
              onClick={() => goToRange(range)}
            >
              {RANGE_LABEL[range]}
            </button>
          ))}
        </div>

        {dateWindow.range === "custom" && (
          <div className="date-range">
            <input
              type="date"
              className="input"
              aria-label="From date"
              value={fromDraft}
              max={toDraft || undefined}
              onChange={(e) => setFromDraft(e.target.value)}
            />
            <span className="sep">–</span>
            <input
              type="date"
              className="input"
              aria-label="To date"
              value={toDraft}
              min={fromDraft || undefined}
              onChange={(e) => setToDraft(e.target.value)}
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
      </div>

      <div className="inv-toolbar">
        <div className="search">
          <Icon name="search" />
          <input
            placeholder="Search by customer…"
            aria-label="Search by customer name"
            value={customer}
            onChange={(e) => searchCustomer(e.target.value)}
          />
        </div>
        <div className="pills">
          <button
            type="button"
            className={"pill" + (method === "all" ? " active" : "")}
            onClick={() => pickMethod("all")}
          >
            All methods
          </button>
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              className={"pill" + (method === m ? " active" : "")}
              onClick={() => pickMethod(m)}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="sales-summary">
        <div className="ss-stat">
          <span className="k">Sales</span>
          <span className="v tnum">{summary.count}</span>
        </div>
        <div className="ss-stat">
          <span className="k">Total</span>
          <span className="v tnum">{format(summary.totalPesewas)}</span>
        </div>
        <span className="ss-range text-muted">{rangeText(dateWindow)}</span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-ico">
              <Icon name="sales" />
            </div>
            <div className="h3">No sales found</div>
            <p>{rows.length === 0 ? "No completed sales in this period yet." : "No sales match these filters. Try a different method, customer, or date range."}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  {showShop && <th>Shop</th>}
                  <th>Seller</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Payment</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr
                    key={row.id}
                    className="sale-row"
                    onClick={() => router.push(`/sales/${row.id}`)}
                  >
                    <td>
                      <div className="it-name">{row.date}</div>
                      <div className="it-attr">{row.time}</div>
                    </td>
                    {showShop && <td>{row.shopName}</td>}
                    <td>{row.sellerName}</td>
                    <td className={row.customer ? undefined : "text-muted"}>
                      {row.customer ?? "—"}
                    </td>
                    <td className="text-muted">
                      {row.itemCount} {row.itemCount === 1 ? "item" : "items"}
                    </td>
                    <td>
                      {row.methods.map((m) => (
                        <span key={m} className="chip chip-neutral" style={{ marginRight: 4 }}>
                          {METHOD_LABEL[m]}
                        </span>
                      ))}
                    </td>
                    <td className="num tnum">
                      <Link href={`/sales/${row.id}`} onClick={(e) => e.stopPropagation()}>
                        {format(row.totalPesewas)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {filtered.length > visible && (
        <div className="load-more">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
          >
            Load more ({filtered.length - visible} more)
          </button>
        </div>
      )}
    </>
  );
}

/** Human range, e.g. "5 Jun 2026" (single day) or "7 May – 5 Jun 2026". */
function rangeText(win: { fromDate: string; toDate: string }): string {
  if (win.fromDate === win.toDate) return prettyDate(win.fromDate);
  return `${prettyDate(win.fromDate)} – ${prettyDate(win.toDate)}`;
}

/** "2026-06-05" → "5 Jun 2026" (the dates are already UTC calendar days). */
function prettyDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
