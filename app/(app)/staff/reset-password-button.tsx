"use client";

import { useEffect, useState, useTransition } from "react";

import { Icon } from "@/components/icon";
import { resetCashierPassword } from "./actions";

/**
 * Owner control on each Cashier row: confirm, then send a password-reset link.
 * Mirrors the design's confirmation modal and success toast; the work itself is
 * the owner-only {@link resetCashierPassword} Server Action.
 */
export function ResetPasswordButton({
  name,
  email,
}: {
  name: string;
  email: string;
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

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await resetCashierPassword(email);
      if (result.ok) {
        setOpen(false);
        setToast(`Reset link sent to ${email}`);
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
        <Icon name="lock" /> Reset password
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
              <h3 className="h3">Reset password</h3>
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
              <p style={{ margin: "0 0 12px" }}>
                Send <strong>{name}</strong> a link to set a new password?
                Cashiers can&apos;t reset their own password, so this is the only
                way to get them back in.
              </p>
              <p className="caption text-faint" style={{ margin: 0 }}>
                We&apos;ll email <strong>{email}</strong> a reset link that
                expires in 60 minutes. Their current password stops working once
                they set a new one.
              </p>
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
                onClick={send}
                disabled={pending}
              >
                <Icon name="mail" /> {pending ? "Sending…" : "Send reset link"}
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
