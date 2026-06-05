"use client";

import { useActionState, useEffect, useState } from "react";

import { Icon } from "@/components/icon";
import { CEDI_SYMBOL } from "@/lib/money";
import { EXPIRY_WINDOW_OPTIONS, MAX_LOW_STOCK_THRESHOLD } from "@/lib/settings";

import { saveSettings, type SettingsFormState } from "./actions";

const INITIAL: SettingsFormState = { status: "idle" };

/**
 * The business-wide settings screen (design — Settings): the editor plus its
 * success toast. The toast lives here so {@link SettingsForm} can signal success
 * through an `onSaved` callback (mirroring the catalog/stock editors) rather than
 * setting toast state inside its own action effect. These settings apply to every
 * Shop — there are no per-Shop settings (ADR-0005).
 */
export function SettingsView({
  lowStockThreshold,
  expiryWarningDays,
}: {
  lowStockThreshold: number;
  expiryWarningDays: number;
}) {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <SettingsForm
        lowStockThreshold={lowStockThreshold}
        expiryWarningDays={expiryWarningDays}
        onSaved={setToast}
      />

      {toast && (
        <div className="toast success" role="status">
          <span className="ico">
            <Icon name="check" />
          </span>
          <span className="body-med">{toast}</span>
        </div>
      )}
    </>
  );
}

/** The settings form: a stepper for the low-stock threshold, a select for the
 * expiry-warning window, and the fixed GH₵ currency. Submits to
 * {@link saveSettings} via `useActionState`; reports success up via `onSaved`. */
function SettingsForm({
  lowStockThreshold,
  expiryWarningDays,
  onSaved,
}: {
  lowStockThreshold: number;
  expiryWarningDays: number;
  onSaved: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState(saveSettings, INITIAL);
  // The stepper is local client state, serialized to a hidden field on submit.
  const [threshold, setThreshold] = useState(lowStockThreshold);

  useEffect(() => {
    if (state.status === "success") onSaved(state.message);
  }, [state, onSaved]);

  // The window menu, with the current stored value folded in defensively (in
  // case it was ever set outside the canonical choices).
  const windowOptions = Array.from(
    new Set<number>([...EXPIRY_WINDOW_OPTIONS, expiryWarningDays]),
  ).sort((a, b) => a - b);

  const decrease = () => setThreshold((n) => Math.max(0, n - 1));
  const increase = () => setThreshold((n) => Math.min(MAX_LOW_STOCK_THRESHOLD, n + 1));

  return (
    <form action={formAction} className="card set-card">
      <input type="hidden" name="low_stock_threshold" value={threshold} />

      <div className="set-row">
        <div>
          <div className="k">Low-stock threshold</div>
          <div className="d">
            Items at or below this quantity at <strong>any shop</strong> are flagged
            low. One business-wide value — not set per shop.
          </div>
        </div>
        <div className="stepper" style={{ height: 40 }}>
          <button
            type="button"
            onClick={decrease}
            disabled={threshold <= 0}
            aria-label="Decrease low-stock threshold"
          >
            −
          </button>
          <span className="val" aria-live="polite">
            {threshold}
          </span>
          <button
            type="button"
            onClick={increase}
            disabled={threshold >= MAX_LOW_STOCK_THRESHOLD}
            aria-label="Increase low-stock threshold"
          >
            +
          </button>
        </div>
      </div>

      <div className="set-row">
        <div>
          <div className="k">Expiry-warning window</div>
          <div className="d">
            Cosmetics expiring within this many days show “Expiring soon”,
            business-wide.
          </div>
        </div>
        <div>
          <select
            className="input"
            name="expiry_warning_days"
            defaultValue={expiryWarningDays}
            style={{ justifySelf: "start" }}
          >
            {windowOptions.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="set-row">
        <div>
          <div className="k">Currency</div>
          <div className="d">
            Single currency. Prices are final — no separate tax line.
          </div>
        </div>
        <div>
          <span
            className="chip chip-primary"
            style={{ height: 32, padding: "0 14px", fontSize: 14 }}
          >
            {CEDI_SYMBOL} · Ghana Cedi
          </span>
        </div>
      </div>

      {state.status === "error" && (
        <p className="err" style={{ marginTop: 16 }}>
          <Icon name="alert" /> {state.message}
        </p>
      )}

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 20 }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
