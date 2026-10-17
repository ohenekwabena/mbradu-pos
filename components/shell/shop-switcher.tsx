"use client";

import { useOptimistic, useTransition } from "react";
import { createPortal } from "react-dom";

import { Select, type SelectOption } from "@/components/select";
import { setShopScope } from "@/lib/actions/shell";
import { ALL_SHOPS } from "@/lib/shop-context";

export interface SwitcherShop {
  id: string;
  name: string;
}

/**
 * Owner-only Shop-context dropdown (design.md §4.1): "All shops" or one Shop.
 * Picking an option writes the scope cookie via {@link setShopScope} and
 * revalidates the shell. It renders the shared {@link Select} — the same
 * dropdown the Settings and Staff forms use — so the four selects stay in sync;
 * the Shop-context specifics (the "All shops" row + count, the greyed icon when
 * aggregated) are just the props passed here.
 *
 * Switching re-renders the whole shell on the server, and since the route is
 * unchanged the route-level loading UI never shows. So while the switch is in
 * flight the picked Shop shows in the trigger straight away and a spinner
 * covers the content area (portalled into `#page`) until the new scope lands.
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
  const [pending, startTransition] = useTransition();
  const [optimisticScope, setOptimisticScope] = useOptimistic(scope);
  const isAll = optimisticScope === ALL_SHOPS;
  // `#page` lives in the layout, outside this component. `pending` is only ever
  // true after a client-side pick, so the lookup never runs on the server.
  const page = pending ? document.getElementById("page") : null;

  const options: SelectOption[] = [
    {
      value: ALL_SHOPS,
      label: "All shops",
      icon: "dashboard",
      meta: `${shops.length} ${shops.length === 1 ? "shop" : "shops"}`,
      separatorAfter: true,
    },
    ...shops.map((s) => ({
      value: s.id,
      label: s.name,
      icon: "store" as const,
    })),
  ];

  return (
    <>
      <Select
        options={options}
        value={optimisticScope}
        onChange={(id) =>
          startTransition(async () => {
            setOptimisticScope(id);
            await setShopScope(id);
          })
        }
        disabled={pending}
        groupLabel="Shop context"
        triggerIcon="store"
        triggerClassName={isAll ? "all" : undefined}
        placeholder={activeName ?? "All shops"}
        aria-label="Shop context"
      />

      {page &&
        createPortal(
          <div className="scope-loading" role="status" aria-live="polite">
            <span className="spinner" aria-hidden />
            <span className="sr-only">Switching shop…</span>
          </div>,
          page,
        )}
    </>
  );
}
