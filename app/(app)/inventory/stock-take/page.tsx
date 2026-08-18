import { type Attributes, type Category } from "@/lib/catalog";
import { getCurrentProfile } from "@/lib/dal";
import { ALL_SHOPS } from "@/lib/shop-context";
import { readShopScope } from "@/lib/shop-context-server";
import { createClient } from "@/lib/supabase/server";

import { itemSubline } from "./item-subline";
import { PickShopToCount } from "./pick-shop-to-count";
import { StockTakeView, type CountLine, type PickItem } from "./stock-take-view";

/**
 * The blind Stock take screen (ADR-0006, MP-35). Resolves the one Shop the
 * count belongs to — a Cashier's fixed Shop, or the Owner's active Shop
 * context (on "All shops" the Owner picks one first, since a count belongs to
 * exactly one Shop) — then either resumes that Shop's open session or offers
 * to start one over a chosen scope of carried Items.
 *
 * **Blindness is structural here**: this page never selects a quantity — not
 * from `shop_stock` (only `item_id` for the scope picker) and not from the
 * lines (read via the `stock_take_lines_visible` masking view, with
 * `expected_qty` never in the select list) — so no expected figure can reach
 * the count screen's props, let alone its markup. The counter sees item names
 * and attributes only.
 */
export default async function StockTakePage() {
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
        <PickShopToCount
          shops={(data ?? []).map((s) => ({ id: s.id as string, name: s.name as string }))}
        />
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

  const [{ data: shopRow }, { data: openTake }, { data: submittedTake }, { data: itemRows }] =
    await Promise.all([
      supabase.from("shops").select("name").eq("id", shopId).maybeSingle(),
      supabase
        .from("stock_takes")
        .select("id, created_at")
        .eq("shop_id", shopId)
        .eq("status", "open")
        .maybeSingle(),
      supabase
        .from("stock_takes")
        .select("id, submitted_at")
        .eq("shop_id", shopId)
        .eq("status", "submitted")
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("items_catalog")
        .select("id, category, name, attributes")
        .is("archived_at", null)
        .order("name"),
    ]);

  const shopName = (shopRow?.name as string | undefined) ?? "this shop";
  const itemById = new Map(
    (itemRows ?? []).map((row) => [
      row.id as string,
      {
        name: row.name as string,
        subline: itemSubline(row.category as Category, (row.attributes ?? {}) as Attributes),
      },
    ]),
  );

  // An open session: resume it. Lines come through the masking view; the
  // select list deliberately has no expected_qty (blind entry).
  if (openTake) {
    const { data: lineRows } = await supabase
      .from("stock_take_lines_visible")
      .select("id, item_id, counted_qty, skipped")
      .eq("take_id", openTake.id as string);

    const lines: CountLine[] = (lineRows ?? [])
      .map((row) => {
        const item = itemById.get(row.item_id as string);
        return {
          id: row.id as string,
          name: item?.name ?? "Unknown item",
          subline: item?.subline ?? "",
          countedQty: (row.counted_qty ?? null) as number | null,
          skipped: Boolean(row.skipped),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return (
      <StockTakeView
        shopId={shopId}
        shopName={shopName}
        open={{ id: openTake.id as string, startedAt: openTake.created_at as string, lines }}
        submittedAt={null}
        pickItems={[]}
      />
    );
  }

  // No open session: offer to start one over the Shop's carried, non-archived
  // Items. Only item_id is selected from shop_stock — no quantities.
  const { data: carriedRows } = await supabase
    .from("shop_stock")
    .select("item_id")
    .eq("shop_id", shopId);

  const pickItems: PickItem[] = (carriedRows ?? [])
    .map((row) => row.item_id as string)
    .filter((id) => itemById.has(id))
    .map((id) => ({ id, ...(itemById.get(id) as { name: string; subline: string }) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <StockTakeView
      shopId={shopId}
      shopName={shopName}
      open={null}
      submittedAt={(submittedTake?.submitted_at ?? null) as string | null}
      pickItems={pickItems}
    />
  );
}
