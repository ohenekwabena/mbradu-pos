"use client";

import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { Icon } from "@/components/icon";
import { Receipt, type ReceiptData } from "@/components/receipt";
import { type Category } from "@/lib/catalog";
import { format, tryParse } from "@/lib/money";
import { applyPrices, priceChange, type PriceChange } from "@/lib/price-change";
import {
  ATTEMPT_TIMEOUT_MS,
  IDLE,
  isInFlight,
  isLocked,
  pendingSaleReducer,
  sendWithRetry,
  type AttemptResult,
} from "@/lib/pending-sale";
import {
  changeDue,
  METHOD_LABEL,
  parseSaleInput,
  PAYMENT_METHODS,
  saleTotal,
  type PaymentMethod,
  type SaleWrite,
} from "@/lib/sale";
import { saleErrorMessage } from "@/lib/sale-errors";
import { createClient } from "@/lib/supabase/client";

/** One sellable Item at the current Shop: the catalog facts plus the live on-hand
 * `stock` (it's carried here, possibly 0). */
export interface SellItem {
  id: string;
  category: Category;
  name: string;
  subline: string;
  /** Selling price in pesewas. */
  price: number;
  /** Quantity on hand at this Shop. */
  stock: number;
}

type CategoryFilter = "all" | Category;

const FILTERS: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "wig", label: "Wigs" },
  { key: "cosmetic", label: "Cosmetics" },
  { key: "wig_tool", label: "Wig Tools" },
];

interface CartLine {
  item: SellItem;
  qty: number;
}

/** A validated checkout, frozen while it's pending so every retry resends the
 * exact same Sale under the same id. */
interface Checkout extends SaleWrite {
  saleId: string;
  /** What the cashier saw per line, for the inline receipt. */
  display: { itemId: string; name: string; quantity: number; unitPrice: number }[];
}

/** One attempt: call `complete_sale` straight from the phone (no server hop),
 * bounded by a timeout so a hung mobile connection fails over to a retry. */
async function attemptSale(checkout: Checkout): Promise<AttemptResult> {
  const { data, error } = await createClient()
    .rpc("complete_sale", {
      p_sale_id: checkout.saleId,
      p_shop_id: checkout.shopId,
      p_customer: checkout.customer ?? "",
      p_lines: checkout.lines,
      p_payments: checkout.payments,
      p_expected_total: checkout.total,
    })
    .abortSignal(AbortSignal.timeout(ATTEMPT_TIMEOUT_MS));
  return error ? { ok: false, error } : { ok: true, saleId: data as string };
}

/** The permanent receipt page, carrying the cash tendered (not persisted) for
 * the change line when cash was taken. */
function receiptHref(saleId: string, checkout: Checkout): string {
  const hasCash = checkout.payments.some((payment) => payment.method === "cash");
  return hasCash ? `/sales/${saleId}?tendered=${checkout.tendered}` : `/sales/${saleId}`;
}

/** The inline receipt for a confirmed checkout. `complete_sale` only confirms a
 * Sale whose server total equals what the cashier was shown (price_changed
 * otherwise), so the displayed lines are the Sale's lines. */
function receiptFor(
  checkout: Checkout,
  shop: ReceiptData["shop"],
  sellerName: string | null,
  createdAt: Date,
): ReceiptData {
  const hasCash = checkout.payments.some((payment) => payment.method === "cash");
  return {
    shop,
    createdAt,
    sellerName,
    customerName: checkout.customer,
    lines: checkout.display.map((line) => ({ ...line, key: line.itemId })),
    total: checkout.total,
    payments: checkout.payments.map((payment) => ({
      key: payment.method,
      method: payment.method,
      amount: payment.amount_pesewas,
    })),
    change: hasCash ? checkout.change : null,
  };
}

/** Take a confirmed Sale's quantities off the screen's own stock figures, so the
 * catalogue stays right without reloading it. */
export function deductSold(items: readonly SellItem[], sold: readonly { item_id: string; quantity: number }[]): SellItem[] {
  const byId = new Map<string, number>();
  for (const line of sold) byId.set(line.item_id, (byId.get(line.item_id) ?? 0) + line.quantity);
  return items.map((item) =>
    byId.has(item.id) ? { ...item, stock: Math.max(0, item.stock - (byId.get(item.id) as number)) } : item,
  );
}

/** Render integer pesewas as a plain decimal (no symbol, no grouping) for an
 * amount input — round-trips through {@link tryParse} exactly. */
