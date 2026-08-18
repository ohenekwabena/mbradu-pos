"use client";

import { useTransition } from "react";

import { Icon } from "@/components/icon";
import { setShopScope } from "@/lib/actions/shell";

/**
 * Owner-only "pick a shop to close" prompt, shown when the active Shop context
 * is "All shops". A Day close reconciles exactly one drawer, so it needs a
 * concrete Shop. Choosing one writes the scope cookie via {@link setShopScope}
 * (the same writer the topbar switcher uses), so the screen re-renders scoped
 * to that Shop. Mirrors the Stock take's PickShopToCount (MP-35).
 */
export function PickShopToClose({ shops }: { shops: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="scope-prompt">
      <div className="empty-ico">
        <Icon name="cash" />
      </div>
      <h2 className="h2">Pick a shop to close</h2>
      <p className="text-muted" style={{ margin: "8px 0 20px" }}>
        A day close counts one shop’s drawer against its own day of selling.
        Choose a shop — you can switch anytime from the top bar.
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
