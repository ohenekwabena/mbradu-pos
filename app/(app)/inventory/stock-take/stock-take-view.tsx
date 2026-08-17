"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/icon";
import { checkSubmittable, takeProgress } from "@/lib/stock-take";

import {
  cancelStockTake,
  recordStockTakeLine,
  startStockTake,
  submitStockTake,
  type TakeFormState,
} from "./actions";

/** One carried Item offered by the scope picker — name and attributes only. */
export interface PickItem {
  id: string;
  name: string;
  subline: string;
}

/** One line of the open count. Deliberately carries **no expected quantity**
 * (blind entry — the page never even selects it); `countedQty` is what the
 * counter themselves entered. */
export interface CountLine {
  id: string;
  name: string;
  subline: string;
  countedQty: number | null;
  skipped: boolean;
}

const INITIAL: TakeFormState = { status: "idle" };

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

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * The blind Stock take screen (MP-35): an open session's count sheet, or the
 * start form when the Shop has none. Every mutation is a Server Action over
 * the stock-take RPCs; each revalidates this route, so the sheet re-renders
 * from the database (which is also what makes sessions resumable — the state
 * lives server-side, never in this component).
 */
export function StockTakeView({
  shopId,
  shopName,
  open,
  submittedAt,
  pickItems,
}: {
  shopId: string;
  shopName: string;
  open: { id: string; startedAt: string; lines: CountLine[] } | null;
  submittedAt: string | null;
  pickItems: PickItem[];
}) {
  if (open) {
    return <CountScreen shopName={shopName} take={open} />;
  }
  return (
    <StartScreen
      shopId={shopId}
      shopName={shopName}
      submittedAt={submittedAt}
      pickItems={pickItems}
    />
  );
}

// ---------------------------------------------------------------------------
// Start screen — scope picker (default: everything the Shop carries).
// ---------------------------------------------------------------------------

