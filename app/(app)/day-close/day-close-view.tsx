"use client";

import { useActionState, useEffect, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import { Icon } from "@/components/icon";
import { CEDI_SYMBOL, format, tryParse } from "@/lib/money";

import { recordDayClose, type DayCloseFormState } from "./actions";

const INITIAL: DayCloseFormState = { status: "idle" };

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-06-05" → "5 Jun 2026". */
function prettyDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** `dateKey` shifted by `days` (UTC math — the Ghana day is the UTC day). */
function addDaysUtc(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Esc-to-close for the confirm dialog (mirrors the stock-take modals). */
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
 * The blind Day close screen (ADR-0007, MP-40). One card: pick the day (today,
 * or an earlier missed day), enter the counted drawer as a GH₵ amount, add an
 * optional note, and confirm. **No expected figure appears anywhere** — the
 * declarer's only feedback is "recorded"; the comparison against Float + the
 * day's cash is computed and kept server-side, Owner-only. When today is
 * already closed the card says so, with the form tucked behind an
 * "earlier day" control for catching up on a missed close.
 */
export function DayCloseView({
  shopId,
  shopName,
  today,
  todayClosed,
}: {
  shopId: string;
  shopName: string;
  today: string;
  todayClosed: boolean;
}) {
  const [state, formAction, pending] = useActionState(recordDayClose, INITIAL);
  // A fresh visit to an already-closed day tucks the form away and seeds the
  // date to yesterday (the likeliest catch-up target); otherwise today.
  const [showForm, setShowForm] = useState(!todayClosed);
  const [closeDate, setCloseDate] = useState(todayClosed ? addDaysUtc(today, -1) : today);
  // Controlled so the confirm dialog can play the amount back for a last look.
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);

  if (state.status === "success") {
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="empty-ico" style={{ marginBottom: 12 }}>
          <Icon name="check" />
        </div>
        <h2 className="h2">{state.message}</h2>
        <p className="text-muted" style={{ margin: "8px 0 0" }}>
          Thanks — the declaration for {shopName} is in. The owner reviews the
          day’s balance; there’s nothing else to do here.
        </p>
      </div>
    );
  }

  const parsedAmount = tryParse(amount);

  return (
    <div className="stack" style={{ maxWidth: 560, gap: 16 }}>
      {todayClosed && (
        <div className="notice" role="note">
          <Icon name="check" />
          <span>
            <strong>Today’s drawer is already recorded</strong> for {shopName} —{" "}
            {prettyDate(today)} is closed.
          </span>
        </div>
      )}

      {!showForm ? (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ alignSelf: "flex-start" }}
          onClick={() => setShowForm(true)}
        >
          Close an earlier day
        </button>
      ) : (
        <form action={formAction} className="card">
          <input type="hidden" name="shop_id" value={shopId} />
          <input type="hidden" name="close_date" value={closeDate} />

          <h2 className="h2" style={{ marginBottom: 4 }}>
            Close the day — {shopName}
          </h2>
          <p className="text-muted" style={{ margin: "0 0 18px" }}>
            Count every note and coin in the drawer and enter the total. There’s
            no figure to match — just record what you counted, and the owner
            takes it from there. Close each day before the next day’s selling
            starts; a later close is still recorded, but can no longer be
            verified against that day.
          </p>

          <div className="stack" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="dc-date">Day to close</label>
              <DatePicker
                id="dc-date"
                value={closeDate}
                onChange={setCloseDate}
                max={today}
                aria-label="Day to close"
              />
              <span className="help">
                Today, or an earlier day that was missed.
              </span>
            </div>

            <div className="field">
              <label htmlFor="dc-amount">Counted drawer cash ({CEDI_SYMBOL})</label>
              <input
                id="dc-amount"
                className="input tnum"
                name="declared_amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoComplete="off"
              />
              <span className="help">
                Cash only — MoMo, card, and transfers are reconciled from
                provider statements, not the drawer.
              </span>
            </div>

            <div className="field">
              <label htmlFor="dc-note">Note (optional)</label>
              <textarea
                id="dc-note"
                className="input"
                name="note"
                rows={2}
                placeholder="e.g. two torn GH₵ 10 notes set aside"
              />
            </div>
          </div>

          {state.status === "error" && !confirming && (
            <p className="err" style={{ marginTop: 14 }}>
              <Icon name="alert" /> {state.message}
            </p>
          )}

          <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={parsedAmount === null || parsedAmount < 0}
              onClick={() => setConfirming(true)}
            >
              <Icon name="cash" /> Record day close
            </button>
          </div>

          {confirming && (
            <ConfirmModal
              shopName={shopName}
              closeDate={closeDate}
              amountPesewas={parsedAmount}
              pending={pending}
              error={state.status === "error" ? state.message : null}
              onClose={() => setConfirming(false)}
            />
          )}
        </form>
      )}
    </div>
  );
}

/** Confirm the declaration — the submit button of the surrounding form, so the
 * typed fields ride along. Plays back only what the declarer themselves typed
 * (never a computed figure), because a close can't be undone or re-entered.
 * A server rejection (duplicate day, authorization) renders right here. */
function ConfirmModal({
  shopName,
  closeDate,
  amountPesewas,
  pending,
  error,
  onClose,
}: {
  shopName: string;
  closeDate: string;
  amountPesewas: number | null;
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
      <div className="modal" role="dialog" aria-modal="true" aria-label="Record day close">
        <div className="m-head">
          <h3 className="h3">Record day close</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="m-body">
          <p style={{ margin: 0 }}>
            Record <strong>{amountPesewas === null ? "—" : format(amountPesewas)}</strong> as
            the counted drawer for <strong>{shopName}</strong> on{" "}
            <strong>{prettyDate(closeDate)}</strong>? A day can only be closed
            once, and the declaration can’t be edited afterwards.
          </p>
          {error && (
            <p className="err" style={{ marginTop: 12 }}>
              <Icon name="alert" /> {error}
            </p>
          )}
        </div>
        <div className="m-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Keep counting
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Recording…" : "Record close"}
          </button>
        </div>
      </div>
    </div>
  );
}
