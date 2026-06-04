"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/icon";
import {
  ATTRIBUTE_FIELDS,
  attributeSummary,
  CATEGORY_LABEL,
  EDITABLE_CATEGORIES,
  isEditableCategory,
  type Attributes,
  type Category,
} from "@/lib/catalog";
import { format } from "@/lib/money";

import { saveItem, type ItemFormState } from "./actions";

export interface CatalogItem {
  id: string;
  category: Category;
  name: string;
  /** Selling price in pesewas. */
  price: number;
  /** Cost in pesewas, or `null` when masked (non-owner). This screen is
   * Owner-only, so in practice it's always present. */
  cost: number | null;
  attributes: Attributes;
}

type CategoryFilter = "all" | Category;

const FILTERS: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "wig", label: "Wigs" },
  { key: "wig_tool", label: "Wig Tools" },
];

export function CatalogView({ items }: { items: CatalogItem[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
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

  function openAdd() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(item: CatalogItem) {
    setEditing(item);
    setOpen(true);
  }
  function onSaved(message: string) {
    setOpen(false);
    setEditing(null);
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
            <button type="button" className="btn btn-primary" onClick={openAdd}>
              <Icon name="plus" /> Add item
            </button>
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
                    {visible.map((item) => {
                      const summary = attributeSummary(item.category, item.attributes);
                      return (
                        <tr key={item.id}>
                          <td>
                            <div className="it-name">{item.name}</div>
                            {summary && <div className="it-attr">{summary}</div>}
                          </td>
                          <td>
                            <span className="chip chip-neutral">
                              {CATEGORY_LABEL[item.category]}
                            </span>
                          </td>
                          <td className="num tnum text-muted">
                            {item.cost == null ? "—" : format(item.cost)}
                          </td>
                          <td className="num tnum">{format(item.price)}</td>
                          <td className="num">
                            <div className="row-actions">
                              <button
                                type="button"
                                className="row-act"
                                title="Edit"
                                aria-label={`Edit ${item.name}`}
                                onClick={() => openEdit(item)}
                              >
                                <Icon name="edit" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {open && (
        <ItemDrawer
          editing={editing}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
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

function EmptyCatalog({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty">
      <div className="empty-ico">
        <Icon name="inventory" />
      </div>
      <p className="body-med" style={{ margin: 0 }}>
        No items yet
      </p>
      <p className="caption" style={{ marginTop: 4, maxWidth: 360 }}>
        Add your first wig or wig tool to start the catalog. Cost and price are
        business-wide; stock is added per shop later.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        style={{ marginTop: 16 }}
        onClick={onAdd}
      >
        <Icon name="plus" /> Add item
      </button>
    </div>
  );
}

const INITIAL: ItemFormState = { status: "idle" };

function ItemDrawer({
  editing,
  onClose,
  onSaved,
}: {
  editing: CatalogItem | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!editing;
  const [state, formAction, pending] = useActionState(saveItem, INITIAL);

  // Default to the item's own category when it's one the editor supports,
  // otherwise a wig (the common case for a new item).
  const [category, setCategory] = useState<Category>(
    editing && isEditableCategory(editing.category) ? editing.category : "wig",
  );

  useEffect(() => {
    if (state.status === "success") onSaved(state.message);
  }, [state, onSaved]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Pre-fill attribute inputs only while the selected category matches the item
  // being edited; switching category starts those fields blank.
  const prefill: Attributes =
    editing && editing.category === category ? editing.attributes : {};

  // pesewas → a bare decimal string ("145000" → "1450.00") for the money inputs.
  const moneyValue = (pesewas: number | null) =>
    pesewas == null ? "" : format(pesewas, { symbol: false, grouping: false });

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit item" : "Add an item"}
      >
        <form action={formAction} style={{ display: "contents" }}>
          {isEdit && <input type="hidden" name="id" value={editing.id} />}
          <input type="hidden" name="category" value={category} />

          <div className="d-head">
            <h3 className="h3">{isEdit ? "Edit item" : "Add an item"}</h3>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close"
              onClick={onClose}
            >
              <Icon name="x" />
            </button>
          </div>

          <div className="d-body">
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Category</label>
              <div className="pills">
                {EDITABLE_CATEGORIES.map((c) => (
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
            </div>

            <div className="field" style={{ marginBottom: 14 }}>
              <label>
                Name <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                className="input"
                name="name"
                placeholder="Item name"
                defaultValue={editing?.name ?? ""}
                required
                autoFocus
              />
            </div>

            {/* Re-mount the attribute grid on category change so each field
                picks up the right default value (and stale fields drop out). */}
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
                  defaultValue={moneyValue(editing?.cost ?? null)}
                />
              </div>
              <div className="field">
                <label>
                  Selling price (GH₵){" "}
                  <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="input tnum"
                  name="price"
                  inputMode="decimal"
                  placeholder="0.00"
                  defaultValue={editing ? moneyValue(editing.price) : ""}
                  required
                />
              </div>
            </div>

            {state.status === "error" && (
              <div className="field" style={{ marginTop: 10 }}>
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
              {pending ? "Saving…" : isEdit ? "Save changes" : "Save item"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
