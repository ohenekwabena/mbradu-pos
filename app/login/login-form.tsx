"use client";

import { useActionState } from "react";

import { initialLoginState } from "@/lib/auth/login-flow";
import { authenticate } from "./actions";

const fieldClass =
  "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:bg-transparent";
const primaryButtonClass =
  "w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    authenticate,
    initialLoginState,
  );
  const onCodeStep = state.step === "code";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {onCodeStep ? (
        <div className="flex flex-col gap-4">
          {state.notice && (
            <p className="text-sm text-black/70 dark:text-white/70">
              {state.notice}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="code" className="text-sm font-medium">
              One-time code
            </label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              required
              className={fieldClass}
            />
          </div>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? "Verifying…" : "Verify code"}
          </button>
          <button
            type="submit"
            name="intent"
            value="resend"
            formNoValidate
            disabled={pending}
            className="text-sm text-black/60 underline-offset-4 hover:underline disabled:opacity-50 dark:text-white/60"
          >
            Request a fresh code
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className={fieldClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={fieldClass}
            />
          </div>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? "Checking…" : "Continue"}
          </button>
        </div>
      )}

      {state.step !== "authenticated" && state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
