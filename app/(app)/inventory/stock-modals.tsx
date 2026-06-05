"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/icon";

import { recordCorrection, recordRestock, type ItemFormState } from "./actions";

const INITIAL: ItemFormState = { status: "idle" };

/** The minimal Item shape the stock modals need — id (for the write) + name
 * (for the prompt). A full `CatalogItem` is structurally compatible. */
export interface StockItem {
  id: string;
  name: string;
}

/** A Shop the Owner can restock into (id + name). */
export interface Shop {
  id: string;
  name: string;
}

/** A Shop that already carries the Item, with its current quantity — the only
 * Shops a Correction can target (you can't correct stock that isn't there). */
export interface CarriedStock {
  shopId: string;
  shopName: string;
  quantity: number;
}

/**
 * Record-restock modal: add N units of one Item to a Shop's stock, with an
 * optional note. The Shop is locked to the active Shop context when one is set,
 * otherwise chosen from a dropdown (design — Inventory restock). Submits to
 * {@link recordRestock}; the first restock at a Shop makes it begin carrying the
 * Item.
 */
export function RestockModal({
  item,
  shops,
  activeShopId,
  activeShopName,
  onClose,
  onSaved,
}: {
  item: StockItem;
  shops: Shop[];
  activeShopId: string | null;
  activeShopName: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState(recordRestock, INITIAL);
  const lockedShop = activeShopId
    ? { id: activeShopId, name: activeShopName ?? "This shop" }
    : null;
  const noShop = !lockedShop && shops.length === 0;
  const req = <span style={{ color: "var(--danger)" }}>*</span>;

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
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Record restock">
        <form action={formAction}>
          <input type="hidden" name="item_id" value={item.id} />
          {lockedShop && <input type="hidden" name="shop_id" value={lockedShop.id} />}

          <div className="m-head">
            <h3 className="h3">Record restock</h3>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>

          <div className="m-body">
            <p style={{ margin: "0 0 16px" }}>
              Add units to <strong>{item.name}</strong>
              {lockedShop ? (
                <>
                  {" "}
                  at <strong>{lockedShop.name}</strong>
                </>
              ) : null}
              .
            </p>

            <div className="field" style={{ marginBottom: 14 }}>
              <label>Shop {req}</label>
              {lockedShop ? (
                <div className="ro-field">{lockedShop.name}</div>
              ) : noShop ? (
                <div className="ro-field">No shops yet — open a shop first.</div>
              ) : (
                <select className="input" name="shop_id" defaultValue={shops[0]?.id} required>
                  {shops.map((shop) => (
                    <option key={shop.id} value={shop.id}>
                      {shop.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="field" style={{ marginBottom: 14 }}>
              <label>Quantity in {req}</label>
              <input
                className="input tnum"
                name="amount"
                type="number"
                min="1"
                step="1"
                placeholder="0"
                autoFocus
                required
              />
            </div>

            <div className="field">
              <label>Note (optional)</label>
              <input className="input" name="note" placeholder="e.g. New supplier delivery" />
            </div>

            {state.status === "error" && (
              <p className="err" style={{ marginTop: 12 }}>
                <Icon name="alert" /> {state.message}
              </p>
            )}
          </div>

          <div className="m-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending || noShop}>
              {pending ? "Recording…" : "Record restock"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Record-correction modal: a signed adjustment to an Item's stock at a Shop it
 * already carries — negative to reduce (damage, loss), positive to add back a
 * miscount — with a required reason for the ledger (design — Item detail). The
 * Shop list is the Item's *carried* Shops only; a Correction can't apply where
 * the Item isn't stocked (the `record_correction` RPC enforces this, and that
 * stock can't be driven below 0). Submits to {@link recordCorrection}.
 */
export function CorrectionModal({
  item,
  carriedShops,
  activeShopId,
  onClose,
  onSaved,
}: {
  item: StockItem;
  carriedShops: CarriedStock[];
  activeShopId: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState(recordCorrection, INITIAL);
  const req = <span style={{ color: "var(--danger)" }}>*</span>;

  // Default to the active Shop when it carries the Item, else the first carried.
  const defaultShopId = useMemo(() => {
    if (activeShopId && carriedShops.some((s) => s.shopId === activeShopId)) return activeShopId;
    return carriedShops[0]?.shopId ?? "";
  }, [activeShopId, carriedShops]);
  const [shopId, setShopId] = useState(defaultShopId);
  const current = carriedShops.find((s) => s.shopId === shopId);

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
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Record correction">
        <form action={formAction}>
          <input type="hidden" name="item_id" value={item.id} />

          <div className="m-head">
            <h3 className="h3">Record correction</h3>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>

          <div className="m-body">
            <p style={{ margin: "0 0 16px" }}>
              Fix a miscount for <strong>{item.name}</strong> — enter a signed quantity
              (negative to reduce).
            </p>

            <div className="field" style={{ marginBottom: 14 }}>
              <label>Shop {req}</label>
              <select
                className="input"
                name="shop_id"
                value={shopId}
                onChange={(e) => setShopId(e.target.value)}
                required
              >
                {carriedShops.map((shop) => (
                  <option key={shop.shopId} value={shop.shopId}>
                    {shop.shopName}
                  </option>
                ))}
              </select>
              {current && (
                <p className="caption text-faint" style={{ marginTop: 6 }}>
                  Currently <span className="tnum">{current.quantity}</span> at {current.shopName}.
                </p>
              )}
            </div>

            <div className="field" style={{ marginBottom: 14 }}>
              <label>Signed quantity {req}</label>
              <input
                className="input tnum"
                name="amount"
                type="number"
                step="1"
                placeholder="e.g. -1"
                autoFocus
                required
              />
            </div>

            <div className="field">
              <label>Reason {req}</label>
              <input
                className="input"
                name="reason"
                placeholder="e.g. Damaged in storage"
                required
              />
            </div>

            {state.status === "error" && (
              <p className="err" style={{ marginTop: 12 }}>
                <Icon name="alert" /> {state.message}
              </p>
            )}
          </div>

          <div className="m-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Recording…" : "Record correction"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
