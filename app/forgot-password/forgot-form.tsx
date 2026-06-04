"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Icon } from "@/components/icon";
import { initialForgotState } from "@/lib/auth/forgot-flow";
import { requestPasswordReset } from "./actions";

function maskEmail(email: string): string {
  return email.replace(/(.).+(@.*)/, "$1•••••$2");
}

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    initialForgotState,
  );

  if (state.step === "sent") {
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
          <Icon name="mail" />
        </div>
        <h1 className="h3">Check your email</h1>
        <p className="text-muted caption" style={{ margin: "8px 0 20px" }}>
          We sent a password-reset link to{" "}
          <strong>{maskEmail(state.email)}</strong>. It expires in 60 minutes.
          After you set a new password, you&apos;ll sign in with a one-time code
          as usual.
        </p>
        <Link className="btn btn-secondary btn-block" href="/login">
          Back to sign in
        </Link>
      </div>
    );
  }

  if (state.step === "blocked") {
    return (
      <div style={{ textAlign: "center", padding: "8px 0" }}>
        <div
          className="empty-ico"
          style={{
            margin: "0 auto 14px",
            background: "var(--primary-tint)",
            color: "var(--primary)",
          }}
        >
          <Icon name="staff" />
        </div>
        <h1 className="h3">Your Owner resets this</h1>
        <p className="text-muted caption" style={{ margin: "8px 0 20px" }}>
          Cashier passwords are managed by the shop Owner. We&apos;ve let the
          Owner know — they&apos;ll trigger a reset and you&apos;ll get an email
          with a link to set a new password.
        </p>
        <Link className="btn btn-secondary btn-block" href="/login">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <Link
        className="link"
        href="/login"
        style={{ display: "inline-block", marginBottom: 14 }}
      >
        ← Back to sign in
      </Link>
      <h1 className="h3" style={{ marginBottom: 4 }}>
        Reset your password
      </h1>
      <p className="text-muted caption" style={{ marginBottom: 18 }}>
        Enter your account email and we&apos;ll send a link to set a new
        password.
      </p>
      <div className="notice">
        <Icon name="lock" />
        <span>
          <strong>Cashiers can&apos;t reset their own password.</strong> If
          you&apos;re a cashier, ask the shop Owner to reset it for you from the
          Staff page.
        </span>
      </div>
      {state.error && (
        <div className="err-banner">
          <Icon name="alert" /> {state.error}
        </div>
      )}
      <div className="field" style={{ marginBottom: 20 }}>
        <label htmlFor="email">Email</label>
        <input
          className="input"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="name@mbradu.shop"
          required
        />
      </div>
      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={pending}
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
