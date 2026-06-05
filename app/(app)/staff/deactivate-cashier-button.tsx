"use client";

import { useEffect, useState, useTransition } from "react";

import { Icon } from "@/components/icon";

import { deactivateCashier, reactivateCashier } from "./actions";

/**
 * Owner control on each Cashier row: deactivate to lock someone out of sign-in
 * and selling, or reactivate to restore access. One button that flips with the
 * Cashier's state, mirroring the design's ghost action + confirmation modal +
 * toast; the work is the Owner-only {@link deactivateCashier} /
 * {@link reactivateCashier} Server Actions. A deactivated Cashier keeps all
 * their past sales — only their access changes — so this is always reversible.
 */
export function DeactivateCashierButton({
  cashierId,
  name,
  deactivated,
}: {
  cashierId: string;
  name: string;
  deactivated: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = deactivated
        ? await reactivateCashier(cashierId)
        : await deactivateCashier(cashierId);
      if (result.ok) {
        setOpen(false);
        setToast(deactivated ? `${name} reactivated` : `${name} deactivated`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Icon name={deactivated ? "check" : "ban"} />{" "}
        {deactivated ? "Reactivate" : "Deactivate"}
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
              <h3 className="h3">
                {deactivated ? "Reactivate cashier" : "Deactivate cashier"}
              </h3>
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
              {deactivated ? (
                <p style={{ margin: 0 }}>
                  Restore access for <strong>{name}</strong>? They&apos;ll be able
                  to sign in and record sales again from their next sign-in.
                </p>
              ) : (
                <>
                  <p style={{ margin: "0 0 12px" }}>
                    Deactivate <strong>{name}</strong>? They&apos;ll be signed out
                    and can no longer sign in or record sales.
                  </p>
                  <p className="caption text-faint" style={{ margin: 0 }}>
                    Their past sales are kept. You can reactivate them anytime.
                  </p>
                </>
              )}
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
                onClick={submit}
                disabled={pending}
              >
                <Icon name={deactivated ? "check" : "ban"} />{" "}
                {pending
                  ? deactivated
                    ? "Reactivating…"
                    : "Deactivating…"
                  : deactivated
                    ? "Reactivate"
                    : "Deactivate"}
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
