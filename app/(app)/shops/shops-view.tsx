"use client";

import { useActionState, useEffect, useState } from "react";

import { Icon } from "@/components/icon";
import { format } from "@/lib/money";

import { saveShop, type ShopFormState } from "./actions";

export interface ShopRow {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  staff: number;
  revenueToday: number;
}

export function ShopsView({ shops }: { shops: ShopRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ShopRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  function openAdd() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(shop: ShopRow) {
    setEditing(shop);
    setOpen(true);
  }
  function onSaved(message: string) {
    setOpen(false);
    setEditing(null);
    setToast(message);
  }

  return (
    <>
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 18,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <p className="text-muted body" style={{ margin: 0, maxWidth: 560 }}>
          {shops.length} {shops.length === 1 ? "shop" : "shops"} open. A shop can
          be opened any time and then stocked from Inventory — there&rsquo;s no
          per-shop pricing, and shops aren&rsquo;t closed in v1.
        </p>
        <button type="button" className="btn btn-primary" onClick={openAdd}>
          <Icon name="plus" /> Add shop
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {shops.length === 0 ? (
          <div className="empty">
            <div className="empty-ico">
              <Icon name="shops" />
            </div>
            <p className="body-med" style={{ margin: 0 }}>
              No shops yet
            </p>
            <p className="caption" style={{ marginTop: 4 }}>
              Open your first shop to start stocking and selling.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Address</th>
                  <th>Phone</th>
                  <th className="num">Staff</th>
                  <th className="num">Revenue today</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shops.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="shop-name-cell">
                        <span className="shop-ico">
                          <Icon name="store" />
                        </span>
                        <span className="body-med">{s.name}</span>
                      </div>
                    </td>
                    <td className="addr">{s.address ?? "—"}</td>
                    <td>
                      {s.phone ? (
                        <span className="contact">
                          <Icon name="phone" />
                          {s.phone}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="num tnum">{s.staff}</td>
                    <td className="num tnum">{format(s.revenueToday)}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openEdit(s)}
                      >
                        <Icon name="edit" /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <ShopDrawer
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

const INITIAL: ShopFormState = { status: "idle" };

function ShopDrawer({
  editing,
  onClose,
  onSaved,
}: {
  editing: ShopRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = !!editing;
  const [state, formAction, pending] = useActionState(saveShop, INITIAL);

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

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit shop" : "Open a new shop"}
      >
        <form action={formAction} style={{ display: "contents" }}>
          {isEdit && <input type="hidden" name="id" value={editing.id} />}
          <div className="d-head">
            <h3 className="h3">{isEdit ? "Edit shop" : "Open a new shop"}</h3>
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
              <label>
                Shop name <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                className="input"
                name="name"
                placeholder="e.g. Accra Mall"
                defaultValue={editing?.name ?? ""}
                required
                autoFocus
              />
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>
                Address <span className="text-faint">(optional)</span>
              </label>
              <input
                className="input"
                name="address"
                placeholder="Street, area, city"
                defaultValue={editing?.address ?? ""}
              />
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>
                Phone <span className="text-faint">(optional)</span>
              </label>
              <input
                className="input"
                name="phone"
                placeholder="+233 …"
                defaultValue={editing?.phone ?? ""}
              />
            </div>
            {state.status === "error" && (
              <p className="err" style={{ marginTop: 6 }}>
                <Icon name="alert" /> {state.message}
              </p>
            )}
            <p className="caption text-faint" style={{ marginTop: 6 }}>
              Address and phone print on this shop&rsquo;s receipts.
              {isEdit
                ? ""
                : " A new shop starts carrying no items — stock it from Inventory."}
            </p>
          </div>
          <div className="d-foot">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : isEdit ? "Save changes" : "Open shop"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
