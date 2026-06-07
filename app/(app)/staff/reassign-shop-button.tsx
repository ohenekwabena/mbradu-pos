"use client";

import { useEffect, useState, useTransition } from "react";

import { Icon } from "@/components/icon";
import { Select } from "@/components/select";

import { reassignCashier } from "./actions";
import type { ShopOption } from "./invitations-panel";

/**
 * Owner control on each Cashier row: pick a different Shop, confirm, reassign.
 * Mirrors the design's "Reassign shop" modal and success toast; the work itself
 * is the Owner-only {@link reassignCashier} Server Action. Only the Cashier's
 * future view and selling move — their past Sales keep their original Shop. The
 * Reassign button stays disabled until a *different* Shop is picked, so the same
 * no-op the Action guards against can't even be submitted.
 */
export function ReassignShopButton({
  cashierId,
  name,
  currentShopId,
  shops,
}: {
  cashierId: string;
  name: string;
  currentShopId: string | null;
  shops: ShopOption[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(currentShopId ?? shops[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  function openModal() {
    setError(null);
    setSelected(currentShopId ?? shops[0]?.id ?? "");
    setOpen(true);
  }

  function reassign() {
    setError(null);
    const shopName = shops.find((s) => s.id === selected)?.name ?? "the shop";
    startTransition(async () => {
      const result = await reassignCashier(cashierId, selected);
      if (result.ok) {
        setOpen(false);
        setToast(`${name} reassigned to ${shopName}`);
      } else {
        setError(result.error);
      }
    });
  }

  // No other Shop to move to, or the current one is still selected — nothing to do.
  const unchanged = selected === "" || selected === currentShopId;

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={openModal}>
        <Icon name="swap" /> Reassign
      </button>

      {open && (
        <div
          className="scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true">
            <div className="m-head">
              <h3 className="h3">Reassign shop</h3>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                <Icon name="x" />
              </button>
            </div>
            <div className="m-body">
              <p style={{ margin: "0 0 16px" }}>
                Move <strong>{name}</strong> to a different shop. Their past sales
                keep their original shop.
              </p>
              <div className="field">
                <label htmlFor="reassignShop">Shop</label>
                <Select
                  id="reassignShop"
                  value={selected}
                  onChange={setSelected}
                  options={shops.map((shop) => ({
                    value: shop.id,
                    label: shop.name,
                    icon: "store" as const,
                  }))}
                  triggerIcon="store"
                  disabled={pending}
                  block
                />
              </div>
              {error && (
                <div
                  className="err-banner"
                  style={{ marginTop: 14, marginBottom: 0 }}
                >
                  <Icon name="alert" /> {error}
                </div>
              )}
            </div>
            <div className="m-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={reassign}
                disabled={pending || unchanged}
              >
                <Icon name="swap" /> {pending ? "Reassigning…" : "Reassign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast success" role="status">
          <span className="ico">
            <Icon name="check" />
          </span>
          <span>{toast}</span>
        </div>
      )}
    </>
  );
}
