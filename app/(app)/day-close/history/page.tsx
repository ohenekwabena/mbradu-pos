import Link from "next/link";

import { Icon } from "@/components/icon";
import { NotOwner } from "@/components/shell/not-owner";
import { getCurrentProfile } from "@/lib/dal";
import { overShortKind, type OverShortKind } from "@/lib/day-close";
import { format } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

/** How an Over/short leaning reads in the list. Short is the cash-skim signal
 * (danger); an overage is odd but milder (warning); balanced is the good day. */
const OVER_SHORT_META: Record<OverShortKind, { label: string; chip: string }> = {
  short: { label: "Short", chip: "chip-danger" },
  over: { label: "Over", chip: "chip-warning" },
  balanced: { label: "Balanced", chip: "chip-success" },
};

/** A `day_closes` row as selected below. */
type DayCloseRow = {
  id: string;
  shop_id: string;
  close_date: string;
  declared_pesewas: number;
  expected_pesewas: number;
  over_short_pesewas: number;
  stale: boolean;
  note: string | null;
  actor: string | null;
  created_at: string;
};

/**
 * The Owner's cash-audit trail (ADR-0007, MP-41): every Day close, newest
 * first, filterable per Shop (`?shop=`) — declared vs the server-computed
 * expected, the signed **Over/short**, the stale marker, the declarer's note,
 * and who declared. Over/short is evidence, not workflow: there is no approval
 * step or classification here — the Owner reads the pattern and follows up in
 * person.
 *
 * Owner-only: Over/short and expected drawer cash are the money the blind
 * declaration exists to protect. RLS is the hard boundary (`day_closes` SELECT
 * is Owner-only); this page is the UI half. Volume stays small at v1 scale
 * (one row per Shop per day), so the list is unpaginated — a date window can
 * bound it later, like /sales.
 */
export default async function DayCloseHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can view day-close history." />;
  }

  const { shop: shopParam } = await searchParams;
  const supabase = await createClient();

  const { data: shopRows } = await supabase.from("shops").select("id, name").order("name");
  const shops = (shopRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
  }));
  const shopFilter = shops.some((shop) => shop.id === shopParam) ? (shopParam as string) : null;

  let closesQuery = supabase
    .from("day_closes")
    .select(
      "id, shop_id, close_date, declared_pesewas, expected_pesewas, over_short_pesewas, stale, note, actor, created_at",
    )
    .order("close_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (shopFilter) closesQuery = closesQuery.eq("shop_id", shopFilter);
  const { data: closeRows } = await closesQuery;
  const closes = (closeRows ?? []) as unknown as DayCloseRow[];

  // Declarer display names ("Owner views all profiles" RLS).
  const actorIds = [...new Set(closes.map((row) => row.actor).filter((id): id is string => id !== null))];
  const actorName = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    for (const row of profileRows ?? []) {
      if (row.full_name) actorName.set(row.id as string, row.full_name as string);
    }
  }

  const shopName = new Map(shops.map((shop) => [shop.id, shop.name]));

  return (
    <>
      <Link className="crumb" href="/day-close">
        <Icon name="back" /> Day close
      </Link>

      <div className="stack" style={{ maxWidth: 1040 }}>
        <div className="pills">
          <Link
            href="/day-close/history"
            className={"pill" + (shopFilter === null ? " active" : "")}
          >
            All shops
          </Link>
          {shops.map((shop) => (
            <Link
              key={shop.id}
              href={`/day-close/history?shop=${shop.id}`}
              className={"pill" + (shop.id === shopFilter ? " active" : "")}
            >
              {shop.name}
            </Link>
          ))}
        </div>

        <div className="card" style={{ padding: 0 }}>
          {closes.length === 0 ? (
            <div className="empty" style={{ padding: "28px 0" }}>
              <div className="empty-ico">
                <Icon name="cash" />
              </div>
              <p className="body-med" style={{ margin: 0 }}>
                No day closes yet
              </p>
              <p className="caption" style={{ marginTop: 4 }}>
                {shopFilter
                  ? "This shop hasn’t closed a day yet."
                  : "Declarations land here as shops close their days."}
              </p>
              <Link className="btn btn-secondary" href="/day-close" style={{ marginTop: 12 }}>
                <Icon name="cash" /> Close a day
              </Link>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Shop</th>
                    <th>Declared by</th>
                    <th className="num">Declared</th>
                    <th className="num">Expected</th>
                    <th className="num">Over/short</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {closes.map((row) => {
                    const kind = overShortKind(row.over_short_pesewas);
                    const meta = OVER_SHORT_META[kind];
                    const recordedDay = dateKeyOf(row.created_at);
                    return (
                      <tr key={row.id}>
                        <td>
                          <div className="body-med">{formatDay(row.close_date)}</div>
                          {recordedDay !== row.close_date && (
                            <div className="caption text-faint">
                              recorded {formatDay(recordedDay)}
                            </div>
                          )}
                        </td>
                        <td>{shopName.get(row.shop_id) ?? "Unknown shop"}</td>
                        <td>{(row.actor && actorName.get(row.actor)) ?? "Unknown"}</td>
                        <td className="num tnum">{format(row.declared_pesewas)}</td>
                        <td className="num tnum">{format(row.expected_pesewas)}</td>
                        <td className="num">
                          <span className={`chip ${meta.chip}`}>
                            {kind === "balanced"
                              ? meta.label
                              : `${meta.label} ${format(Math.abs(row.over_short_pesewas))}`}
                          </span>
                          {row.stale && (
                            <span
                              className="chip chip-neutral"
                              style={{ marginLeft: 6 }}
                              title="A sale rang at this shop after the day ended, before the drawer was declared — recorded, but it can no longer be verified against the day."
                            >
                              Stale
                            </span>
                          )}
                        </td>
                        <td className="caption text-muted">
                          {row.note ?? <span className="text-faint">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** "2026-08-18" → "18 Aug 2026" (a date key parses as UTC midnight, so the
 * rendered day never drifts — mirrors the stock-take history's formatDay). */
function formatDay(dateKey: string): string {
  return new Date(dateKey).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The UTC `YYYY-MM-DD` day of an ISO instant (the Ghana day is the UTC day). */
function dateKeyOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
