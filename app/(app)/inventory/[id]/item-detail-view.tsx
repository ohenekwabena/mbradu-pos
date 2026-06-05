"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/icon";
import {
  ATTRIBUTE_FIELDS,
  CATEGORY_LABEL,
  formatExpiry,
  type Attributes,
  type Category,
} from "@/lib/catalog";
import { format } from "@/lib/money";
import { type StockReason } from "@/lib/stock";

import { CorrectionModal, RestockModal, type CarriedStock } from "../stock-modals";

export interface ItemDetail {
  id: string;
  category: Category;
  name: string;
  /** Selling price in pesewas. */
  price: number;
  /** Cost in pesewas, or `null` when masked (non-owner — but this page is
   * Owner-only, so in practice always present). */
  cost: number | null;
  attributes: Attributes;
}

/** One row of the movement ledger, prepared server-side (names resolved, the
 * per-Shop running balance attached). */
export interface LedgerEntry {
  id: string;
  shopId: string;
  shopName: string;
  reason: StockReason;
  /** Signed: restock `> 0`, sale `< 0`, correction either way. */
  amount: number;
  /** Free-text note / reason, or `null`. */
  note: string | null;
  actorName: string | null;
  saleId: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** The Shop's quantity *after* this movement. */
  balance: number;
}

interface Shop {
  id: string;
  name: string;
}

const REASON_META: Record<StockReason, { label: string; chip: string }> = {
  sale: { label: "Sale", chip: "chip-success" },
  restock: { label: "Restock", chip: "chip-neutral" },
  correction: { label: "Correction", chip: "chip-warning" },
};

/** "all" Shops, or a single carried Shop id. */
type LedgerFilter = "all" | string;

