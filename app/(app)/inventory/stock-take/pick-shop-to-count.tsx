"use client";

import { useTransition } from "react";

import { Icon } from "@/components/icon";
import { setShopScope } from "@/lib/actions/shell";

/**
 * Owner-only "pick a shop to count" prompt, shown when the active Shop context
 * is "All shops". A Stock take belongs to exactly one Shop, so counting needs a
 * concrete one. Choosing a Shop writes the scope cookie via {@link setShopScope}
 * (the same writer the topbar switcher uses), so the screen re-renders scoped
 * to that Shop. Mirrors the sell screen's PickShop (MP-22).
 */
export function PickShopToCount({ shops }: { shops: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="scope-prompt">
      <div className="empty-ico">
        <Icon name="store" />
      </div>
      <h2 className="h2">Pick a shop to count</h2>
      <p className="text-muted" style={{ margin: "8px 0 20px" }}>
        A stock take counts one shop’s shelves against its own stock. Choose a
        shop — you can switch anytime from the top bar.
      </p>
      {shops.length === 0 ? (
        <p className="caption text-faint">No shops yet — open a shop first.</p>
      ) : (
        <div className="pills" style={{ justifyContent: "center", gap: 10 }}>
          {shops.map((shop) => (
            <button
              key={shop.id}
              type="button"
              className="pill"
              disabled={pending}
              style={{ whiteSpace: "nowrap" }}
              onClick={() => startTransition(() => setShopScope(shop.id))}
            >
              <Icon name="store" /> {shop.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
