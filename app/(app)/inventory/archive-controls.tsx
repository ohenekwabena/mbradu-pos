"use client";

import { useActionState, useEffect } from "react";

import { Icon } from "@/components/icon";

import { archiveItem, archiveProduct, restoreItem, type ItemFormState } from "./actions";

/**
 * Archiving controls (MP-31) shared by the inventory list and the item-detail
 * page: confirm dialogs to discontinue a single Item or a whole cosmetic line,
 * and a Restore button. Each is bound to its Server Action via `useActionState`
 * (mirroring the Restock / Correction modals); the action revalidates `/inventory`,
 * so on success the row moves between the active and Archived views on its own.
 *
 * The block-until-zero rule is enforced twice over: the *trigger* (the Discontinue
 * button) is disabled while any stock remains, and the RPC re-checks it server-side
 * — so these dialogs only confirm intent and surface any RPC error verbatim.
 */

const INITIAL: ItemFormState = { status: "idle" };

/** Esc-to-close for the confirm dialogs (mirrors the stock modals). */
function useEscClose(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** Confirm dialog to discontinue (archive) one Item. */
export function DiscontinueItemModal({
  itemId,
  itemName,
  onClose,
  onDone,
}: {
  itemId: string;
  itemName: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState(archiveItem, INITIAL);
  useEffect(() => {
    if (state.status === "success") onDone(state.message);
  }, [state, onDone]);
  useEscClose(onClose);

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Discontinue item">
        <form action={formAction}>
          <input type="hidden" name="item_id" value={itemId} />
          <div className="m-head">
            <h3 className="h3">Discontinue item</h3>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>
          <div className="m-body">
            <p style={{ margin: 0 }}>
              Discontinue <strong>{itemName}</strong>? It will be hidden from selling and
              restocking and moved to <strong>Archived</strong>. Its sales history and stock
              ledger are kept, and you can restore it anytime.
            </p>
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
            <button type="submit" className="btn btn-danger solid" disabled={pending}>
              {pending ? "Discontinuing…" : "Discontinue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Confirm dialog to discontinue a whole cosmetic line — every shade at once. */
export function DiscontinueLineModal({
  productId,
  productName,
  onClose,
  onDone,
}: {
  productId: string;
  productName: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState(archiveProduct, INITIAL);
  useEffect(() => {
    if (state.status === "success") onDone(state.message);
  }, [state, onDone]);
  useEscClose(onClose);

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Discontinue cosmetic line">
        <form action={formAction}>
          <input type="hidden" name="product_id" value={productId} />
          <div className="m-head">
            <h3 className="h3">Discontinue line</h3>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>
          <div className="m-body">
            <p style={{ margin: 0 }}>
              Discontinue the entire <strong>{productName}</strong> line? Every shade is
              archived together and hidden from selling and restocking. History is kept, and
              you can restore shades individually later.
            </p>
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
            <button type="submit" className="btn btn-danger solid" disabled={pending}>
              {pending ? "Discontinuing…" : "Discontinue line"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Restore (un-archive) one Item. A tiny inline form bound to {@link restoreItem};
 * `variant` picks the chrome — a compact `row-act` icon button for an Archived
 * list row, or a full `btn` for the item-detail banner.
 */
export function RestoreItemButton({
  itemId,
  itemName,
  onDone,
  variant,
}: {
  itemId: string;
  itemName: string;
  onDone: (message: string) => void;
  variant: "row" | "button";
}) {
  const [state, formAction, pending] = useActionState(restoreItem, INITIAL);
  useEffect(() => {
    if (state.status === "success") onDone(state.message);
  }, [state, onDone]);

  return (
    <form action={formAction} style={variant === "row" ? { display: "contents" } : undefined}>
      <input type="hidden" name="item_id" value={itemId} />
      {variant === "row" ? (
        <button
          type="submit"
          className="row-act"
          title="Restore"
          aria-label={`Restore ${itemName}`}
          disabled={pending}
        >
          <Icon name="restock" />
        </button>
      ) : (
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          <Icon name="restock" /> {pending ? "Restoring…" : "Restore item"}
        </button>
      )}
    </form>
  );
}
