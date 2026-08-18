import Link from "next/link";
import { notFound } from "next/navigation";

import { Icon } from "@/components/icon";
import { NotOwner } from "@/components/shell/not-owner";
import { type Attributes, type Category } from "@/lib/catalog";
import { getCurrentProfile } from "@/lib/dal";
import { format } from "@/lib/money";
import {
  historyOutcome,
  historySummary,
  lineVariance,
  unexplainedLossPesewas,
  VARIANCE_REASON_LABEL,
  type HistoryLine,
  type HistoryOutcome,
  type StockTakeStatus,
  type VarianceReason,
} from "@/lib/stock-take";
import { createClient } from "@/lib/supabase/server";

import { itemSubline } from "../../item-subline";
import { formatDay, TAKE_STATUS_META } from "../take-status";

/** A history line joined to its Item and count timestamp, ready to render. */
interface DetailLine extends HistoryLine {
  id: string;
  name: string;
  subline: string;
  countedAt: string | null;
  varianceNote: string | null;
}

/**
 * One Stock take's audit record (ADR-0006, MP-38): the session's timeline
 * (started / submitted / approved and by whom), its coverage, its unexplained
 * loss valued at current Item cost, and every line's expected / counted /
 * Variance / classification — zero-variance lines included, standing as
 * "verified correct on this date".
 *
 * Everything shown is the *stored* verdict: `stale` is the flag approval
 * wrote, never re-derived (movements since approval must not rewrite
 * history), and a still-submitted take points at the review screen instead of
 * guessing staleness here. Owner-only, like every Variance surface.
 */
