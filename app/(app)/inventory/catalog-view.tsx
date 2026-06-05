"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/icon";
import { archiveBlockReason, canArchive } from "@/lib/archive";
import {
  ATTRIBUTE_FIELDS,
  attributeSummary,
  CATEGORIES,
  CATEGORY_LABEL,
  formatExpiry,
  type Attributes,
  type Category,
} from "@/lib/catalog";
import { format } from "@/lib/money";

import { saveItem, saveProduct, type ItemFormState } from "./actions";
import {
  DiscontinueItemModal,
  DiscontinueLineModal,
  RestoreItemButton,
} from "./archive-controls";
import { RestockModal } from "./stock-modals";

export interface CatalogItem {
  id: string;
  category: Category;
  name: string;
  /** The Product this Item groups under (cosmetic shades), or `null`. */
  productId: string | null;
  /** Selling price in pesewas. */
  price: number;
  /** Cost in pesewas, or `null` when masked (non-owner). This screen is
   * Owner-only, so in practice it's always present. */
  cost: number | null;
  attributes: Attributes;
  /** Archived/discontinued (MP-31): the row's `archived_at` is non-null. */
  archived: boolean;
}

/** A cosmetic Product line and the shade Items grouped under it — used by the
 * editor (a cosmetic is edited a whole line at a time), not the flat list. */
export interface CatalogProduct {
  id: string;
  name: string;
  brand: string | null;
  shades: CatalogItem[];
}

/** A Shop the Owner can restock into (id + name). */
export interface Shop {
  id: string;
  name: string;
}

/** The stock-status kind behind a row's chip. Maps to a chip class in
 * {@link KIND_CHIP}; the human label is built server-side (it can carry a count,
 * e.g. "2 shops low/out"). */
export type StatusKind =
  | "not-carried"
  | "out"
  | "low"
  | "in"
  | "expiring"
  | "out-everywhere"
  | "shops-low-out";

/** One Item's scope-aware stock view, precomputed server-side for the current
 * Shop context (so the client stays presentational). */
export interface ItemStock {
  /** Carried in the current scope: a row exists at this Shop (single-shop) or at
   * ≥ 1 Shop (all-shops). */
  carried: boolean;
  /** single-shop: quantity here (`null` when not carried). all-shops: total
   * across carried Shops. */
  quantity: number | null;
  /** all-shops: how many Shops carry it (for the "N of M shops" subline). */
  carriedShopCount: number;
  statusKind: StatusKind;
  statusLabel: string;
  /** Matches the "Low stock" quick filter in the current scope. */
  lowFlag: boolean;
  /** Matches the "Expiring soon" quick filter (a cosmetic within the window). */
  expiringFlag: boolean;
}

/** A catalog Item plus its scope-aware stock view — one inventory-list row. */
export interface InventoryItem extends CatalogItem {
  stock: ItemStock;
  /** Units on hand across *all* Shops (scope-independent) — gates archiving
   * (block-until-zero), a business-wide decision (MP-31). */
  totalOnHand: number;
}

/** The Owner's active Shop context, shaping the whole list (ADR-0005). */
export type InventoryScope =
  | { mode: "all"; shopCount: number }
  | { mode: "shop"; shopId: string; shopName: string };

/** Status kind → chip class (labels are supplied by the server view-model). */
const KIND_CHIP: Record<StatusKind, string> = {
  "not-carried": "chip-outline",
  out: "chip-danger",
  low: "chip-warning",
  in: "chip-success",
  expiring: "chip-accent",
  "out-everywhere": "chip-danger",
  "shops-low-out": "chip-warning",
};

type CategoryFilter = "all" | Category;

const FILTERS: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "wig", label: "Wigs" },
  { key: "cosmetic", label: "Cosmetics" },
  { key: "wig_tool", label: "Wig Tools" },
];

/** Stock-health quick filters (design — Inventory): off, or one at a time. */
type QuickFilter = "low" | "exp" | null;

