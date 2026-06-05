"use client";

import { useActionState, useMemo, useState } from "react";

import { Icon } from "@/components/icon";
import { type Category } from "@/lib/catalog";
import { format, tryParse } from "@/lib/money";
import { changeDue, saleTotal } from "@/lib/sale";

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

/**
 * The cash sell screen: a searchable, category-filtered catalogue of the Shop's
 * carried Items on the left, and a sticky cart on the right with quantity
 * steppers, a live running total, an optional customer name, the cash tendered,
 * and the change due. Quantities are capped at each Item's on-hand stock (the
 * no-oversell guard, also enforced by the Sale-builder and the DB). Completing
 * submits the cart to {@link completeSale}, which writes the sale atomically and
 * redirects to the receipt. MP-22.
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
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [customer, setCustomer] = useState("");
  const [tendered, setTendered] = useState("");
  const [state, formAction, pending] = useActionState(completeSale, INITIAL);

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
  const tenderedPesewas = tryParse(tendered) ?? 0;
  const change = changeDue(total, tenderedPesewas); // signed: > 0 is change owed
  const canComplete = cart.size > 0 && total > 0 && tenderedPesewas >= total;

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

  const cartPayload = JSON.stringify(lines.map((line) => ({ itemId: line.item.id, quantity: line.qty })));

  return (
    <>
      <div className="scope-note">
        <Icon name="store" /> Ringing up at <strong>{shopName}</strong> — a sale belongs to one shop.
      </div>

      <div className="sell">
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
          ) : (
            <div className="item-grid">
              {visible.map((item) => {
                const oos = item.stock <= 0;
                const chip = oos
                  ? "chip-danger"
                  : item.stock <= lowThreshold
                    ? "chip-warning"
                    : "chip-success";
                return (
                  <div key={item.id} className={"item-card" + (oos ? " oos" : "")}>
                    <div className="thumb">
                      <Icon name="box" />
                    </div>
                    <div className="name">{item.name}</div>
                    {item.subline && <div className="attr">{item.subline}</div>}
                    <div className="row" style={{ marginTop: 8 }}>
                      <span className={"chip " + chip}>{oos ? "Out of stock" : `${item.stock} left`}</span>
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
          )}
        </section>

        {/* Current sale — the cart is the form that completes the sale */}
        <form action={formAction} className="card cart">
          <input type="hidden" name="cart" value={cartPayload} />

          <div className="card-head" style={{ marginBottom: 10 }}>
            <h2 className="h2">Current sale</h2>
            <span className="caption text-faint">
              {cart.size} {cart.size === 1 ? "item" : "items"}
            </span>
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

          {/* Cash payment (MP-22). Split & multi-method payments arrive in MP-23. */}
          <div className="overline text-faint" style={{ margin: "4px 0 8px" }}>
            Payment · Cash
          </div>
          <div className="pay-row">
            <label htmlFor="tendered">Tendered</label>
            <input
              id="tendered"
              className="input tnum"
              name="tendered"
              inputMode="decimal"
              placeholder="0.00"
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
            />
          </div>
          <div className="remaining">
            <span className="text-muted">Change due</span>
            <span className="num body-med" style={{ color: change > 0 ? "var(--success)" : undefined }}>
              {format(change > 0 ? change : 0)}
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
          {cart.size > 0 && total > 0 && tenderedPesewas < total && (
            <p className="caption text-faint" style={{ marginTop: 8, textAlign: "center" }}>
              Enter cash of at least {format(total)} to complete.
            </p>
          )}
        </form>
      </div>
    </>
  );
}