export default async function StockTakeHistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can view stock-take history." />;
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data: takeRow } = await supabase
    .from("stock_takes")
    .select("id, shop_id, counted_by, status, created_at, submitted_at, approved_at, approved_by")
    .eq("id", id)
    .maybeSingle();
  if (!takeRow) notFound();

  const take = {
    id: takeRow.id as string,
    shopId: takeRow.shop_id as string,
    countedBy: takeRow.counted_by as string,
    status: takeRow.status as StockTakeStatus,
    createdAt: takeRow.created_at as string,
    submittedAt: (takeRow.submitted_at ?? null) as string | null,
    approvedAt: (takeRow.approved_at ?? null) as string | null,
    approvedBy: (takeRow.approved_by ?? null) as string | null,
  };

  const [{ data: shopRow }, { data: lineRows }] = await Promise.all([
    supabase.from("shops").select("name").eq("id", take.shopId).maybeSingle(),
    supabase
      .from("stock_take_lines_visible")
      .select(
        "id, item_id, expected_qty, counted_qty, skipped, counted_at, stale, variance_reason, variance_note",
      )
      .eq("take_id", take.id),
  ]);
  const shopName = (shopRow?.name as string | undefined) ?? "Unknown shop";

  const rawLines = (lineRows ?? []).map((row) => ({
    id: row.id as string,
    itemId: row.item_id as string,
    expectedQty: (row.expected_qty ?? null) as number | null,
    countedQty: (row.counted_qty ?? null) as number | null,
    skipped: Boolean(row.skipped),
    countedAt: (row.counted_at ?? null) as string | null,
    stale: Boolean(row.stale),
    varianceReason: (row.variance_reason ?? null) as VarianceReason | null,
    varianceNote: (row.variance_note ?? null) as string | null,
  }));

  // Names for the counter and approver, and the lines' Items (with cost for
  // the loss valuation — archived Items stay resolvable; history is history).
  const personIds = [...new Set([take.countedBy, take.approvedBy].filter(Boolean) as string[])];
  const itemIds = [...new Set(rawLines.map((line) => line.itemId))];
  const [{ data: profileRows }, { data: itemRows }] = await Promise.all([
    personIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", personIds)
      : Promise.resolve({ data: [] }),
    itemIds.length > 0
      ? supabase
          .from("items_catalog")
          .select("id, category, name, attributes, cost_pesewas")
          .in("id", itemIds)
      : Promise.resolve({ data: [] }),
  ]);

  const personName = new Map<string, string>();
  for (const row of profileRows ?? []) {
    if (row.full_name) personName.set(row.id as string, row.full_name as string);
  }
  const itemById = new Map(
    (itemRows ?? []).map((row) => [
      row.id as string,
      {
        name: row.name as string,
        subline: itemSubline(row.category as Category, (row.attributes ?? {}) as Attributes),
      },
    ]),
  );
  const costByItem = new Map(
    (itemRows ?? []).map((row) => [row.id as string, (row.cost_pesewas ?? 0) as number]),
  );

  const lines: DetailLine[] = rawLines
    .map((line) => {
      const item = itemById.get(line.itemId);
      return {
        ...line,
        name: item?.name ?? "Unknown item",
        subline: item?.subline ?? "",
      };
    })
    .sort((a, b) => {
      const rank = OUTCOME_ORDER[historyOutcome(a)] - OUTCOME_ORDER[historyOutcome(b)];
      return rank !== 0 ? rank : a.name.localeCompare(b.name);
    });

  const summary = historySummary(lines);
  const loss = take.status === "approved" ? unexplainedLossPesewas(lines, costByItem) : null;

  // The attribution window this take closes: since the Shop's previous
  // approved count (loss between two counts belongs to the Shop, ADR-0006).
  let windowText: string | null = null;
  if (take.status === "approved") {
    const { data: prevRow } = await supabase
      .from("stock_takes")
      .select("created_at")
      .eq("shop_id", take.shopId)
      .eq("status", "approved")
      .lt("created_at", take.createdAt)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    windowText = prevRow
      ? `since the previous approved count on ${formatDay(prevRow.created_at as string)}`
      : "since this shop started counting (its first approved count)";
  }

  const countedByName = personName.get(take.countedBy) ?? "Unknown";
  const approvedByName = take.approvedBy ? (personName.get(take.approvedBy) ?? "Unknown") : null;
  const timeline = [`Started ${formatDay(take.createdAt)} by ${countedByName}`];
  if (take.submittedAt) timeline.push(`submitted ${formatDay(take.submittedAt)}`);
  if (take.approvedAt) {
    timeline.push(
      `approved ${formatDay(take.approvedAt)}${approvedByName ? ` by ${approvedByName}` : ""}`,
    );
  }

  return (
    <>
      <Link className="crumb" href="/inventory/stock-take/history">
        <Icon name="back" /> Count history
      </Link>

      <div className="stack" style={{ maxWidth: 960 }}>
        <div className="card">
          <div className="st-head">
            <div>
              <h3 className="h3" style={{ margin: 0 }}>
                {shopName} — {formatDay(take.createdAt)}
              </h3>
              <p className="caption text-muted" style={{ margin: "4px 0 0" }}>
                {timeline.join(" · ")} · {summary.total} {summary.total === 1 ? "line" : "lines"}
              </p>
            </div>
            <div className="chips" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className={"chip " + TAKE_STATUS_META[take.status].chip}>
                {TAKE_STATUS_META[take.status].label}
              </span>
              <span className={"chip " + (summary.variance > 0 ? "chip-warning" : "chip-neutral")}>
                {summary.variance} {summary.variance === 1 ? "difference" : "differences"}
              </span>
              <span className="chip chip-success">{summary.verified} verified</span>
              {summary.stale > 0 && <span className="chip chip-danger">{summary.stale} stale</span>}
              {summary.skipped > 0 && (
                <span className="chip chip-neutral">{summary.skipped} skipped</span>
              )}
              {summary.pending > 0 && (
                <span className="chip chip-neutral">{summary.pending} pending</span>
              )}
            </div>
          </div>
        </div>

        {take.status === "approved" && loss !== null && (
          <div className="notice" role="note">
            <Icon name={loss > 0 ? "alert" : "check"} />
            <span>
              {loss > 0 ? (
                <>
                  <strong>Unexplained loss: {format(loss)}</strong> — missing units valued at
                  current item cost, attributed to {shopName} {windowText}.
                </>
              ) : (
                <>
                  <strong>No unexplained loss</strong> — every difference was explained or
                  verified correct, covering {shopName} {windowText}.
                </>
              )}
            </span>
          </div>
        )}

        {take.status === "submitted" && (
          <div className="notice" role="note">
            <Icon name="alert" />
            <span>
              This count is <strong>awaiting review</strong> — nothing has posted yet.{" "}
              <Link href={`/inventory/stock-take/review?take=${take.id}`}>Review &amp; approve</Link>
            </span>
          </div>
        )}

        {take.status === "open" && (
          <div className="notice" role="note">
            <Icon name="history" />
            <span>
              This count is <strong>still in progress</strong> at {shopName} — lines fill in as
              they’re counted.
            </span>
          </div>
        )}

        {take.status === "cancelled" && (
          <div className="notice" role="note">
            <Icon name="history" />
            <span>
              This count was <strong>cancelled</strong> — nothing posted to the ledger; the lines
              are kept for the audit trail.
            </span>
          </div>
        )}

        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Expected</th>
                  <th className="num">Counted</th>
                  <th className="num">Variance</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <DetailRow key={line.id} status={take.status} line={line} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

/** Detail order: differences first, then recounts, then the settled rest. */
const OUTCOME_ORDER: Record<HistoryOutcome, number> = {
  variance: 0,
  stale: 1,
  verified: 2,
  skipped: 3,
  pending: 4,
};

/** Chip palette per classification — `unexplained` is the theft signal. */
const REASON_CHIP: Record<VarianceReason, string> = {
  damaged: "chip-warning",
  expired: "chip-warning",
  other: "chip-neutral",
  unexplained: "chip-danger",
};

function formatVariance(variance: number): string {
  return variance > 0 ? `+${variance}` : `${variance}`;
}

/** One line of the audit record. What the Outcome column says depends on the
 * take's status: only an approved take has settled verdicts. */
function DetailRow({ status, line }: { status: StockTakeStatus; line: DetailLine }) {
  const outcome = historyOutcome(line);
  const variance = lineVariance(line);

  return (
    <tr>
      <td>
        <div className="body-med">{line.name}</div>
        {line.subline && <div className="caption text-muted">{line.subline}</div>}
      </td>
      <td className="num">{line.expectedQty ?? "—"}</td>
      <td className="num">{line.countedQty ?? "—"}</td>
      <td className="num">
        {variance === null ? (
          "—"
        ) : variance === 0 ? (
          <span className="chip chip-success">0</span>
        ) : (
          <span className={"chip " + (variance < 0 ? "chip-danger" : "chip-warning")}>
            {formatVariance(variance)}
          </span>
        )}
      </td>
      <td>
        <OutcomeCell status={status} line={line} outcome={outcome} />
      </td>
    </tr>
  );
}

function OutcomeCell({
  status,
  line,
  outcome,
}: {
  status: StockTakeStatus;
  line: DetailLine;
  outcome: HistoryOutcome;
}) {
  if (outcome === "skipped") return <span className="chip chip-neutral">Skipped</span>;
  if (outcome === "pending") return <span className="caption text-muted">Not yet counted</span>;

  if (status === "approved") {
    if (outcome === "stale") return <span className="chip chip-danger">Stale — recount</span>;
    if (outcome === "verified") {
      return (
        <div>
          <span className="chip chip-success">Verified correct</span>
          {line.countedAt && (
            <div className="caption text-muted">on {formatDay(line.countedAt)}</div>
          )}
        </div>
      );
    }
    // A posted Variance — the approval RPC refuses any without a classification.
    return (
      <div>
        <span className={"chip " + (line.varianceReason ? REASON_CHIP[line.varianceReason] : "chip-neutral")}>
          {line.varianceReason ? VARIANCE_REASON_LABEL[line.varianceReason] : "Posted"}
        </span>
        {line.varianceNote && <div className="caption text-muted">{line.varianceNote}</div>}
      </div>
    );
  }

  if (status === "submitted") return <span className="caption text-muted">Awaiting review</span>;
  if (status === "cancelled") return <span className="caption text-muted">Not settled</span>;
  return <span className="caption text-muted">Counted</span>;
}
