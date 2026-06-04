"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Icon } from "@/components/icon";
import { setShopScope } from "@/lib/actions/shell";
import { ALL_SHOPS } from "@/lib/shop-context";

export interface SwitcherShop {
  id: string;
  name: string;
}

/**
 * Owner-only Shop-context dropdown (design.md §4.1): "All shops" or one Shop.
 * Picking an option writes the scope cookie via {@link setShopScope} and
 * revalidates the shell.
 */
export function ShopSwitcher({
  shops,
  scope,
  activeName,
}: {
  shops: SwitcherShop[];
  scope: string;
  activeName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const isAll = scope === ALL_SHOPS;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  function pick(id: string) {
    setOpen(false);
    startTransition(() => setShopScope(id));
  }

  return (
    <div className="shop-ctx" ref={ref}>
      <button
        type="button"
        className={`shop-switcher${isAll ? " all" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={pending}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span className="store">
          <Icon name="store" />
        </span>
        <span>{isAll ? "All shops" : (activeName ?? "All shops")}</span>
        <span className="chev">
          <Icon name="chevdown" />
        </span>
      </button>

      {open && (
        <div className="shop-menu">
          <div className="grp">Shop context</div>
          <button
            type="button"
            className={isAll ? "sel" : ""}
            onClick={() => pick(ALL_SHOPS)}
          >
            <Icon name="dashboard" />
            <span>All shops</span>
            <span className="meta">
              {shops.length} {shops.length === 1 ? "shop" : "shops"}
            </span>
          </button>
          <div className="sep" />
          {shops.map((s) => (
            <button
              key={s.id}
              type="button"
              className={scope === s.id ? "sel" : ""}
              onClick={() => pick(s.id)}
            >
              <Icon name="store" />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
