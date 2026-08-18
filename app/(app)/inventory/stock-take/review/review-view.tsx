"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import { Icon } from "@/components/icon";
import {
  lineVariance,
  reviewOutcome,
  reviewSummary,
  VARIANCE_REASON_LABEL,
  VARIANCE_REASONS,
  type ReviewLine,
} from "@/lib/stock-take";

import type { TakeFormState } from "../actions";
import { approveStockTake, rejectStockTake } from "./actions";

/** One submitted take waiting in the queue. */
export interface QueueEntry {
  id: string;
  shopName: string;
  countedByName: string;
  submittedAt: string;
}

/** One line of the selected take, ready to review. `stale` was derived
 * server-side (movement after the snapshot, or quantity ≠ snapshot). */
export interface ReviewDetailLine extends ReviewLine {
  id: string;
  name: string;
  subline: string;
}

/** The selected take, opened for review. */
export interface ReviewDetail {
  id: string;
  shopName: string;
  countedByName: string;
  submittedAt: string;
  lines: ReviewDetailLine[];
}

const INITIAL: TakeFormState = { status: "idle" };

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Signed variance for display: surplus gets an explicit plus. */
function formatVariance(variance: number): string {
  return variance > 0 ? `+${variance}` : `${variance}`;
}

/** Esc-to-close for the confirm dialogs (mirrors the stock modals). */
function useEscClose(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/**
 * The Owner's review screen (MP-37): the queue of submitted takes and the
 * selected one's line-by-line verdicts. Approval is one form — a
 * classification select per postable Variance — submitted through a confirm
 * modal to the `approve_stock_take` RPC; rejection is its own small form over
 * `cancel_stock_take`. Both action states live *here* (not in the keyed
 * per-take child), so the outcome message survives the approved take leaving
 * the queue.
 */
export function ReviewView({
  queue,
  detail,
}: {
  queue: QueueEntry[];
  detail: ReviewDetail | null;
}) {
  const [approveState, approveAction, approvePending] = useActionState(approveStockTake, INITIAL);
  const [rejectState, rejectAction, rejectPending] = useActionState(rejectStockTake, INITIAL);

  return (
    <div className="stack" style={{ maxWidth: 960 }}>
      {approveState.status === "success" && (
        <div className="notice" role="status">
          <Icon name="check" />
          <span>{approveState.message}</span>
        </div>
      )}
      {rejectState.status === "success" && (
        <div className="notice" role="status">
          <Icon name="history" />
          <span>{rejectState.message}</span>
        </div>
      )}

      {queue.length === 0 ? (
        <EmptyQueue />
      ) : (
        <>
          {queue.length > 1 && detail && (
            <div className="pills">
              {queue.map((entry) => (
                <Link
                  key={entry.id}
                  href={`/inventory/stock-take/review?take=${entry.id}`}
                  className={"pill" + (entry.id === detail.id ? " active" : "")}
                >
                  {entry.shopName} · {formatDay(entry.submittedAt)}
                </Link>
              ))}
            </div>
          )}
          {detail && (
            <TakeReview
              key={detail.id}
              detail={detail}
              approveAction={approveAction}
              approvePending={approvePending}
              approveError={approveState.status === "error" ? approveState.message : null}
              rejectAction={rejectAction}
              rejectPending={rejectPending}
              rejectError={rejectState.status === "error" ? rejectState.message : null}
            />
          )}
        </>
      )}
    </div>
  );
}

function EmptyQueue() {
  return (
    <div className="card">
      <div className="empty">
        <div className="empty-ico">
          <Icon name="check" />
        </div>
        <p className="body-med" style={{ margin: 0 }}>
          No counts waiting for review
        </p>
        <p className="caption" style={{ marginTop: 4 }}>
          When a shop submits a stock take, it lands here for your approval.
        </p>
        <div className="row gap-8" style={{ marginTop: 12, justifyContent: "center" }}>
          <Link className="btn btn-secondary" href="/inventory/stock-take">
            <Icon name="list" /> Start a count
          </Link>
          <Link className="btn btn-secondary" href="/inventory/stock-take/history">
            <Icon name="history" /> Count history
          </Link>
        </div>
      </div>
    </div>
  );
}

/** The selected take: header, verdict table, approve / reject. Keyed by take
 * id in the parent, so the per-take classification state resets cleanly. */
function TakeReview({
  detail,
  approveAction,
  approvePending,
  approveError,
  rejectAction,
  rejectPending,
  rejectError,
}: {
  detail: ReviewDetail;
  approveAction: (formData: FormData) => void;
  approvePending: boolean;
  approveError: string | null;
  rejectAction: (formData: FormData) => void;
  rejectPending: boolean;
  rejectError: string | null;
}) {
  const [confirm, setConfirm] = useState<"approve" | "reject" | null>(null);
  // The chosen classification per postable line — controlled so the Approve
  // button can gate on "every difference classified" (the RPC re-enforces it).
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const summary = reviewSummary(detail.lines);
  const varianceLines = detail.lines.filter((line) => reviewOutcome(line) === "variance");
  const allClassified = varianceLines.every((line) => Boolean(reasons[line.id]));

  return (
    <>
      <form action={approveAction}>
        <input type="hidden" name="take_id" value={detail.id} />
        <div className="stack">
          <div className="card">
            <div className="st-head">
              <div>
                <h3 className="h3" style={{ margin: 0 }}>
                  Reviewing {detail.shopName}
                </h3>
                <p className="caption text-muted" style={{ margin: "4px 0 0" }}>
                  Submitted {formatDay(detail.submittedAt)} by {detail.countedByName} ·{" "}
                  {summary.total} {summary.total === 1 ? "line" : "lines"}
                </p>
              </div>
              <div className="chips" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className={"chip " + (summary.variance > 0 ? "chip-warning" : "chip-neutral")}>
                  {summary.variance} {summary.variance === 1 ? "difference" : "differences"}
                </span>
                <span className="chip chip-success">{summary.verified} verified</span>
                {summary.stale > 0 && (
                  <span className="chip chip-danger">{summary.stale} stale</span>
                )}
                {summary.skipped > 0 && (
                  <span className="chip chip-neutral">{summary.skipped} skipped</span>
                )}
              </div>
            </div>
          </div>

          {summary.stale > 0 && (
            <div className="notice" role="note">
              <Icon name="alert" />
              <span>
                <strong>
                  {summary.stale} {summary.stale === 1 ? "line went" : "lines went"} stale
                </strong>{" "}
                — stock moved after {summary.stale === 1 ? "it was" : "they were"} counted
                (a sale or restock during the count). Stale lines never post, so an honest
                counter is never blamed for a gap they didn’t cause; recount them in a
                fresh stock take.
              </span>
            </div>
          )}

          <div className="card" style={{ padding: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Expected</th>
                  <th className="num">Counted</th>
                  <th className="num">Variance</th>
                  <th>Classification</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line) => (
                  <ReviewRow
                    key={line.id}
                    line={line}
                    reason={reasons[line.id] ?? ""}
                    onReason={(value) =>
                      setReasons((prev) => ({ ...prev, [line.id]: value }))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="st-foot">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirm("reject")}
            >
              Reject count
            </button>
            <div style={{ flex: 1 }} />
            {!allClassified && (
              <span className="caption text-muted">
                Classify every difference before approving.
              </span>
            )}
            {approveError && (
              <span className="err">
                <Icon name="alert" /> {approveError}
              </span>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={!allClassified}
              onClick={() => setConfirm("approve")}
            >
              <Icon name="check" /> Approve & post
            </button>
          </div>
        </div>

        {confirm === "approve" && (
          <ApproveModal
            summary={summary}
            pending={approvePending}
            error={approveError}
            onClose={() => setConfirm(null)}
          />
        )}
      </form>

      {confirm === "reject" && (
        <RejectModal
          takeId={detail.id}
          formAction={rejectAction}
          pending={rejectPending}
          error={rejectError}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}

/** One verdict row. Only a postable Variance gets the classification controls. */
function ReviewRow({
  line,
  reason,
  onReason,
}: {
  line: ReviewDetailLine;
  reason: string;
  onReason: (value: string) => void;
}) {
  const outcome = reviewOutcome(line);
  const variance = lineVariance(line);

  return (
    <tr>
      <td>
        <div className="body-med">{line.name}</div>
        {line.subline && <div className="caption text-muted">{line.subline}</div>}
      </td>
      <td className="num">{line.expectedQty ?? "—"}</td>
      <td className="num">
        {outcome === "skipped" ? (
          <span className="chip chip-neutral">Skipped</span>
        ) : (
          line.countedQty
        )}
      </td>
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
        {outcome === "variance" ? (
          <div className="stack" style={{ gap: 6 }}>
            <select
              className="input"
              name={`reason_${line.id}`}
              value={reason}
              onChange={(e) => onReason(e.target.value)}
              aria-label={`Classify the variance for ${line.name}`}
            >
              <option value="">Classify…</option>
              {VARIANCE_REASONS.map((value) => (
                <option key={value} value={value}>
                  {VARIANCE_REASON_LABEL[value]}
                </option>
              ))}
            </select>
            <input
              className="input"
              name={`note_${line.id}`}
              type="text"
              placeholder="Note (optional)"
              aria-label={`Note for ${line.name}`}
            />
          </div>
        ) : outcome === "verified" ? (
          <span className="chip chip-success">Verified correct</span>
        ) : outcome === "stale" ? (
          <span className="chip chip-danger">Stale — recount</span>
        ) : (
          <span className="caption text-muted">Not counted</span>
        )}
      </td>
    </tr>
  );
}

/** Confirm approval — the submit button of the surrounding classification
 * form, so everything chosen in the table rides along. */
function ApproveModal({
  summary,
  pending,
  error,
  onClose,
}: {
  summary: ReturnType<typeof reviewSummary>;
  pending: boolean;
  error: string | null;
  onClose: () => void;
}) {
  useEscClose(onClose);

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Approve stock take">
        <div className="m-head">
          <h3 className="h3">Approve count</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="m-body">
          <p style={{ margin: 0 }}>
            Approve this count?{" "}
            <strong>
              {summary.variance} {summary.variance === 1 ? "variance" : "variances"}
            </strong>{" "}
            will post to the ledger and stock will move to the counted values
            {summary.stale > 0 && (
              <>
                ; <strong>{summary.stale} stale</strong>{" "}
                {summary.stale === 1 ? "line is" : "lines are"} excluded and will need a
                recount
              </>
            )}
            . This can’t be undone — later fixes are new ledger entries.
          </p>
          {error && (
            <p className="err" style={{ marginTop: 12 }}>
              <Icon name="alert" /> {error}
            </p>
          )}
        </div>
        <div className="m-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Keep reviewing
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Approving…" : "Approve & post"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Confirm rejection — its own small form (outside the classification form),
 * since rejecting posts nothing and needs only the take id. */
function RejectModal({
  takeId,
  formAction,
  pending,
  error,
  onClose,
}: {
  takeId: string;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error: string | null;
  onClose: () => void;
}) {
  useEscClose(onClose);

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Reject stock take">
        <form action={formAction}>
          <input type="hidden" name="take_id" value={takeId} />
          <div className="m-head">
            <h3 className="h3">Reject count</h3>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>
          <div className="m-body">
            <p style={{ margin: 0 }}>
              Reject this count? <strong>Nothing posts to the ledger</strong> and stock
              stays as it is; the count is kept for the audit trail. The shop can simply
              count again.
            </p>
            {error && (
              <p className="err" style={{ marginTop: 12 }}>
                <Icon name="alert" /> {error}
              </p>
            )}
          </div>
          <div className="m-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Keep reviewing
            </button>
            <button type="submit" className="btn btn-danger solid" disabled={pending}>
              {pending ? "Rejecting…" : "Reject count"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