/** What the editor drawer is doing: adding a fresh entry of some category, or
 * editing an existing standalone Item (wig / tool) or cosmetic Product line. */
type EditorTarget =
  | { mode: "add"; category: Category }
  | { mode: "edit-item"; item: CatalogItem }
  | { mode: "edit-product"; product: CatalogProduct };

export function CatalogView({
  items,
  products,
  shops,
  scope,
  activeShopId,
  activeShopName,
}: {
  items: InventoryItem[];
  products: CatalogProduct[];
  shops: Shop[];
  /** The Owner's active Shop context — shapes columns, status, and actions. */
  scope: InventoryScope;
  /** The active Shop id/name, or `null` on "All shops" (defaults the modals). */
  activeShopId: string | null;
  activeShopName: string | null;
}) {
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const [restockItem, setRestockItem] = useState<CatalogItem | null>(null);
  const [discontinueItem, setDiscontinueItem] = useState<CatalogItem | null>(null);
  const [discontinueProduct, setDiscontinueProduct] = useState<CatalogProduct | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [quick, setQuick] = useState<QuickFilter>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = items.filter(
      (item) =>
        item.archived === showArchived &&
        (filter === "all" || item.category === filter) &&
        (q === "" || item.name.toLowerCase().includes(q)) &&
        (quick === null ||
          (quick === "low" && item.stock.lowFlag) ||
          (quick === "exp" && item.stock.expiringFlag)),
    );
    // On a single Shop, surface the Items it carries above the ones it doesn't.
    if (scope.mode === "shop") {
      return rows
        .slice()
        .sort((a, b) => Number(b.stock.carried) - Number(a.stock.carried));
    }
    return rows;
  }, [items, query, filter, quick, scope.mode, showArchived]);

  // Total on-hand per cosmetic line (sum across its shades, all Shops) — gates the
  // editor's "Discontinue line" action (block-until-zero across the whole line).
  const lineOnHandByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of items) {
      if (!item.productId) continue;
      totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.totalOnHand);
    }
    return totals;
  }, [items]);

  function openAdd(category: Category) {
    setTarget({ mode: "add", category });
  }
  function openEdit(item: CatalogItem) {
    // A cosmetic is edited as its whole Product line (all shades), since the
    // shades share one line; wigs and tools edit as the single Item they are.
    if (item.category === "cosmetic") {
      const product =
        products.find((p) => p.id === item.productId) ??
        ({ id: item.productId ?? item.id, name: item.name, brand: null, shades: [item] } as CatalogProduct);
      setTarget({ mode: "edit-product", product });
    } else {
      setTarget({ mode: "edit-item", item });
    }
  }
  function onSaved(message: string) {
    setTarget(null);
    setToast(message);
  }
  function onRestocked(message: string) {
    setRestockItem(null);
    setToast(message);
  }
  function onDiscontinued(message: string) {
    setDiscontinueItem(null);
    setDiscontinueProduct(null);
    setToast(message);
  }
  function onRestored(message: string) {
    setToast(message);
  }

  return (
    <>
      {items.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyCatalog onAdd={openAdd} />
        </div>
      ) : (
        <>
          <div className="scope-note">
            {scope.mode === "shop" ? (
              <>
                <Icon name="store" /> Showing <strong>{scope.shopName}</strong> — switch
                shops in the top bar. Catalog &amp; prices are business-wide.
              </>
            ) : (
              <>
                <Icon name="dashboard" /> Showing <strong>all shops</strong> combined.
                Pick a shop in the top bar to see and edit one shop&rsquo;s stock.
              </>
            )}
          </div>

          <div className="inv-toolbar">
            <div className="search">
              <Icon name="search" />
              <input
                placeholder="Search items by name…"
                aria-label="Search catalog"
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
            <div className="pills">
              <button
                type="button"
                className={"pill" + (quick === "low" ? " active" : "")}
                onClick={() => setQuick((q) => (q === "low" ? null : "low"))}
              >
                Low stock
              </button>
              <button
                type="button"
                className={"pill" + (quick === "exp" ? " active" : "")}
                onClick={() => setQuick((q) => (q === "exp" ? null : "exp"))}
              >
                Expiring soon
              </button>
            </div>
            <div className="pills">
              <button
                type="button"
                className={"pill" + (showArchived ? " active" : "")}
                onClick={() => setShowArchived((v) => !v)}
                title="Show discontinued items"
              >
                <Icon name="box" /> Archived
              </button>
            </div>
            <div style={{ flex: 1 }} />
            <AddMenu onAdd={openAdd} />
          </div>

          <div className="card" style={{ padding: 0 }}>
            {visible.length === 0 ? (
              <div className="empty">
                <div className="empty-ico">
                  <Icon name="box" />
                </div>
                <p className="body-med" style={{ margin: 0 }}>
                  {showArchived ? "No archived items" : "No items match these filters"}
                </p>
                <p className="caption" style={{ marginTop: 4 }}>
                  {showArchived
                    ? "Discontinued items show here — you can restore them anytime."
                    : "Try a different search or category."}
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Category</th>
                      <th className="num">Cost</th>
                      <th className="num">Price</th>
                      <th className="num">{scope.mode === "shop" ? "Qty here" : "Total qty"}</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        scope={scope}
                        onEdit={() => openEdit(item)}
                        onRestock={() => setRestockItem(item)}
                        onDiscontinue={() => setDiscontinueItem(item)}
                        onRestored={onRestored}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {target && (
        <ItemDrawer
          target={target}
          lineOnHand={
            target.mode === "edit-product" ? (lineOnHandByProduct.get(target.product.id) ?? 0) : 0
          }
          onClose={() => setTarget(null)}
          onSaved={onSaved}
          onDiscontinueLine={(product) => {
            setTarget(null);
            setDiscontinueProduct(product);
          }}
        />
      )}

      {restockItem && (
        <RestockModal
          item={restockItem}
          shops={shops}
          activeShopId={activeShopId}
          activeShopName={activeShopName}
          onClose={() => setRestockItem(null)}
          onSaved={onRestocked}
        />
      )}

      {discontinueItem && (
        <DiscontinueItemModal
          itemId={discontinueItem.id}
          itemName={discontinueItem.name}
          onClose={() => setDiscontinueItem(null)}
          onDone={onDiscontinued}
        />
      )}

      {discontinueProduct && (
        <DiscontinueLineModal
          productId={discontinueProduct.id}
          productName={discontinueProduct.name}
          onClose={() => setDiscontinueProduct(null)}
          onDone={onDiscontinued}
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

/** The muted second line for a catalog row. Cosmetics show size + a formatted
 * expiry (the shade and line are already in the Item name); wigs and tools show
 * their attribute summary. */
function subline(item: CatalogItem): string {
  if (item.category === "cosmetic") {
    const parts: string[] = [];
    if (item.attributes.size) parts.push(item.attributes.size);
    if (item.attributes.expiry) parts.push(`Exp ${formatExpiry(item.attributes.expiry)}`);
    return parts.join(" · ");
  }
  return attributeSummary(item.category, item.attributes);
}

/** One catalog Item as a flat table row — wig, wig tool, or a single cosmetic
 * shade — with its scope-aware quantity, status, and actions. */
function ItemRow({
  item,
  scope,
  onEdit,
  onRestock,
  onDiscontinue,
  onRestored,
}: {
  item: InventoryItem;
  scope: InventoryScope;
  onEdit: () => void;
  onRestock: () => void;
  onDiscontinue: () => void;
  onRestored: (message: string) => void;
}) {
  const sub = subline(item);
  const { stock } = item;
  // In a single Shop, an Item it doesn't carry yet gets a "Stock here" action —
  // the first restock starts the Shop carrying it (CONTEXT.md).
  const stockHereOnly = scope.mode === "shop" && !stock.carried;
  // Discontinuing is blocked while any Shop still holds stock (block-until-zero).
  const discontinueBlock = archiveBlockReason(item.totalOnHand);

  return (
    <tr>
      <td>
        <Link href={`/inventory/${item.id}`} className="it-link">
          <div className="it-name">{item.name}</div>
          {sub && <div className="it-attr">{sub}</div>}
        </Link>
      </td>
      <td>
        <span className="chip chip-neutral">{CATEGORY_LABEL[item.category]}</span>
      </td>
      <td className="num tnum text-muted">{item.cost == null ? "—" : format(item.cost)}</td>
      <td className="num tnum">{format(item.price)}</td>
      <td className="num tnum">
        {stock.quantity === null ? (
          <span className="text-faint">—</span>
        ) : scope.mode === "all" ? (
          <>
            {stock.quantity}
            <div className="qty-sub">
              {stock.carriedShopCount} of {scope.shopCount} shops
            </div>
          </>
        ) : (
          stock.quantity
        )}
      </td>
      <td>
        {item.archived ? (
          <span className="chip chip-outline">Archived</span>
        ) : (
          <span className={"chip " + KIND_CHIP[stock.statusKind]}>{stock.statusLabel}</span>
        )}
      </td>
      <td className="num">
        {item.archived ? (
          <div className="row-actions">
            <RestoreItemButton
              itemId={item.id}
              itemName={item.name}
              onDone={onRestored}
              variant="row"
            />
            <Link
              href={`/inventory/${item.id}`}
              className="row-act"
              title="History"
              aria-label={`View ${item.name} stock history`}
            >
              <Icon name="history" />
            </Link>
          </div>
        ) : stockHereOnly ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Restock to start carrying this item"
            onClick={onRestock}
          >
            <Icon name="plus" /> Stock here
          </button>
        ) : (
          <div className="row-actions">
            <button
              type="button"
              className="row-act"
              title="Edit"
              aria-label={`Edit ${item.name}`}
              onClick={onEdit}
            >
              <Icon name="edit" />
            </button>
            <button
              type="button"
              className="row-act"
              title="Restock"
              aria-label={`Restock ${item.name}`}
              onClick={onRestock}
            >
              <Icon name="restock" />
            </button>
            <button
              type="button"
              className="row-act"
              title={discontinueBlock ?? "Discontinue"}
              aria-label={`Discontinue ${item.name}`}
              onClick={onDiscontinue}
              disabled={!canArchive(item.totalOnHand)}
            >
              <Icon name="box" />
            </button>
            <Link
              href={`/inventory/${item.id}`}
              className="row-act"
              title="History"
              aria-label={`View ${item.name} stock history`}
            >
              <Icon name="history" />
            </Link>
          </div>
        )}
      </td>
    </tr>
  );
}

/** "Add item" split button: the primary adds a wig; the caret opens a menu to
 * add a wig, a cosmetic line, or a wig tool (each opens the same editor). */
function AddMenu({ onAdd }: { onAdd: (category: Category) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const OPTIONS: { category: Category; icon: Parameters<typeof Icon>[0]["name"]; label: string }[] = [
    { category: "wig", icon: "inventory", label: "Add wig" },
    { category: "cosmetic", icon: "box", label: "Add cosmetic line" },
    { category: "wig_tool", icon: "settings", label: "Add wig tool" },
  ];

  return (
    <div className="split-btn" ref={ref}>
      <button type="button" className="btn btn-primary" onClick={() => onAdd("wig")}>
        <Icon name="plus" /> Add item
      </button>
      <button
        type="button"
        className="btn btn-primary caret"
        aria-label="More add options"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="chevdown" />
      </button>
      {open && (
        <div className="menu">
          {OPTIONS.map((o) => (
            <button
              key={o.category}
              type="button"
              onClick={() => {
                setOpen(false);
                onAdd(o.category);
              }}
            >
              <Icon name={o.icon} /> {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyCatalog({ onAdd }: { onAdd: (category: Category) => void }) {
  return (
    <div className="empty">
      <div className="empty-ico">
        <Icon name="inventory" />
      </div>
      <p className="body-med" style={{ margin: 0 }}>
        No items yet
      </p>
      <p className="caption" style={{ margin: "4px auto 0", maxWidth: 380 }}>
        Add your first wig, cosmetic line, or wig tool to start the catalog. Cost
        and price are business-wide; stock is added per shop later.
      </p>
      <div style={{ marginTop: 16 }}>
        <AddMenu onAdd={onAdd} />
      </div>
    </div>
  );
}

const INITIAL: ItemFormState = { status: "idle" };

/** One editable shade row in the cosmetic editor (client state, serialized to a
 * hidden field on submit). `key` is a stable React id; `id` is the DB id, present
 * only for a shade that already exists. */
interface ShadeRowState {
  key: string;
  id?: string;
  shade: string;
  size: string;
  expiry: string;
  cost: string;
  price: string;
}

let shadeKeySeq = 0;
function nextShadeKey(): string {
  shadeKeySeq += 1;
  return `shade-${shadeKeySeq}`;
}
function blankShade(): ShadeRowState {
  return { key: nextShadeKey(), shade: "", size: "", expiry: "", cost: "", price: "" };
}
function shadesOf(product: CatalogProduct): ShadeRowState[] {
  return product.shades.map((shade) => ({
    key: nextShadeKey(),
    id: shade.id,
    shade: shade.attributes.shade ?? "",
    size: shade.attributes.size ?? "",
    expiry: shade.attributes.expiry ?? "",
    cost: moneyValue(shade.cost),
    price: moneyValue(shade.price),
  }));
}

/**
 * The single add/edit drawer for every catalog entry. The Category selector
 * (when adding) switches the body between the standalone-Item form (wig / wig
 * tool → {@link saveItem}) and the cosmetic-line form (a Product line with
 * repeatable shade rows → {@link saveProduct}). Cosmetics are a category here,
 * not a separate flow.
 */
function ItemDrawer({
  target,
  lineOnHand,
  onClose,
  onSaved,
  onDiscontinueLine,
}: {
  target: EditorTarget;
  /** Units on hand across the cosmetic line's shades — gates "Discontinue line". */
  lineOnHand: number;
  onClose: () => void;
  onSaved: (message: string) => void;
  onDiscontinueLine: (product: CatalogProduct) => void;
}) {
  const editItem = target.mode === "edit-item" ? target.item : null;
  const editProduct = target.mode === "edit-product" ? target.product : null;
  const locked = target.mode !== "add";

  const initialCategory: Category =
    target.mode === "add"
      ? target.category
      : target.mode === "edit-item"
        ? target.item.category
        : "cosmetic";

  const [category, setCategory] = useState<Category>(initialCategory);

  // Both write paths are bound up-front (hooks can't be conditional); the form's
  // action is the one matching the chosen category.
  const [itemState, itemAction, itemPending] = useActionState(saveItem, INITIAL);
  const [productState, productAction, productPending] = useActionState(saveProduct, INITIAL);

  const isCosmetic = category === "cosmetic";
  const formAction = isCosmetic ? productAction : itemAction;
  const state = isCosmetic ? productState : itemState;
  const pending = isCosmetic ? productPending : itemPending;

  const [shades, setShades] = useState<ShadeRowState[]>(() =>
    editProduct ? shadesOf(editProduct) : [blankShade()],
  );

  useEffect(() => {
    if (itemState.status === "success") onSaved(itemState.message);
  }, [itemState, onSaved]);
  useEffect(() => {
    if (productState.status === "success") onSaved(productState.message);
  }, [productState, onSaved]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function updateShade(key: string, patch: Partial<ShadeRowState>) {
    setShades((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function addShade() {
    setShades((rows) => [...rows, blankShade()]);
  }
  function removeShade(key: string) {
    setShades((rows) => rows.filter((row) => row.key !== key));
  }

  // Pre-fill attribute inputs only for the standalone Item being edited.
  const prefill: Attributes = editItem && editItem.category === category ? editItem.attributes : {};
  // The shade list rides to the Server Action as JSON (it's a dynamic list).
  const shadesPayload = JSON.stringify(shades.map(({ key, ...rest }) => rest));

  const title = locked
    ? isCosmetic
      ? "Edit cosmetic line"
      : "Edit item"
    : isCosmetic
      ? "Add a cosmetic line"
      : "Add an item";

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <form action={formAction} style={{ display: "contents" }}>
          {editItem && <input type="hidden" name="id" value={editItem.id} />}
          {editProduct && <input type="hidden" name="id" value={editProduct.id} />}
          <input type="hidden" name="category" value={category} />

          <div className="d-head">
            <h3 className="h3">{title}</h3>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>

          <div className="d-body">
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Category</label>
              {locked ? (
                <div>
                  <span className="chip chip-neutral">{CATEGORY_LABEL[category]}</span>
                </div>
              ) : (
                <div className="pills">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={"pill" + (category === c ? " active" : "")}
                      onClick={() => setCategory(c)}
                    >
                      {CATEGORY_LABEL[c]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {isCosmetic ? (
              <CosmeticFields
                editProduct={editProduct}
                shades={shades}
                onAddShade={addShade}
                onUpdateShade={updateShade}
                onRemoveShade={removeShade}
              />
            ) : (
              <StandaloneFields category={category} editItem={editItem} prefill={prefill} />
            )}

            {isCosmetic && <input type="hidden" name="shades" value={shadesPayload} />}

            {state.status === "error" && (
              <div className="field" style={{ marginTop: 12 }}>
                <p className="err">
                  <Icon name="alert" /> {state.message}
                </p>
              </div>
            )}

            <p className="caption text-faint mt-16">
              Cost and price are <strong>business-wide</strong> — the same at every
              shop. Stock isn&rsquo;t set here; you add it per shop from Inventory.
            </p>
          </div>

          <div className="d-foot">
            {editProduct && (
              <button
                type="button"
                className="btn btn-danger"
                style={{ marginRight: "auto" }}
                onClick={() => onDiscontinueLine(editProduct)}
                disabled={!canArchive(lineOnHand)}
                title={archiveBlockReason(lineOnHand) ?? undefined}
              >
                <Icon name="box" /> Discontinue line
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : locked ? "Save changes" : "Save item"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

/** Name + category attributes + cost/price, for a wig or wig tool. */
function StandaloneFields({
  category,
  editItem,
  prefill,
}: {
  category: Category;
  editItem: CatalogItem | null;
  prefill: Attributes;
}) {
  return (
    <>
      <div className="field" style={{ marginBottom: 14 }}>
        <label>
          Name <span style={{ color: "var(--danger)" }}>*</span>
        </label>
        <input
          className="input"
          name="name"
          placeholder="Item name"
          defaultValue={editItem?.name ?? ""}
          required
          autoFocus
        />
      </div>

      {/* Re-mount the attribute grid on category change so each field picks up
          the right default value (and stale fields drop out). */}
      <div className="attr-grid" key={category}>
        {ATTRIBUTE_FIELDS[category].map((f) => (
          <div
            className="field"
            key={f.key}
            style={f.full ? { gridColumn: "1 / -1" } : undefined}
          >
            <label>{f.label}</label>
            <input
              className="input"
              name={`attr_${f.key}`}
              placeholder={f.placeholder}
              defaultValue={prefill[f.key] ?? ""}
            />
          </div>
        ))}
      </div>

      <div className="attr-grid mt-16">
        <div className="field">
          <label>Cost (GH₵)</label>
          <input
            className="input tnum"
            name="cost"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={moneyValue(editItem?.cost ?? null)}
          />
        </div>
        <div className="field">
          <label>
            Selling price (GH₵) <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            className="input tnum"
            name="price"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={editItem ? moneyValue(editItem.price) : ""}
            required
          />
        </div>
      </div>
    </>
  );
}

/** Product-line name + repeatable shade rows, for a cosmetic. */
function CosmeticFields({
  editProduct,
  shades,
  onAddShade,
  onUpdateShade,
  onRemoveShade,
}: {
  editProduct: CatalogProduct | null;
  shades: ShadeRowState[];
  onAddShade: () => void;
  onUpdateShade: (key: string, patch: Partial<ShadeRowState>) => void;
  onRemoveShade: (key: string) => void;
}) {
  return (
    <>
      <div className="field" style={{ marginBottom: 14 }}>
        <label>
          Product (cosmetic line) <span style={{ color: "var(--danger)" }}>*</span>
        </label>
        <input
          className="input"
          name="name"
          placeholder="e.g. Velvet Matte Lipstick"
          defaultValue={editProduct?.name ?? ""}
          required
          autoFocus
        />
      </div>

      <div className="overline text-faint" style={{ marginBottom: 8 }}>
        Shades
      </div>

      {shades.map((row, index) => (
        <ShadeRow
          key={row.key}
          row={row}
          index={index}
          removable={shades.length > 1 && !row.id}
          onChange={(patch) => onUpdateShade(row.key, patch)}
          onRemove={() => onRemoveShade(row.key)}
        />
      ))}

      <button type="button" className="btn btn-ghost btn-sm" onClick={onAddShade}>
        <Icon name="plus" /> Add another shade
      </button>
    </>
  );
}

function ShadeRow({
  row,
  index,
  removable,
  onChange,
  onRemove,
}: {
  row: ShadeRowState;
  index: number;
  removable: boolean;
  onChange: (patch: Partial<ShadeRowState>) => void;
  onRemove: () => void;
}) {
  const req = <span style={{ color: "var(--danger)" }}>*</span>;
  return (
    <div className="shade-row">
      <div className="field">
        <label className="caption">Shade {req}</label>
        <input
          className="input"
          value={row.shade}
          placeholder="e.g. Rosewood"
          onChange={(e) => onChange({ shade: e.target.value })}
          required
        />
      </div>
      <div className="field">
        <label className="caption">Size</label>
        <input
          className="input"
          value={row.size}
          placeholder="e.g. 4g"
          onChange={(e) => onChange({ size: e.target.value })}
        />
      </div>
      <div className="field">
        <label className="caption">Expiry {req}</label>
        <input
          className="input"
          type="date"
          value={row.expiry}
          onChange={(e) => onChange({ expiry: e.target.value })}
          required
        />
      </div>
      <div className="field">
        <label className="caption">Cost</label>
        <input
          className="input tnum"
          inputMode="decimal"
          value={row.cost}
          placeholder="0.00"
          onChange={(e) => onChange({ cost: e.target.value })}
        />
      </div>
      <div className="field">
        <label className="caption">Price {req}</label>
        <input
          className="input tnum"
          inputMode="decimal"
          value={row.price}
          placeholder="0.00"
          onChange={(e) => onChange({ price: e.target.value })}
          required
        />
      </div>
      <div className="field shade-actions">
        {removable ? (
          <button
            type="button"
            className="shade-del"
            onClick={onRemove}
            aria-label={`Remove shade ${index + 1}`}
          >
            <Icon name="x" /> Remove
          </button>
        ) : (
          row.id && <span className="caption text-faint">Saved</span>
        )}
      </div>
    </div>
  );
}

/** pesewas → a bare decimal string ("145000" → "1450.00") for the money inputs. */
function moneyValue(pesewas: number | null): string {
  return pesewas == null ? "" : format(pesewas, { symbol: false, grouping: false });
}
