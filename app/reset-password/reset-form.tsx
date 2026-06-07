"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { Icon } from "@/components/icon";
import { initialResetState, MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { setNewPassword } from "./actions";

// How long the "Password updated" confirmation lingers before we send the user to
// sign in — long enough to register the success, short enough to feel automatic.
const REDIRECT_DELAY_MS = 1500;

export function ResetPasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    setNewPassword,
    initialResetState,
  );

  // The action signs the recovery session out on success, so once we're "done"
  // route to the normal login. replace() keeps the now-consumed reset page out of
  // history — a Back press would otherwise land on an expired link.
  const done = state.step === "done";
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => router.replace("/login"), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [done, router]);

  if (done) {
    return (
      <div style={{ textAlign: "center", padding: "8px 0" }}>
        <div
          className="empty-ico"
          style={{
            margin: "0 auto 14px",
            background: "var(--success-tint)",
            color: "var(--success)",
          }}
        >
          <Icon name="check" />
        </div>
        <h1 className="h3">Password updated</h1>
        <p className="text-muted caption" style={{ margin: "6px 0 18px" }}>
          Taking you to sign in…
        </p>
        <Link className="btn btn-primary btn-block" href="/login">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <h1 className="h3" style={{ marginBottom: 4 }}>
        Choose a new password
      </h1>
      <p className="text-muted caption" style={{ marginBottom: 20 }}>
        Your Owner triggered a reset for this account. Set a new password to
        regain access.
      </p>
      {state.error && (
        <div className="err-banner">
          <Icon name="alert" /> {state.error}
        </div>
      )}
      <div className="field" style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>Your email</span>
        <div className="ro-field">{email}</div>
      </div>
      <div className="field" style={{ marginBottom: 6 }}>
        <label htmlFor="password">New password</label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
      <div className="req">
        <Icon name="check" /> Use at least {MIN_PASSWORD_LENGTH} characters
      </div>
      <div className="field" style={{ margin: "14px 0 20px" }}>
        <label htmlFor="confirm">Confirm new password</label>
        <input
          className="input"
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={pending}
      >
        {pending ? "Saving…" : "Set new password"}
      </button>
      <p
        className="caption text-faint"
        style={{ textAlign: "center", margin: "14px 0 0" }}
      >
        After this, sign in with your password and a one-time code as usual.
      </p>
    </form>
  );
}