function plainAmount(pesewas: number): string {
  return format(pesewas, { symbol: false, grouping: false });
}

/** The stock chip's tone and label for an Item — shared by the card and list
 * views so both read the same: out of stock (danger), at/under the low
 * threshold (warning), otherwise healthy (success). */
function stockChipClass(stock: number, lowThreshold: number): string {
  if (stock <= 0) return "chip-danger";
  return stock <= lowThreshold ? "chip-warning" : "chip-success";
}
function stockLabel(stock: number): string {
  return stock <= 0 ? "Out of stock" : `${stock} left`;
}

/**
 * The sell screen: a searchable, category-filtered catalogue of the Shop's
 * carried Items on the left, and a sticky cart on the right with quantity
 * steppers, a live running total, an optional customer name, and the payment
 * panel. Quantities are capped at each Item's on-hand stock (the no-oversell
 * guard, also enforced by the Sale-builder and the DB).
 *
 * Payment (MP-23) splits across one or more methods — Cash / MoMo / Card /
 * Transfer — whose amounts must **sum to the total** before the sale can
 * complete (the live Remaining / Over by / Balanced indicator). One method
 * auto-fills to the whole total; Cash additionally takes a tendered amount and
 * shows the change for the cash portion.
 *
 * Completing (ADR-0008, #28) validates on the phone, then calls `complete_sale`
 * **directly** — one request, no server action. The checkout is then a **pending
 * Sale**: the cart locks, transient failures retry automatically under the same
 * Sale id (idempotent, so never booked twice), a business rejection unlocks the
 * cart with a plain-English message, and if retries run out the cashier gets
 * *Still sending… Retry*. Only one pending Sale exists at a time.
 *
 * A confirmed Sale shows its receipt **in place** (#29) — no navigation — and
 * *New sale* starts the next checkout with no network request. The catalogue is
 * loaded once per visit; sold quantities come off the screen's own stock.
 */
