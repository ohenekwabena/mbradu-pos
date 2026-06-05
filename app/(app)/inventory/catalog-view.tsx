"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/icon";
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

type CategoryFilter = "all" | Category;

const FILTERS: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "wig", label: "Wigs" },
  { key: "cosmetic", label: "Cosmetics" },
  { key: "wig_tool", label: "Wig Tools" },
];

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
  activeShopId,
  activeShopName,
}: {
  items: CatalogItem[];
  products: CatalogProduct[];
  shops: Shop[];
  /** The Owner's active Shop context, or `null` on "All shops". */
  activeShopId: string | null;
  activeShopName: string | null;
}) {
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const [restockItem, setRestockItem] = useState<CatalogItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("all");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (filter === "all" || item.category === filter) &&
        (q === "" || item.name.toLowerCase().includes(q)),
    );
  }, [items, query, filter]);

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

  return (
    <>
      {items.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyCatalog onAdd={openAdd} />
        </div>
      ) : (
        <>
          <div className="scope-note">
            <Icon name="box" /> The business-wide catalog — cost and price are the
            same at every shop. Stock is tracked per shop.
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
                  No items match these filters
                </p>
                <p className="caption" style={{ marginTop: 4 }}>
                  Try a different search or category.
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
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        onEdit={() => openEdit(item)}
                        onRestock={() => setRestockItem(item)}
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
        <ItemDrawer target={target} onClose={() => setTarget(null)} onSaved={onSaved} />
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

/** One catalog Item as a flat table row — wig, wig tool, or a single cosmetic shade. */
function ItemRow({
  item,
  onEdit,
  onRestock,
}: {
  item: CatalogItem;
  onEdit: () => void;
  onRestock: () => void;
}) {
  const sub = subline(item);
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
      <td className="num">
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
          <Link
            href={`/inventory/${item.id}`}
            className="row-act"
            title="History"
            aria-label={`View ${item.name} stock history`}
          >
            <Icon name="history" />
          </Link>
        </div>
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
  onClose,
  onSaved,
}: {
  target: EditorTarget;
  onClose: () => void;
  onSaved: (message: string) => void;
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