export function ItemDetailView({
  item,
  shops,
  carriedStock,
  ledger,
  activeShopId,
  activeShopName,
}: {
  item: ItemDetail;
  shops: Shop[];
  carriedStock: CarriedStock[];
  ledger: LedgerEntry[];
  activeShopId: string | null;
  activeShopName: string | null;
}) {
  const [showRestock, setShowRestock] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Default the ledger filter to the first carried Shop, else "all".
  const [filter, setFilter] = useState<LedgerFilter>(() => carriedStock[0]?.shopId ?? "all");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const totalOnHand = carriedStock.reduce((sum, s) => sum + s.quantity, 0);
  const canCorrect = carriedStock.length > 0;
  const showBalance = filter !== "all";

  const visibleLedger = useMemo(
    () => (filter === "all" ? ledger : ledger.filter((e) => e.shopId === filter)),
    [ledger, filter],
  );

  function onActionSaved(message: string) {
    setShowRestock(false);
    setShowCorrection(false);
    setToast(message);
  }

  const marginPct = item.cost != null && item.price > 0
    ? Math.round(((item.price - item.cost) / item.price) * 100)
    : null;

  return (
    <>
      <Link className="crumb" href="/inventory">
        <Icon name="back" /> Inventory
      </Link>

      <div className="card">
        <div className="summary">
          <div>
            <div className="row gap-12" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <h2 className="h2">{item.name}</h2>
              <span className="chip chip-neutral">{CATEGORY_LABEL[item.category]}</span>
            </div>
            <div className="specs">
              <Spec k="Selling price" v={format(item.price)} />
              {item.cost != null && <Spec k="Cost" v={format(item.cost)} muted />}
              {marginPct != null && <Spec k="Margin" v={`${marginPct}%`} good />}
              <Spec k="Total on hand" v={String(totalOnHand)} />
              {attributeSpecs(item).map((s) => (
                <Spec key={s.k} k={s.k} v={s.v} />
              ))}
            </div>
          </div>
          <div className="row gap-8" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-primary" onClick={() => setShowRestock(true)}>
              <Icon name="restock" /> Restock
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowCorrection(true)}
              disabled={!canCorrect}
              title={canCorrect ? undefined : "Restock first to start carrying this item"}
            >
              Correction
            </button>
          </div>
        </div>
      </div>

      <div className="card section">
        <div className="card-head" style={{ marginBottom: 14 }}>
          <h2 className="h2">Stock by shop</h2>
          <span className="caption text-faint">
            Catalog &amp; price are business-wide; stock is per shop.
          </span>
        </div>
        <div className="shop-stock">
          {shops.map((s) => {
            const carried = carriedStock.find((c) => c.shopId === s.id);
            return (
              <div key={s.id} className={"ss-card" + (carried ? "" : " nc")}>
                <div className="nm">
                  <Icon name="store" /> {s.name}
                </div>
                <div className="q">{carried ? carried.quantity : "Not carried"}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card section" style={{ padding: 0 }}>
        <div className="card-head" style={{ padding: "20px 24px 0", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 className="h2">Stock movements</h2>
            <span className="caption text-faint">
              Append-only ledger — the source of truth for quantity.
            </span>
          </div>
          {carriedStock.length > 0 && (
            <div className="pills">
              <button
                type="button"
                className={"pill" + (filter === "all" ? " active" : "")}
                onClick={() => setFilter("all")}
              >
                All shops
              </button>
              {carriedStock.map((s) => (
                <button
                  key={s.shopId}
                  type="button"
                  className={"pill" + (filter === s.shopId ? " active" : "")}
                  onClick={() => setFilter(s.shopId)}
                >
                  {s.shopName}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date &amp; time</th>
                <th>Shop</th>
                <th>Reason</th>
                <th>Actor</th>
                <th className="num">Amount</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {visibleLedger.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty" style={{ padding: "28px 0" }}>
                      <div className="empty-ico">
                        <Icon name="history" />
                      </div>
                      <p className="body-med" style={{ margin: 0 }}>
                        No movements yet
                      </p>
                      <p className="caption" style={{ marginTop: 4 }}>
                        Record a restock to start this item&rsquo;s ledger.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                visibleLedger.map((e) => (
                  <tr key={e.id}>
                    <td className="text-muted tnum">{formatDateTime(e.createdAt)}</td>
                    <td>{e.shopName}</td>
                    <td>
                      <span className={"chip " + REASON_META[e.reason].chip}>
                        {REASON_META[e.reason].label}
                      </span>
                      {e.note && <div className="it-attr">{e.note}</div>}
                    </td>
                    <td>{e.actorName ?? <span className="text-faint">—</span>}</td>
                    <td
                      className={
                        "num tnum mv-amt " + (e.amount > 0 ? "pos" : e.amount < 0 ? "neg" : "")
                      }
                    >
                      {e.amount > 0 ? "+" : ""}
                      {e.amount}
                    </td>
                    <td className="num tnum">
                      {showBalance ? e.balance : <span className="text-faint">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showRestock && (
        <RestockModal
          item={item}
          shops={shops}
          activeShopId={activeShopId}
          activeShopName={activeShopName}
          onClose={() => setShowRestock(false)}
          onSaved={onActionSaved}
        />
      )}

      {showCorrection && canCorrect && (
        <CorrectionModal
          item={item}
          carriedShops={carriedStock}
          activeShopId={activeShopId}
          onClose={() => setShowCorrection(false)}
          onSaved={onActionSaved}
        />
      )}

      {toast && (
        <div className="toast success" role="status">
          <span className="ico">
            <Icon name="check" />
          </span>
          <span className="body-med">{toast}</span>
        </div>
      )}
    </>
  );
}

/** One labelled spec cell in the item summary. `muted` greys cost; `good` tints
 * the margin green (design — Item detail). */
function Spec({ k, v, muted, good }: { k: string; v: string; muted?: boolean; good?: boolean }) {
  return (
    <div className="s">
      <div className="k">{k}</div>
      <div
        className={"v" + (muted ? " text-muted" : "")}
        style={good ? { color: "var(--success)" } : undefined}
      >
        {v}
      </div>
    </div>
  );
}

/** Category-specific spec cells from the Item's attributes, in field order, with
 * the cosmetic expiry rendered (e.g. "31 Dec 2026"). */
function attributeSpecs(item: ItemDetail): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = [];
  for (const field of ATTRIBUTE_FIELDS[item.category]) {
    const raw = item.attributes[field.key];
    if (!raw) continue;
    out.push({ k: field.label, v: field.key === "expiry" ? formatExpiry(raw) : raw });
  }
  return out;
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * ISO timestamp → "5 Jun · 2:14 PM" for the ledger. Formatted from UTC parts by
 * hand (not `toLocale*`) so the server-rendered and hydrated output always match
 * — locale/timezone-dependent formatting would risk a hydration mismatch. The
 * business runs in Ghana (GMT), so UTC is the local wall-clock time.
 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const month = MONTH_ABBR[d.getUTCMonth()];
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const hours24 = d.getUTCHours();
  const meridiem = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${day} ${month} · ${hours12}:${minutes} ${meridiem}`;
}
