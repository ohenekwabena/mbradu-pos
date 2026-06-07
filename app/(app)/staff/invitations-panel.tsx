"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { Icon } from "@/components/icon";
import { Select } from "@/components/select";

import {
  cancelInvitation,
  resendInvitation,
  sendInvitation,
  type InviteFormState,
} from "./actions";

export interface ShopOption {
  id: string;
  name: string;
}

export interface PendingInviteVM {
  id: string;
  email: string;
  shopName: string | null;
  /** Pre-formatted on the server, e.g. "2 days ago" — shown as "Invited …". */
  agoLabel: string;
}

const INITIAL: InviteFormState = { status: "idle" };

/**
 * The Staff page's right column (design §Staff): the "Invite a cashier" form and
 * the "Pending" invitations list, sharing one success/error toast. Issuing,
 * resending, and cancelling are all Owner-only Server Actions; this component is
 * just their UI. The roster on the left is a Server Component — only this
 * invitation surface needs interactivity.
 */
export function InvitationsPanel({
  shops,
  pending,
}: {
  shops: ShopOption[];
  pending: PendingInviteVM[];
}) {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <div className="stack gap-16">
      <InviteCard shops={shops} onSent={setToast} />
      <PendingCard pending={pending} onToast={setToast} />
      {toast && (
        <div className="toast success" role="status">
          <span className="ico">
            <Icon name="check" />
          </span>
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

function InviteCard({
  shops,
  onSent,
}: {
  shops: ShopOption[];
  onSent: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState(sendInvitation, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const noShops = shops.length === 0;
  // The shop picker is the shared Select (custom, not a native <select>), so its
  // value rides a hidden field rather than the form's own controls.
  const [shopId, setShopId] = useState(shops[0]?.id ?? "");

  // A successful invite clears the form. Native fields reset via the form's own
  // reset() in the effect below; the controlled shop dropdown is reset here
  // during render — React's sanctioned alternative to setState-in-an-effect —
  // each time a fresh result lands.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "success") setShopId(shops[0]?.id ?? "");
  }

  useEffect(() => {
    if (state.status === "success") {
      onSent(state.message);
      formRef.current?.reset();
    }
  }, [state, onSent]);

  return (
    <div className="card">
      <h2 className="h2" style={{ marginBottom: 6 }}>
        Invite a cashier
      </h2>
      <p className="text-muted caption" style={{ marginBottom: 14 }}>
        They&apos;ll get an email to set a password and sign in with a one-time
        code. A cashier is bound to one shop.
      </p>

      <form ref={formRef} action={formAction}>
        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="invEmail">Email address</label>
          <input
            id="invEmail"
            className="input"
            name="email"
            type="email"
            placeholder="name@example.com"
            autoComplete="off"
            required
            disabled={noShops}
          />
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="invShop">Shop</label>
          <Select
            id="invShop"
            name="shopId"
            value={shopId}
            onChange={setShopId}
            options={shops.map((shop) => ({
              value: shop.id,
              label: shop.name,
              icon: "store" as const,
            }))}
            triggerIcon="store"
            disabled={noShops}
            block
          />
        </div>

        {state.status === "error" && (
          <p className="err" style={{ marginBottom: 12 }}>
            <Icon name="alert" /> {state.message}
          </p>
        )}

        {noShops ? (
          <p className="caption text-faint" style={{ margin: 0 }}>
            Open a shop first — a cashier is invited into a specific shop.
          </p>
        ) : (
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={pending}
          >
            <Icon name="mail" /> {pending ? "Sending…" : "Send invitation"}
          </button>
        )}
      </form>
    </div>
  );
}

function PendingCard({
  pending,
  onToast,
}: {
  pending: PendingInviteVM[];
  onToast: (message: string) => void;
}) {
  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <h2 className="h2">Pending</h2>
        <span className="caption text-faint">
          {pending.length} invited
        </span>
      </div>

      {pending.length === 0 ? (
        <p className="text-muted caption" style={{ margin: "6px 0 0" }}>
          No pending invitations. Invited cashiers appear here until they accept.
        </p>
      ) : (
        <div>
          {pending.map((invite) => (
            <PendingRow key={invite.id} invite={invite} onToast={onToast} />
          ))}
        </div>
      )}
    </div>
  );
}

function PendingRow({
  invite,
  onToast,
}: {
  invite: PendingInviteVM;
  onToast: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resend() {
    setError(null);
    startTransition(async () => {
      const result = await resendInvitation(invite.id);
      if (result.ok) onToast(`Invitation resent to ${invite.email}`);
      else setError(result.error);
    });
  }

  function cancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelInvitation(invite.id);
      if (result.ok) onToast(`Invitation to ${invite.email} cancelled`);
      else setError(result.error);
    });
  }

  return (
    <div className="invite-row">
      <div>
        <div className="e">{invite.email}</div>
        <div className="t">
          Invited {invite.agoLabel}
          {invite.shopName ? ` · ${invite.shopName}` : ""} ·{" "}
          <span
            className="chip chip-warning"
            style={{ height: 18, padding: "0 7px" }}
          >
            Pending
          </span>
        </div>
        {error && (
          <div className="t" style={{ color: "var(--danger)" }}>
            {error}
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 2 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={resend}
          disabled={pending}
        >
          Resend
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ color: "var(--danger)" }}
          onClick={cancel}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
