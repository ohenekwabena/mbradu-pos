"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/icon";
import { type Category } from "@/lib/catalog";
import { format, tryParse } from "@/lib/money";
import { changeDue, METHOD_LABEL, PAYMENT_METHODS, saleTotal, type PaymentMethod } from "@/lib/sale";

import { completeSale, type SaleFormState } from "./actions";

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

const INITIAL: SaleFormState = { status: "idle" };

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
 * shows the change for the cash portion. Completing submits the cart + payments
 * to {@link completeSale}, which writes the sale atomically and redirects to the
 * receipt.
 */
export function SellView({
  shopName,
  items,
  lowThreshold,
}: {
  shopName: string;
  items: SellItem[];
  lowThreshold: number;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [customer, setCustomer] = useState("");
  const [methods, setMethods] = useState<PaymentMethod[]>(["cash"]);
  const [amounts, setAmounts] = useState<Partial<Record<PaymentMethod, string>>>({});
  const [tendered, setTendered] = useState("");
  const [state, formAction, pending] = useActionState(completeSale, INITIAL);
  // On narrow screens the cart is a bottom sheet (see .cart-fab / .cart-open in
  // globals.css); on wider screens it's the always-open sticky sidebar and this
  // flag is inert.
  const [cartOpen, setCartOpen] = useState(false);

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
    return items.filter(
      (item) =>
        (filter === "all" || item.category === filter) &&
        (q === "" || item.name.toLowerCase().includes(q)),
    );
  }, [items, query, filter]);

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
    if (item.stock <= 0) return;
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

  const cartPayload = JSON.stringify(lines.map((line) => ({ itemId: line.item.id, quantity: line.qty })));
  const paymentsPayload = JSON.stringify(
    methods.map((method) => ({ method, amount: sole ? soleAmount : amounts[method] ?? "" })),
  );

  const remainingLabel = remaining > 0 ? "Remaining" : remaining < 0 ? "Over by" : "Balanced";
  const remainingColor =
    remaining > 0 ? "var(--warning-ink)" : remaining < 0 ? "var(--danger)" : "var(--success)";

  return (
    <>
      <div className="scope-note">
        <Icon name="store" /> Ringing up at <strong>{shopName}</strong> — a sale belongs to one shop.
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
                {items.length === 0 ? `${shopName} carries no items yet` : "No items match these filters"}
              </p>
              <p className="caption" style={{ marginTop: 4 }}>
                {items.length === 0
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
                        disabled={oos}
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
                      disabled={oos}
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
        <form action={formAction} className={"card cart" + (cartOpen ? " cart-open" : "")}>
          <input type="hidden" name="cart" value={cartPayload} />
          <input type="hidden" name="payments" value={paymentsPayload} />

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

          {state.status === "error" && (
            <p className="err" style={{ marginTop: 12 }}>
              <Icon name="alert" /> {state.message}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg mt-8"
            disabled={!canComplete || pending}
          >
            {pending ? "Completing…" : "Complete sale"}
          </button>
          {cart.size > 0 && total > 0 && remaining !== 0 && (
            <p className="caption text-faint" style={{ marginTop: 8, textAlign: "center" }}>
              {remaining > 0
                ? `Add ${format(remaining)} more to balance the payment.`
                : `Payment is ${format(-remaining)} over the total.`}
            </p>
          )}
        </form>
      </div>

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
