"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Icon } from "@/components/icon";
import { signOut } from "@/lib/actions/shell";

export interface AccountInfo {
  name: string;
  roleLabel: string;
  shopLabel: string | null;
  initial: string;
}

/** Topbar account avatar (purple ring) → menu with identity + Sign out. */
export function AccountMenu({ account }: { account: AccountInfo }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  function confirmSignOut() {
    startTransition(async () => {
      await signOut();
    });
  }

  return (
    <>
      <div ref={ref} style={{ position: "relative" }}>
        <button
          type="button"
          className="nav-acct"
          aria-label="Account menu"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          {account.initial}
        </button>

        {open && (
          <div
            className="menu"
            style={{ right: 0, left: "auto", top: "calc(100% + 8px)", minWidth: 224 }}
          >
            <div style={{ padding: "8px 10px" }}>
              <div className="body-med">{account.name}</div>
              <div className="caption text-faint">
                {account.roleLabel}
                {account.shopLabel ? ` · ${account.shopLabel}` : ""}
              </div>
            </div>
            <div className="sep" />
            <button
              type="button"
              style={{ width: "100%" }}
              onClick={() => {
                setOpen(false);
                setConfirming(true);
              }}
            >
              <Icon name="back" />
              Sign out
            </button>
          </div>
        )}
      </div>

      {confirming && (
        <div
          className="scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setConfirming(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true">
            <div className="m-head">
              <h3 className="h3">Sign out</h3>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                <Icon name="x" />
              </button>
            </div>
            <div className="m-body">
              <p style={{ margin: 0 }}>
                Sign out of your account? You&apos;ll need to sign in again to get
                back in.
              </p>
            </div>
            <div className="m-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmSignOut}
                disabled={pending}
              >
                <Icon name="back" /> {pending ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
