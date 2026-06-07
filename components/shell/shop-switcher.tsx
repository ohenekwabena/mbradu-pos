"use client";

import { useTransition } from "react";

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
  const isAll = scope === ALL_SHOPS;

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
    <Select
      options={options}
      value={scope}
      onChange={(id) => startTransition(() => setShopScope(id))}
      disabled={pending}
      groupLabel="Shop context"
      triggerIcon="store"
      triggerClassName={isAll ? "all" : undefined}
      placeholder={activeName ?? "All shops"}
      aria-label="Shop context"
    />
  );
}
