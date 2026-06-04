"use client";

import { useEffect, useRef, useState } from "react";

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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  return (
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
          <form action={signOut}>
            <button type="submit" style={{ width: "100%" }}>
              <Icon name="back" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
