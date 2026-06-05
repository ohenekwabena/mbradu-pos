"use client";

import { useActionState } from "react";

import { Icon } from "@/components/icon";
import { OtpCodeStep } from "@/components/otp-step";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { initialSignupState } from "@/lib/auth/signup-flow";

import { completeSignup } from "./actions";

/**
 * The invitation sign-up card. Step 1 is "set your password" — the invited email
 * and Shop are shown read-only (resolved + re-checked on the server; never
 * trusted from here), and the Cashier only chooses a password. On success the
 * same emailed-code step the login uses (OtpCodeStep) takes over, so finishing
 * sign-up flows straight into the two-step verification (ADR-0003, MP-28).
 */
export function InvitationForm({
  token,
  email,
  shopName,
}: {
  token: string;
  email: string;
  shopName: string;
}) {
  const [state, formAction, pending] = useActionState(
    completeSignup,
    initialSignupState,
  );

  if (state.step === "code") {
    return (
      <OtpCodeStep
        email={state.email}
        error={state.error}
        notice={state.notice}
        pending={pending}
        formAction={formAction}
      />
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <h1 className="h3" style={{ marginBottom: 4 }}>
        Set your password
      </h1>
      <p className="text-muted caption" style={{ marginBottom: 20 }}>
        Choose a password to finish setting up your account and start ringing up
        sales.
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
      <div className="field" style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>Your shop</span>
        <div
          className="ro-field"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--ink)",
          }}
        >
          <span style={{ color: "var(--primary)", display: "inline-flex" }}>
            <Icon name="store" />
          </span>
          {shopName}
        </div>
      </div>
      <div className="field" style={{ marginBottom: 6 }}>
        <label htmlFor="password">Create password</label>
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
        <label htmlFor="confirm">Confirm password</label>
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
        {pending ? "Creating account…" : "Create account"}
      </button>
      <p
        className="caption text-faint"
        style={{ textAlign: "center", margin: "14px 0 0" }}
      >
        Next, we&apos;ll email you a one-time code to verify it&apos;s you.
      </p>
    </form>
  );
}