function StartScreen({
  shopId,
  shopName,
  submittedAt,
  pickItems,
}: {
  shopId: string;
  shopName: string;
  submittedAt: string | null;
  pickItems: PickItem[];
}) {
  const [state, formAction, pending] = useActionState(startStockTake, INITIAL);
  const [mode, setMode] = useState<"all" | "subset">("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pickItems;
    return pickItems.filter((item) => item.name.toLowerCase().includes(q));
  }, [pickItems, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      {submittedAt && (
        <div className="notice" role="status">
          <Icon name="history" />
          <span>
            A count submitted on <strong>{formatDay(submittedAt)}</strong> is awaiting the
            owner’s review. You can still start a new one.
          </span>
        </div>
      )}

      <div className="card">
        <h3 className="h3" style={{ margin: 0 }}>
          Start a stock take
        </h3>
        <p className="text-muted" style={{ margin: "8px 0 16px" }}>
          Count what’s physically on <strong>{shopName}</strong>’s shelves. Entry is{" "}
          <strong>blind</strong> — expected quantities stay hidden, so the count records
          what you actually see. Selling can continue while you count, and nothing
          changes stock until the owner reviews and approves.
        </p>

        {pickItems.length === 0 ? (
          <div className="empty">
            <div className="empty-ico">
              <Icon name="box" />
            </div>
            <p className="body-med" style={{ margin: 0 }}>
              Nothing to count
            </p>
            <p className="caption" style={{ marginTop: 4 }}>
              This shop doesn’t carry any items yet — restock something first.
            </p>
          </div>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="shop_id" value={shopId} />
            <input type="hidden" name="mode" value={mode} />
            {mode === "subset" &&
              [...selected].map((id) => (
                <input key={id} type="hidden" name="item_ids" value={id} />
              ))}

            <div className="pills" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={"pill" + (mode === "all" ? " active" : "")}
                onClick={() => setMode("all")}
              >
                Everything ({pickItems.length} {pickItems.length === 1 ? "item" : "items"})
              </button>
              <button
                type="button"
                className={"pill" + (mode === "subset" ? " active" : "")}
                onClick={() => setMode("subset")}
              >
                Pick items
              </button>
            </div>

            {mode === "subset" && (
              <div className="stack" style={{ gap: 8, marginBottom: 12 }}>
                <div className="search">
                  <Icon name="search" />
                  <input
                    placeholder="Search items by name…"
                    aria-label="Search items to count"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="stp-list">
                  {visible.length === 0 ? (
                    <p className="caption text-faint" style={{ padding: 14, margin: 0 }}>
                      No items match this search.
                    </p>
                  ) : (
                    visible.map((item) => (
                      <label key={item.id} className="stp-row">
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() => toggle(item.id)}
                        />
                        <span>
                          <span className="body-med">{item.name}</span>
                          {item.subline && (
                            <span className="caption text-muted" style={{ display: "block" }}>
                              {item.subline}
                            </span>
                          )}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <p className="caption text-muted" style={{ margin: 0 }}>
                  {selected.size} of {pickItems.length} selected
                </p>
              </div>
            )}

            {state.status === "error" && (
              <p className="err" style={{ marginBottom: 12 }}>
                <Icon name="alert" /> {state.message}
              </p>
            )}

            <button type="submit" className="btn btn-primary" disabled={pending}>
              <Icon name="list" /> {pending ? "Starting…" : "Start counting"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Count screen — the blind count sheet of the open session.
// ---------------------------------------------------------------------------

function CountScreen({
  shopName,
  take,
}: {
  shopName: string;
  take: { id: string; startedAt: string; lines: CountLine[] };
}) {
  const [confirm, setConfirm] = useState<"submit" | "cancel" | null>(null);

  const progress = takeProgress(take.lines);
  const submittable = checkSubmittable(take.lines);
  const done = progress.counted + progress.skipped;

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <div className="card">
        <div className="st-head">
          <div>
            <h3 className="h3" style={{ margin: 0 }}>
              Counting {shopName}
            </h3>
            <p className="caption text-muted" style={{ margin: "4px 0 0" }}>
              Started {formatDay(take.startedAt)} · {progress.total}{" "}
              {progress.total === 1 ? "line" : "lines"}
            </p>
          </div>
          <div className="st-progress-figures">
            <strong>{done}</strong> of {progress.total} done
            {progress.skipped > 0 && <> · {progress.skipped} skipped</>}
          </div>
        </div>
        <div
          className="st-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={done}
        >
          <span
            style={{ width: progress.total === 0 ? 0 : `${(done / progress.total) * 100}%` }}
          />
        </div>
      </div>

      <div className="notice" role="note">
        <Icon name="alert" />
        <span>
          <strong>Blind count</strong> — expected quantities are hidden on purpose. Enter
          exactly what’s on the shelf (0 is a real count), or skip a line you can’t count.
        </span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Item</th>
              <th>Status</th>
              <th className="num">Count</th>
            </tr>
          </thead>
          <tbody>
            {take.lines.map((line) => (
              <CountRow key={line.id} line={line} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="st-foot">
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => setConfirm("cancel")}
        >
          Cancel count
        </button>
        <div style={{ flex: 1 }} />
        {!submittable.ok && (
          <span className="caption text-muted">{submittable.reason}</span>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!submittable.ok}
          onClick={() => setConfirm("submit")}
        >
          <Icon name="check" /> Submit count
        </button>
      </div>

      {confirm === "submit" && (
        <SubmitModal
          takeId={take.id}
          counted={progress.counted}
          skipped={progress.skipped}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === "cancel" && (
        <CancelModal takeId={take.id} onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}

/** One count-sheet row: pending shows the entry form; a resolved line shows
 * its state with a Recount affordance (recounting refreshes the server-side
 * snapshot, which is exactly what review-time staleness wants). */
function CountRow({ line }: { line: CountLine }) {
  // Remount the row whenever the server-side resolution changes, so a
  // successful save closes edit mode without a setState-in-effect (the row's
  // edit state simply resets with the fresh server value).
  return <CountRowInner key={`${line.countedQty}|${line.skipped}`} line={line} />;
}

function CountRowInner({ line }: { line: CountLine }) {
  const [state, formAction, pending] = useActionState(recordStockTakeLine, INITIAL);
  const [editing, setEditing] = useState(false);

  const resolved = line.countedQty !== null || line.skipped;
  const showForm = !resolved || editing;

  return (
    <tr>
      <td>
        <div className="body-med">{line.name}</div>
        {line.subline && <div className="caption text-muted">{line.subline}</div>}
      </td>
      <td>
        {line.countedQty !== null ? (
          <span className="chip chip-success">Counted · {line.countedQty}</span>
        ) : line.skipped ? (
          <span className="chip chip-neutral">Skipped</span>
        ) : (
          <span className="chip chip-outline">Pending</span>
        )}
      </td>
      <td className="num">
        {showForm ? (
          <form action={formAction} className="st-count-form">
            <input type="hidden" name="line_id" value={line.id} />
            <input
              className="input"
              name="counted"
              type="text"
              inputMode="numeric"
              placeholder="Units"
              defaultValue={line.countedQty ?? ""}
              aria-label={`Counted units for ${line.name}`}
            />
            <button type="submit" name="intent" value="count" className="btn btn-primary" disabled={pending}>
              Save
            </button>
            <button type="submit" name="intent" value="skip" className="btn btn-secondary" disabled={pending}>
              Skip
            </button>
            {resolved && (
              <button
                type="button"
                className="row-act"
                aria-label={`Stop editing ${line.name}`}
                onClick={() => setEditing(false)}
              >
                <Icon name="x" />
              </button>
            )}
            {state.status === "error" && (
              <span className="err">
                <Icon name="alert" /> {state.message}
              </span>
            )}
          </form>
        ) : (
          <button
            type="button"
            className="row-act"
            title={line.skipped ? "Count this line" : "Recount"}
            aria-label={line.skipped ? `Count ${line.name}` : `Recount ${line.name}`}
            onClick={() => setEditing(true)}
          >
            <Icon name="edit" />
          </button>
        )}
      </td>
    </tr>
  );
}

/** Confirm submission: locks the sheet into `submitted` — no stock changes
 * until the Owner approves (MP-37). */
function SubmitModal({
  takeId,
  counted,
  skipped,
  onClose,
}: {
  takeId: string;
  counted: number;
  skipped: number;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(submitStockTake, INITIAL);
  useEscClose(onClose);

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Submit stock take">
        <form action={formAction}>
          <input type="hidden" name="take_id" value={takeId} />
          <div className="m-head">
            <h3 className="h3">Submit count</h3>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>
          <div className="m-body">
            <p style={{ margin: 0 }}>
              Submit this count — <strong>{counted} counted</strong>
              {skipped > 0 && (
                <>
                  , <strong>{skipped} skipped</strong>
                </>
              )}
              ? You won’t be able to edit it afterwards. Stock doesn’t change now — the
              owner reviews every difference first.
            </p>
            {state.status === "error" && (
              <p className="err" style={{ marginTop: 12 }}>
                <Icon name="alert" /> {state.message}
              </p>
            )}
          </div>
          <div className="m-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Keep counting
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Submitting…" : "Submit count"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Confirm cancelling the open session — nothing was ever posted. */
function CancelModal({ takeId, onClose }: { takeId: string; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(cancelStockTake, INITIAL);
  useEscClose(onClose);

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Cancel stock take">
        <form action={formAction}>
          <input type="hidden" name="take_id" value={takeId} />
          <div className="m-head">
            <h3 className="h3">Cancel stock take</h3>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>
          <div className="m-body">
            <p style={{ margin: 0 }}>
              Cancel this count? It closes without being submitted and{" "}
              <strong>nothing changes stock</strong>. You can start a fresh count anytime.
            </p>
            {state.status === "error" && (
              <p className="err" style={{ marginTop: 12 }}>
                <Icon name="alert" /> {state.message}
              </p>
            )}
          </div>
          <div className="m-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Keep counting
            </button>
            <button type="submit" className="btn btn-danger solid" disabled={pending}>
              {pending ? "Cancelling…" : "Cancel count"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
