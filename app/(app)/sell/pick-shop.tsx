"use client";

import { useTransition } from "react";

import { Icon } from "@/components/icon";
import { setShopScope } from "@/lib/actions/shell";

/**
 * Owner-only "pick a shop to sell" prompt, shown when the active Shop context is
 * "All shops". A sale belongs to exactly one Shop, so selling needs a concrete
 * one. Choosing a Shop writes the scope cookie via {@link setShopScope} (the same
 * writer the topbar switcher uses) and revalidates the shell, so the sell screen
 * re-renders scoped to that Shop. MP-22.
 */
export function PickShop({ shops }: { shops: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="scope-prompt">
      <div className="empty-ico">
        <Icon name="store" />
      </div>
      <h2 className="h2">Pick a shop to sell</h2>
      <p className="text-muted" style={{ margin: "8px 0 20px" }}>
        A sale rings up against one shop’s live stock. Choose a shop — the
        catalogue then shows only what that shop carries. You can switch anytime
        from the top bar.
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