export function SellView({
  shopId,
  shopName,
  receiptShop,
  sellerName,
  items,
  lowThreshold,
}: {
  shopId: string;
  shopName: string;
  receiptShop: ReceiptData["shop"];
  sellerName: string | null;
  items: SellItem[];
  lowThreshold: number;
}) {
  // The screen's own copy of the catalogue: loaded once, then kept current
  // locally (sold quantities deducted) across Sale after Sale.
  const [catalog, setCatalog] = useState(items);
  const [receipt, setReceipt] = useState<{ data: ReceiptData; href: string } | null>(null);
  // Prices moved since this screen loaded: what changed, awaiting the cashier's
  // confirmation before the Sale can be resent (#30).
  const [priceDialog, setPriceDialog] = useState<PriceChange | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [customer, setCustomer] = useState("");
  const [methods, setMethods] = useState<PaymentMethod[]>(["cash"]);
  const [amounts, setAmounts] = useState<Partial<Record<PaymentMethod, string>>>({});
  const [tendered, setTendered] = useState("");
  const [sale, dispatch] = useReducer(pendingSaleReducer, IDLE);
  const [inputError, setInputError] = useState<string | null>(null);
  // The Sale's id: minted on the first Complete tap and kept across retries and
  // re-submits, so an attempt that landed without an answer can never be booked
  // twice. Minted at submit (not during render) so server and client markup
  // agree. A completed Sale navigates to its receipt, unmounting this screen, so
  // the next checkout starts with a fresh id.
  const saleIdRef = useRef<string | null>(null);
  // The checkout being sent, frozen so Retry resends exactly the same Sale.
  const checkoutRef = useRef<Checkout | null>(null);
  const locked = isLocked(sale);
  const inFlight = isInFlight(sale);
  // On narrow screens the cart is a bottom sheet (see .cart-fab / .cart-open in
  // globals.css); on wider screens it's the always-open sticky sidebar and this
  // flag is inert.
  const [cartOpen, setCartOpen] = useState(false);

  // Leaving the page with an unconfirmed Sale would abandon it mid-flight.
  useEffect(() => {
    if (!locked || sale.status === "completed") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [locked, sale.status]);

  // While the sheet is up, lock the page behind it and let Escape dismiss it.
  useEffect(() => {
    if (!cartOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCartOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [cartOpen]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter(
      (item) =>
        (filter === "all" || item.category === filter) &&
        (q === "" || item.name.toLowerCase().includes(q)),
    );
  }, [catalog, query, filter]);

  const lines = [...cart.values()];
  const total = saleTotal(lines.map((line) => ({ unitPrice: line.item.price, quantity: line.qty })));

  // A single chosen method settles the whole total, so its amount is derived from
  // the cart (shown read-only) — the cashier never types it, and it stays live as
  // the cart changes with no effect. With two or more methods each amount is
  // entered and they must sum to the total.
  const sole = methods.length === 1;
  const soleAmount = total > 0 ? plainAmount(total) : "";
  const amountPesewas = (method: PaymentMethod) =>
    sole ? total : tryParse(amounts[method] ?? "") ?? 0;
  const paid = methods.reduce((s, method) => s + amountPesewas(method), 0);
  const remaining = total - paid; // > 0 owed, < 0 over, 0 balanced
  const cashApplied = methods.includes("cash") ? amountPesewas("cash") : 0;
  const tenderedPesewas = tryParse(tendered) ?? 0;
  const change = Math.max(0, changeDue(cashApplied, tenderedPesewas));
  const canComplete = cart.size > 0 && total > 0 && remaining === 0;

  function addItem(item: SellItem) {
    if (item.stock <= 0 || locked) return;
    setCart((prev) => {
      const next = new Map(prev);
      const line = next.get(item.id);
      next.set(item.id, { item, qty: Math.min((line?.qty ?? 0) + 1, item.stock) });
      return next;
    });
  }
  function setQty(id: string, qty: number) {
    setCart((prev) => {
      const line = prev.get(id);
      if (!line) return prev;
      const next = new Map(prev);
      const clamped = Math.max(0, Math.min(qty, line.item.stock));
      if (clamped === 0) next.delete(id);
      else next.set(id, { ...line, qty: clamped });
      return next;
    });
  }

  function toggleMethod(method: PaymentMethod) {
    if (methods.includes(method)) {
      if (methods.length === 1) return; // a sale always has at least one method
      setMethods(methods.filter((m) => m !== method));
      setAmounts((prev) => {
        const next = { ...prev };
        delete next[method];
        return next;
      });
    } else {
      // Leaving single-method mode: seed the existing method with the full total
      // so the split starts balanced, then the cashier adjusts from there.
      if (sole) {
        const [current] = methods;
        setAmounts((prev) => ({ ...prev, [current]: soleAmount }));
      }
      setMethods([...methods, method]);
    }
  }

  const itemName = (id: string) => catalog.find((item) => item.id === id)?.name;

  /** Send the frozen checkout until it resolves; navigate on a confirmed Sale. */
  async function send(checkout: Checkout) {
    const final = await sendWithRetry(() => attemptSale(checkout), dispatch);
    if (final.type === "completed") {
      setReceipt({
        data: receiptFor(checkout, receiptShop, sellerName, new Date()),
        href: receiptHref(final.saleId, checkout),
      });
      setCatalog((prev) => deductSold(prev, checkout.lines));
      setCartOpen(false);
    } else if (final.type === "rejected" && final.error.code === "sale_id_conflict") {
      saleIdRef.current = null; // that id is unusable; the next attempt mints another
    } else if (final.type === "rejected" && final.error.code === "price_changed" && final.error.prices) {
      // Nothing was written. Adopt the server's prices on screen (catalogue and
      // cart) and ask the cashier to confirm the new total before resending.
      const current = final.error.prices;
      setCatalog((prev) => applyPrices(prev, current));
      setCart((prev) => {
        const next = new Map(prev);
        for (const [id, line] of prev) next.set(id, { ...line, item: applyPrices([line.item], current)[0] });
        return next;
      });
      setPriceDialog(priceChange(checkout.display, current));
    }
  }

  /** Confirm the new prices. One payment method follows the total by itself, so
   * the Sale is resent straight away (same Sale id, new expected total); a split
   * goes back to the cart for the cashier to rebalance. */
  function confirmNewPrices() {
    setPriceDialog(null);
    if (methods.length === 1) complete();
  }

  function complete() {
    if (locked) return;
    setInputError(null);
    const parsed = parseSaleInput({
      shopId,
      customer,
      lines: lines.map((line) => ({
        itemId: line.item.id,
        name: line.item.name,
        quantity: line.qty,
        unitPrice: line.item.price,
        available: line.item.stock,
      })),
      payments: methods.map((method) => ({ method, amount: sole ? soleAmount : amounts[method] ?? "" })),
      tendered,
    });
    if (!parsed.ok) {
      setInputError(parsed.error);
      return;
    }
    saleIdRef.current ??= crypto.randomUUID();
    const checkout: Checkout = {
      ...parsed.value,
      saleId: saleIdRef.current,
      display: lines.map((line) => ({
        itemId: line.item.id,
        name: line.item.name,
        quantity: line.qty,
        unitPrice: line.item.price,
      })),
    };
    checkoutRef.current = checkout;
    void send(checkout);
  }

  /** Clear the receipt and start a fresh checkout — no network request. */
  function startNewSale() {
    setReceipt(null);
    setCart(new Map());
    setCustomer("");
    setMethods(["cash"]);
    setAmounts({});
    setTendered("");
    setInputError(null);
    saleIdRef.current = null;
    checkoutRef.current = null;
    dispatch({ type: "reset" });
  }

  function retry() {
    if (sale.status !== "stalled" || !checkoutRef.current) return;
    void send(checkoutRef.current);
  }

  const errorMessage = priceDialog
    ? null
    : inputError ?? (sale.status === "rejected" ? saleErrorMessage(sale.error, itemName) : null);
  const buttonLabel =
    sale.status === "sending" && sale.attempt > 1
      ? `Retrying… (${sale.attempt} of ${sale.of})`
      : sale.status === "waiting"
        ? "Connection slow — retrying…"
        : inFlight
            ? "Completing…"
            : "Complete sale";

  const remainingLabel = remaining > 0 ? "Remaining" : remaining < 0 ? "Over by" : "Balanced";
  const remainingColor =
    remaining > 0 ? "var(--warning-ink)" : remaining < 0 ? "var(--danger)" : "var(--success)";

  if (receipt) {
    return (
      <div className="receipt-wrap">
        <div className="receipt-actions no-print">
          <button type="button" className="btn btn-primary" onClick={startNewSale} autoFocus>
            New sale
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
            <Icon name="print" /> Print receipt
          </button>
          <Link className="btn btn-ghost" href={receipt.href}>
            Open receipt
          </Link>
        </div>
        <Receipt data={receipt.data} />
      </div>
    );
  }

  return (
    <>
      <div className="scope-note">
        <Icon name="store" />
        <span>
          Ringing up at <strong>{shopName}</strong> — a sale belongs to one shop.
        </span>
      </div>

      <div className={"sell" + (cart.size > 0 ? " has-fab" : "")}>
        {/* Catalogue — only the Items this Shop carries */}
        <section>
          <div className="cat-toolbar">
            <div className="search">
              <Icon name="search" />
              <input
                placeholder="Search items by name…"
                aria-label="Search items"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="pills">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={"pill" + (filter === f.key ? " active" : "")}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="seg-tabs view-toggle" role="group" aria-label="Item view">
              <button
                type="button"
                className={"pill icon-pill" + (view === "grid" ? " active" : "")}
                aria-pressed={view === "grid"}
                aria-label="Card view"
                title="Card view"
                onClick={() => setView("grid")}
              >
                <Icon name="grid" />
              </button>
              <button
                type="button"
                className={"pill icon-pill" + (view === "list" ? " active" : "")}
                aria-pressed={view === "list"}
                aria-label="List view"
                title="List view"
                onClick={() => setView("list")}
              >
                <Icon name="list" />
              </button>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              <div className="empty-ico">
                <Icon name="box" />
              </div>
              <p className="body-med" style={{ margin: 0 }}>
                {catalog.length === 0 ? `${shopName} carries no items yet` : "No items match these filters"}
              </p>
              <p className="caption" style={{ marginTop: 4 }}>
                {catalog.length === 0
                  ? "Stock items into this shop from Inventory to start selling."
                  : "Try a different search or category."}
              </p>
            </div>
          ) : view === "grid" ? (
            <div className="item-grid">
              {visible.map((item) => {
                const oos = item.stock <= 0;
                return (
                  <div key={item.id} className={"item-card" + (oos ? " oos" : "")}>
                    <div className="name">{item.name}</div>
                    {item.subline && <div className="attr">{item.subline}</div>}
                    <div className="row" style={{ marginTop: 8 }}>
                      <span className={"chip " + stockChipClass(item.stock, lowThreshold)}>
                        {stockLabel(item.stock)}
                      </span>
                    </div>
                    <div className="price-row">
                      <span className="price">{format(item.price)}</span>
                      <button
                        type="button"
                        className="add"
                        aria-label={`Add ${item.name}`}
                        disabled={oos || locked}
                        onClick={() => addItem(item)}
                      >
                        <Icon name={oos ? "x" : "plus"} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="item-list">
              {visible.map((item) => {
                const oos = item.stock <= 0;
                return (
                  <div key={item.id} className={"item-row" + (oos ? " oos" : "")}>
                    <div className="ir-name">
                      <div className="name">{item.name}</div>
                      {item.subline && <div className="attr">{item.subline}</div>}
                    </div>
                    <span className={"chip " + stockChipClass(item.stock, lowThreshold)}>
                      {stockLabel(item.stock)}
                    </span>
                    <span className="price">{format(item.price)}</span>
                    <button
                      type="button"
                      className="add"
                      aria-label={`Add ${item.name}`}
                      disabled={oos || locked}
                      onClick={() => addItem(item)}
                    >
                      <Icon name={oos ? "x" : "plus"} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Current sale — the cart is the form that completes the sale */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            complete();
          }}
          className={"card cart" + (cartOpen ? " cart-open" : "")}
          aria-busy={inFlight}
        >
          {/* Bottom-sheet grab handle — desktop-hidden (sidebar needs no handle) */}
          <div className="sheet-handle" aria-hidden="true" />

          <div className="card-head" style={{ marginBottom: 10 }}>
            <h2 className="h2">Current sale</h2>
            <div className="ch-right">
              <span className="caption text-faint">
                {cart.size} {cart.size === 1 ? "item" : "items"}
              </span>
              <button
                type="button"
                className="icon-btn cart-close"
                aria-label="Close sale panel"
                onClick={() => setCartOpen(false)}
              >
                <Icon name="x" />
              </button>
            </div>
          </div>

          {/* Everything editable freezes while a Sale is pending (one at a time). */}
          <fieldset disabled={locked} className="cart-fields">
            <div className="field" style={{ marginBottom: 12 }}>
              <input
                className="input"
                name="customer"
                placeholder="Customer name (optional)"
                aria-label="Customer name"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              />
            </div>

            <div className="lines">
              {cart.size === 0 ? (
                <div className="cart-empty">Search to add items to the sale.</div>
              ) : (
                lines.map(({ item, qty }) => (
                  <div key={item.id} className="line">
                    <div className="ln-name">
                      <div className="nm">{item.name}</div>
                      <div className="up tnum">{format(item.price)} ea</div>
                    </div>
                    <div className="stepper">
                      <button type="button" aria-label={`Decrease ${item.name}`} onClick={() => setQty(item.id, qty - 1)}>
                        −
                      </button>
                      <span className="val">{qty}</span>
                      <button
                        type="button"
                        aria-label={`Increase ${item.name}`}
                        disabled={qty >= item.stock}
                        onClick={() => setQty(item.id, qty + 1)}
                      >
                        +
                      </button>
                    </div>
                    <div className="ln-total tnum">{format(item.price * qty)}</div>
                  </div>
                ))
              )}
            </div>

            <div className="grand">
              <span className="text-muted body-med">Total</span>
              <span className="gv" aria-live="polite">
                {format(total)}
              </span>
            </div>

            {/* Payment — split across one or more methods, summing to the total (MP-23) */}
            <div className="overline text-faint" style={{ margin: "4px 0 8px" }}>
              Payment
            </div>
            <div className="pay-methods">
              {PAYMENT_METHODS.map((method) => {
                const active = methods.includes(method);
                return (
                  <button
                    key={method}
                    type="button"
                    className={"pill" + (active ? " active" : "")}
                    aria-pressed={active}
                    onClick={() => toggleMethod(method)}
                  >
                    {METHOD_LABEL[method]}
                  </button>
                );
              })}
            </div>

            {methods.map((method) => (
              <div key={method}>
                <div className="pay-row">
                  <label htmlFor={`pay-${method}`}>{METHOD_LABEL[method]}</label>
                  <input
                    id={`pay-${method}`}
                    className="input tnum"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={sole ? soleAmount : amounts[method] ?? ""}
                    readOnly={sole}
                    aria-readonly={sole}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [method]: e.target.value }))}
                  />
                </div>
                {method === "cash" && (
                  <>
                    <div className="pay-row">
                      <label htmlFor="tendered">Tendered</label>
                      <input
                        id="tendered"
                        name="tendered"
                        className="input tnum"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={tendered}
                        onChange={(e) => setTendered(e.target.value)}
                      />
                    </div>
                    <div className="remaining" style={{ paddingTop: 0 }}>
                      <span className="text-muted">Change due</span>
                      <span className="num body-med" style={{ color: change > 0 ? "var(--success)" : undefined }}>
                        {format(change)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}

            <div className="remaining">
              <span className="text-muted">{remainingLabel}</span>
              <span className="num body-med" aria-live="polite" style={{ color: remainingColor }}>
                {format(remaining < 0 ? -remaining : remaining)}
              </span>
            </div>

          </fieldset>

          {errorMessage && (
            <p className="err" role="alert" style={{ marginTop: 12 }}>
              <Icon name="alert" /> {errorMessage}
            </p>
          )}

          {sale.status === "stalled" ? (
            <>
              <p className="notice" role="status" style={{ marginTop: 12 }}>
                <Icon name="alert" /> Still sending — the connection is slow. Tap Retry; this sale
                won’t be recorded twice.
              </p>
              <button type="button" className="btn btn-primary btn-block btn-lg mt-8" onClick={retry}>
                Retry
              </button>
            </>
          ) : (
            <button
              type="submit"
              className="btn btn-primary btn-block btn-lg mt-8"
              disabled={!canComplete || locked}
            >
              {buttonLabel}
            </button>
          )}
          {!locked && cart.size > 0 && total > 0 && remaining !== 0 && (
            <p className="caption text-faint" style={{ marginTop: 8, textAlign: "center" }}>
              {remaining > 0
                ? `Add ${format(remaining)} more to balance the payment.`
                : `Payment is ${format(-remaining)} over the total.`}
            </p>
          )}
        </form>
      </div>

      {priceDialog && (
        <PriceChangeDialog
          change={priceDialog}
          split={methods.length > 1}
          onConfirm={confirmNewPrices}
          onCancel={() => setPriceDialog(null)}
        />
      )}

      {/* Mobile only (CSS-gated): dim the page behind the cart sheet. */}
      {cartOpen && (
        <div className="cart-scrim" aria-hidden="true" onClick={() => setCartOpen(false)} />
      )}

      {/* Floating button that summons the cart sheet on narrow screens, carrying
          the live item count and running total so it's useful at a glance. */}
      {cart.size > 0 && !cartOpen && (
        <button
          type="button"
          className="cart-fab"
          aria-label={`View current sale: ${cart.size} ${
            cart.size === 1 ? "item" : "items"
          }, total ${format(total)}`}
          onClick={() => setCartOpen(true)}
        >
          <span className="cart-fab-ico">
            <Icon name="sell" />
            <span className="cart-fab-badge">{cart.size}</span>
          </span>
          <span className="cart-fab-label">View sale</span>
          <span className="cart-fab-total tnum">{format(total)}</span>
        </button>
      )}
    </>
  );
}

/**
 * Prices changed since the screen loaded (#30): each moved line (old → new) and
 * the new total. Confirming resends at the new total (or, for a split payment,
 * returns to the cart to rebalance); cancelling returns to the cart, which
 * already shows the new prices. Nothing is written until the cashier confirms.
 */
function PriceChangeDialog({
  change,
  split,
  onConfirm,
  onCancel,
}: {
  change: PriceChange;
  split: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Prices changed">
        <div className="m-head">
          <h3 className="h3">Prices changed</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onCancel}>
            <Icon name="x" />
          </button>
        </div>
        <div className="m-body">
          <p style={{ margin: "0 0 12px" }}>
            The Owner changed {change.changed.length === 1 ? "a price" : "some prices"} since this screen
            loaded. Nothing has been charged yet.
          </p>
          {change.changed.map((line) => (
            <div key={line.itemId} className="r-line">
              <div className="qn">
                <div className="nm">{line.name}</div>
                <div className="up tnum">
                  {line.quantity} × <s>{format(line.oldPrice)}</s> → {format(line.newPrice)}
                </div>
              </div>
            </div>
          ))}
          <div className="r-total">
            <span className="body-med">New total</span>
            <span className="tv">{format(change.newTotal)}</span>
          </div>
          <p className="caption text-faint" style={{ marginTop: 6 }}>
            Was {format(change.oldTotal)}.
            {split ? " The payment is split — adjust the amounts to the new total, then complete." : ""}
          </p>
        </div>
        <div className="m-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Back to cart
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} autoFocus>
            {split ? "Adjust payments" : `Charge ${format(change.newTotal)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
