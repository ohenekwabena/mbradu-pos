"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Icon } from "@/components/icon";
import { OtpCodeStep } from "@/components/otp-step";
import { initialLoginState } from "@/lib/auth/login-flow";
import { authenticate } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    authenticate,
    initialLoginState,
  );

  const error = state.step !== "authenticated" ? state.error : undefined;

  if (state.step === "code") {
    return (
      <OtpCodeStep
        email={state.email}
        error={error}
        notice={state.notice}
        pending={pending}
        formAction={formAction}
        back={{ href: "/login", label: "← Use a different account" }}
      />
    );
  }

  return (
    <form action={formAction}>
      <h1 className="h3" style={{ marginBottom: 4 }}>
        Sign in
      </h1>
      <p className="text-muted caption" style={{ marginBottom: 20 }}>
        Enter your email and password to continue.
      </p>
      {error && (
        <div className="err-banner">
          <Icon name="alert" /> {error}
        </div>
      )}
      <div className="field" style={{ marginBottom: 14 }}>
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
      <div className="field" style={{ marginBottom: 8 }}>
        <label htmlFor="password">Password</label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </div>
      <div style={{ textAlign: "right", marginBottom: 20 }}>
        <Link className="link" href="/forgot-password">
          Forgot password?
        </Link>
      </div>
      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={pending}
      >
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
