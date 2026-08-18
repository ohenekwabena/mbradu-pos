import { NotOwner } from "@/components/shell/not-owner";
import { type Attributes, type Category } from "@/lib/catalog";
import { getCurrentProfile } from "@/lib/dal";
import { reviewOutcome, type ReviewOutcome } from "@/lib/stock-take";
import { createClient } from "@/lib/supabase/server";

import { itemSubline } from "../item-subline";
import { ReviewView, type QueueEntry, type ReviewDetail, type ReviewDetailLine } from "./review-view";

/**
 * The Owner's Stock-take review queue (ADR-0006, MP-37): every submitted take
 * across all Shops, oldest first, with the selected one (`?take=`, defaulting
 * to the head of the queue) opened for review — per-line expected / counted /
 * Variance, stale-line detection, classification, and approve / reject.
 *
 * **Staleness is derived server-side at render time**, the same two ways the
 * `approve_stock_take` RPC re-derives it under row locks: a ledger movement on
 * the line's *(Item, Shop)* after its snapshot, or a current quantity that no
 * longer matches the snapshot (the belt for commit-order edge cases). A stale
 * line is shown for what it is — un-postable — so the Owner is never invited
 * to classify a number that stopped being evidence (false shrinkage against
 * honest staff is the worst failure mode).
 *
 * Owner-only: Variances live in the same visibility family as cost/margin.
 * RLS is the hard boundary (`stock_take_lines_visible` masks `expected_qty`
 * for a Cashier); this page is the UI half of "a Cashier can see none of it".
 */
export default async function StockTakeReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ take?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can review stock takes." />;
  }

  const { take: takeParam } = await searchParams;
  const supabase = await createClient();

  const [{ data: takeRows }, { data: shopRows }] = await Promise.all([
    supabase
      .from("stock_takes")
      .select("id, shop_id, counted_by, submitted_at")
      .eq("status", "submitted")
      .order("submitted_at", { ascending: true }),
    supabase.from("shops").select("id, name"),
  ]);

  const takes = (takeRows ?? []).map((row) => ({
    id: row.id as string,
    shopId: row.shop_id as string,
    countedBy: row.counted_by as string,
    submittedAt: row.submitted_at as string,
  }));
  const shopName = new Map(
    (shopRows ?? []).map((row) => [row.id as string, row.name as string]),
  );

  // Counter display names ("Owner views all profiles" RLS).
  const counterIds = [...new Set(takes.map((take) => take.countedBy))];
  const counterName = new Map<string, string>();
  if (counterIds.length > 0) {
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", counterIds);
    for (const row of profileRows ?? []) {
      if (row.full_name) counterName.set(row.id as string, row.full_name as string);
    }
  }

  const queue: QueueEntry[] = takes.map((take) => ({
    id: take.id,
    shopName: shopName.get(take.shopId) ?? "Unknown shop",
    countedByName: counterName.get(take.countedBy) ?? "Unknown",
    submittedAt: take.submittedAt,
  }));

  const selected = takes.find((take) => take.id === takeParam) ?? takes[0];
  if (!selected) {
    return <ReviewView queue={queue} detail={null} />;
  }

  // The selected take's lines, read through the masking view — as the Owner,
  // expected_qty (the Variance basis) is visible here and nowhere below it.
  const { data: lineRows } = await supabase
    .from("stock_take_lines_visible")
    .select("id, item_id, expected_qty, counted_qty, skipped, counted_at")
    .eq("take_id", selected.id);

  const rawLines = (lineRows ?? []).map((row) => ({
    id: row.id as string,
    itemId: row.item_id as string,
    expectedQty: (row.expected_qty ?? null) as number | null,
    countedQty: (row.counted_qty ?? null) as number | null,
    skipped: Boolean(row.skipped),
    countedAt: (row.counted_at ?? null) as string | null,
  }));

  const itemIds = [...new Set(rawLines.map((line) => line.itemId))];
  const countedAts = rawLines
    .filter((line) => line.countedQty !== null && line.countedAt)
    .map((line) => line.countedAt as string);
  const earliestCountedAt =
    countedAts.length > 0
      ? countedAts.reduce((min, at) => (Date.parse(at) < Date.parse(min) ? at : min))
      : null;

  const [{ data: itemRows }, { data: movementRows }, { data: stockRows }] = await Promise.all([
    itemIds.length > 0
      ? supabase.from("items_catalog").select("id, category, name, attributes").in("id", itemIds)
      : Promise.resolve({ data: [] }),
    // Everything that moved on this Shop's counted Items since the first
    // snapshot — the per-line staleness comparison happens below.
    itemIds.length > 0 && earliestCountedAt
      ? supabase
          .from("stock_movements")
          .select("item_id, created_at")
          .eq("shop_id", selected.shopId)
          .in("item_id", itemIds)
          .gt("created_at", earliestCountedAt)
      : Promise.resolve({ data: [] }),
    itemIds.length > 0
      ? supabase
          .from("shop_stock")
          .select("item_id, quantity")
          .eq("shop_id", selected.shopId)
          .in("item_id", itemIds)
      : Promise.resolve({ data: [] }),
  ]);

  const itemById = new Map(
    (itemRows ?? []).map((row) => [
      row.id as string,
      {
        name: row.name as string,
        subline: itemSubline(row.category as Category, (row.attributes ?? {}) as Attributes),
      },
    ]),
  );
  const movementsByItem = new Map<string, number[]>();
  for (const row of movementRows ?? []) {
    const at = Date.parse(row.created_at as string);
    const list = movementsByItem.get(row.item_id as string);
    if (list) list.push(at);
    else movementsByItem.set(row.item_id as string, [at]);
  }
  const currentQty = new Map(
    (stockRows ?? []).map((row) => [row.item_id as string, row.quantity as number]),
  );

  const lines: ReviewDetailLine[] = rawLines
    .map((line) => {
      const item = itemById.get(line.itemId);
      const counted = line.countedQty !== null && line.countedAt !== null;
      const countedAtMs = counted ? Date.parse(line.countedAt as string) : 0;
      const stale =
        counted &&
        ((movementsByItem.get(line.itemId) ?? []).some((at) => at > countedAtMs) ||
          (currentQty.get(line.itemId) ?? 0) !== line.expectedQty);
      return {
        id: line.id,
        name: item?.name ?? "Unknown item",
        subline: item?.subline ?? "",
        expectedQty: line.expectedQty,
        countedQty: line.countedQty,
        skipped: line.skipped,
        stale,
      };
    })
    .sort((a, b) => {
      const rank = OUTCOME_ORDER[reviewOutcome(a)] - OUTCOME_ORDER[reviewOutcome(b)];
      return rank !== 0 ? rank : a.name.localeCompare(b.name);
    });

  const detail: ReviewDetail = {
    id: selected.id,
    shopName: shopName.get(selected.shopId) ?? "Unknown shop",
    countedByName: counterName.get(selected.countedBy) ?? "Unknown",
    submittedAt: selected.submittedAt,
    lines,
  };

  return <ReviewView queue={queue} detail={detail} />;
}

/** Review order: what needs a decision first, what recounts, what's settled. */
const OUTCOME_ORDER: Record<ReviewOutcome, number> = {
  variance: 0,
  stale: 1,
  verified: 2,
  skipped: 3,
};
