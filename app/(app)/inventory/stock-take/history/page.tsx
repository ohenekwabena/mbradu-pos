import Link from "next/link";

import { Icon } from "@/components/icon";
import { NotOwner } from "@/components/shell/not-owner";
import { getCurrentProfile } from "@/lib/dal";
import { format } from "@/lib/money";
import {
  historySummary,
  unexplainedLossPesewas,
  type HistoryLine,
  type HistorySummary,
  type StockTakeStatus,
} from "@/lib/stock-take";
import { createClient } from "@/lib/supabase/server";

import { formatDay, TAKE_STATUS_META } from "./take-status";

/**
 * The Owner's Stock-take history (ADR-0006, MP-38): every counting session,
 * newest first, filterable per Shop (`?shop=`), each with its status, its
 * coverage (counted / skipped / stale), and — once approved — its unexplained
 * loss valued at current Item cost. Read per Shop top-to-bottom, consecutive
 * approved takes are the between-counts attribution windows CONTEXT.md
 * promises ("Osu lost GH₵X unexplained between the Mar 1 and Mar 8 takes").
 *
 * Owner-only: Variances and Shrinkage sit in the same visibility family as
 * cost/margin. RLS is the hard boundary (`stock_take_lines_visible` masks the
 * verdict columns for a Cashier); this page is the UI half. Volume stays
 * small at v1 scale (a handful of Shops counting weekly), so the list is
 * unpaginated — a date window can bound it later, like /sales.
 */
export default async function StockTakeHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can view stock-take history." />;
  }

  const { shop: shopParam } = await searchParams;
  const supabase = await createClient();

  const { data: shopRows } = await supabase.from("shops").select("id, name").order("name");
  const shops = (shopRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
  }));
  const shopFilter = shops.some((shop) => shop.id === shopParam) ? (shopParam as string) : null;

  let takesQuery = supabase
    .from("stock_takes")
    .select("id, shop_id, counted_by, status, created_at")
    .order("created_at", { ascending: false });
  if (shopFilter) takesQuery = takesQuery.eq("shop_id", shopFilter);
  const { data: takeRows } = await takesQuery;

  const takes = (takeRows ?? []).map((row) => ({
    id: row.id as string,
    shopId: row.shop_id as string,
    countedBy: row.counted_by as string,
    status: row.status as StockTakeStatus,
    createdAt: row.created_at as string,
  }));

  // Every listed take's lines in one read (verdict columns are Owner-visible
  // here), grouped per take for the coverage tallies and the loss totals.
  const takeIds = takes.map((take) => take.id);
  const { data: lineRows } =
    takeIds.length > 0
      ? await supabase
          .from("stock_take_lines_visible")
          .select("take_id, item_id, expected_qty, counted_qty, skipped, stale, variance_reason")
          .in("take_id", takeIds)
      : { data: [] };

  const linesByTake = new Map<string, HistoryLine[]>();
  for (const row of lineRows ?? []) {
    const line: HistoryLine = {
      itemId: row.item_id as string,
      expectedQty: (row.expected_qty ?? null) as number | null,
      countedQty: (row.counted_qty ?? null) as number | null,
      skipped: Boolean(row.skipped),
      stale: Boolean(row.stale),
      varianceReason: (row.variance_reason ?? null) as HistoryLine["varianceReason"],
    };
    const list = linesByTake.get(row.take_id as string);
    if (list) list.push(line);
    else linesByTake.set(row.take_id as string, [line]);
  }

  // Current cost for the Items behind unexplained losses (Owner-only money —
  // the cost-masking view yields it to the Owner, and this page is Owner-only).
  const unexplainedItemIds = [
    ...new Set(
      [...linesByTake.values()]
        .flat()
        .filter((line) => line.varianceReason === "unexplained")
        .map((line) => line.itemId),
    ),
  ];
  const { data: costRows } =
    unexplainedItemIds.length > 0
      ? await supabase.from("items_catalog").select("id, cost_pesewas").in("id", unexplainedItemIds)
      : { data: [] };
  const costByItem = new Map(
    (costRows ?? []).map((row) => [row.id as string, (row.cost_pesewas ?? 0) as number]),
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

  const shopName = new Map(shops.map((shop) => [shop.id, shop.name]));
  const entries = takes.map((take) => {
    const lines = linesByTake.get(take.id) ?? [];
    return {
      ...take,
      shopName: shopName.get(take.shopId) ?? "Unknown shop",
      countedByName: counterName.get(take.countedBy) ?? "Unknown",
      summary: historySummary(lines),
      lossPesewas:
        take.status === "approved" ? unexplainedLossPesewas(lines, costByItem) : null,
    };
  });

  return (
    <>
      <Link className="crumb" href="/inventory">
        <Icon name="back" /> Inventory
      </Link>

      <div className="stack" style={{ maxWidth: 960 }}>
        <div className="pills">
          <Link
            href="/inventory/stock-take/history"
            className={"pill" + (shopFilter === null ? " active" : "")}
          >
            All shops
          </Link>
          {shops.map((shop) => (
            <Link
              key={shop.id}
              href={`/inventory/stock-take/history?shop=${shop.id}`}
              className={"pill" + (shop.id === shopFilter ? " active" : "")}
            >
              {shop.name}
            </Link>
          ))}
        </div>

        <div className="card" style={{ padding: 0 }}>
          {entries.length === 0 ? (
            <div className="empty" style={{ padding: "28px 0" }}>
              <div className="empty-ico">
                <Icon name="history" />
              </div>
              <p className="body-med" style={{ margin: 0 }}>
                No stock takes yet
              </p>
              <p className="caption" style={{ marginTop: 4 }}>
                {shopFilter
                  ? "This shop hasn’t counted yet."
                  : "Counts land here as shops record them."}
              </p>
              <Link
                className="btn btn-secondary"
                href="/inventory/stock-take"
                style={{ marginTop: 12 }}
              >
                <Icon name="list" /> Start a count
              </Link>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Shop</th>
                    <th>Status</th>
                    <th>Counted by</th>
                    <th>Coverage</th>
                    <th className="num">Unexplained loss</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <Link
                          className="body-med"
                          href={`/inventory/stock-take/history/${entry.id}`}
                        >
                          {formatDay(entry.createdAt)}
                        </Link>
                      </td>
                      <td>{entry.shopName}</td>
                      <td>
                        <span className={"chip " + TAKE_STATUS_META[entry.status].chip}>
                          {TAKE_STATUS_META[entry.status].label}
                        </span>
                      </td>
                      <td>{entry.countedByName}</td>
                      <td className="caption text-muted">{coverageText(entry.summary)}</td>
                      <td className="num tnum">
                        {entry.lossPesewas === null ? (
                          <span className="text-faint">—</span>
                        ) : (
                          format(entry.lossPesewas)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** One-line coverage: how much of the scope was actually counted. */
function coverageText(summary: HistorySummary): string {
  if (summary.total === 0) return "No lines";
  const parts =
    summary.pending > 0
      ? [`${summary.counted} of ${summary.total} counted`]
      : [`${summary.counted} counted`];
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  if (summary.stale > 0) parts.push(`${summary.stale} stale`);
  return parts.join(" · ");
}
