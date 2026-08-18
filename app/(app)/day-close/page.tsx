import Link from "next/link";

import { Icon } from "@/components/icon";
import { getCurrentProfile } from "@/lib/dal";
import { ALL_SHOPS } from "@/lib/shop-context";
import { readShopScope } from "@/lib/shop-context-server";
import { createClient } from "@/lib/supabase/server";

import { DayCloseView } from "./day-close-view";
import { PickShopToClose } from "./pick-shop-to-close";

/** Owner-only jump to the cash-audit trail (MP-41), styled like the history
 * pages' crumb links: top-left above the content, on the page's left edge —
 * the *history* is where the Over/short lives; nothing here leaks. */
function HistoryLink() {
  return (
    <Link className="crumb" href="/day-close/history">
      <Icon name="history" /> Close history
    </Link>
  );
}

/**
 * The blind Day close screen (ADR-0007, MP-40). Resolves the one Shop the
 * close belongs to — a Cashier's fixed Shop, or the Owner's active Shop
 * context (on "All shops" the Owner picks one first, since a drawer belongs to
 * exactly one Shop) — then offers the blind declaration form.
 *
 * **Blindness is structural here**: this page loads the Shop's name and one
 * boolean — whether today is already closed, via the money-free
 * `day_close_exists` RPC — and nothing else. No Float, no Payments, no
 * `day_closes` row ever reaches the screen's props, so no expected figure or
 * Over/short can leak into the markup. The declarer types what they counted
 * and gets "recorded" back; the comparison lives server-side, Owner-only.
 */
export default async function DayClosePage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  let shopId: string | null = null;
  if (profile.role === "cashier") {
    shopId = profile.shopId;
  } else {
    const scope = await readShopScope();
    if (scope !== ALL_SHOPS) shopId = scope;
  }

  if (!shopId) {
    if (profile.role === "owner") {
      const { data } = await supabase.from("shops").select("id, name").order("name");
      return (
        <>
          <HistoryLink />
          <PickShopToClose
            shops={(data ?? []).map((s) => ({ id: s.id as string, name: s.name as string }))}
          />
        </>
      );
    }
    return (
      <div className="scope-prompt">
        <div className="empty-ico">
          <span aria-hidden>!</span>
        </div>
        <h2 className="h2">No shop assigned</h2>
        <p className="text-muted" style={{ marginTop: 8 }}>
          Your account isn’t assigned to a shop yet. Ask the Owner to assign you to one.
        </p>
      </div>
    );
  }

  const today = todayIsoUtc();
  const [{ data: shopRow }, { data: todayClosed }] = await Promise.all([
    supabase.from("shops").select("name").eq("id", shopId).maybeSingle(),
    supabase.rpc("day_close_exists", { p_shop_id: shopId, p_close_date: today }),
  ]);

  return (
    <>
      {profile.role === "owner" && <HistoryLink />}
      <DayCloseView
        // Key by the day so a screen left open overnight re-seeds to the new day.
        key={`${shopId}:${today}`}
        shopId={shopId}
        shopName={(shopRow?.name as string | undefined) ?? "this shop"}
        today={today}
        todayClosed={Boolean(todayClosed)}
      />
    </>
  );
}

/** Today as a UTC `YYYY-MM-DD` string — the Ghana business day (GMT). Computed
 * server-side, never on the client (mirrors the Dashboard / Sales pages). */
function todayIsoUtc(): string {
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}
