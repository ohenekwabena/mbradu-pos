"use client";

import { usePathname } from "next/navigation";

import { Icon } from "@/components/icon";
import { SECTION_META, sectionFromPath } from "@/lib/nav";
import type { Role } from "@/lib/auth/visibility";

import { AccountMenu, type AccountInfo } from "./account-menu";
import { ShopSwitcher, type SwitcherShop } from "./shop-switcher";

/**
 * The topbar: page title/subtitle (derived from the route), the Shop-context
 * control (Owner switcher / Cashier locked label), notifications, and
 * the account menu (design.md §4.1).
 */
export function TopBar({
  role,
  shops,
  scope,
  activeShopName,
  cashierShopName,
  account,
}: {
  role: Role;
  shops: SwitcherShop[];
  scope: string;
  activeShopName: string | null;
  cashierShopName: string | null;
  account: AccountInfo;
}) {
  const meta = SECTION_META[sectionFromPath(usePathname())] ?? { title: "" };

  return (
    <div className="topbar">
      <div className="topbar-titles">
        <h1 className="h1">{meta.title}</h1>
        {meta.subtitle && <div className="sub body">{meta.subtitle}</div>}
      </div>

      <div className="topbar-actions">
        {role === "owner" ? (
          <ShopSwitcher shops={shops} scope={scope} activeName={activeShopName} />
        ) : cashierShopName ? (
          <div className="shop-label" title="You're assigned to this shop">
            <span className="store">
              <Icon name="store" />
            </span>
            {cashierShopName}
            <span className="lock">
              <Icon name="lock" />
            </span>
          </div>
        ) : null}

        {role === "owner" && (
          <button type="button" className="icon-btn" aria-label="Notifications">
            <Icon name="bell" />
            <span className="dot" />
          </button>
        )}

        <AccountMenu account={account} />
      </div>
    </div>
  );
}
