"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icon";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

/** "ama@mbradu.shop" → "a•••••@mbradu.shop" (matches the design's masking). */
function maskEmail(email: string): string {
  return email.replace(/(.).+(@.*)/, "$1•••••$2");
}

/**
 * Six single-character boxes that behave like one field: auto-advance on entry,
 * backspace to the previous box, and paste distributes a copied code across
 * them. The joined value is mirrored into a hidden `code` input so the server
 * action (which reads `formData.get("code")`) is unchanged.
 */
export function OtpBoxes({ disabled }: { disabled: boolean }) {
  const [digits, setDigits] = useState<string[]>(() =>
    Array<string>(OTP_LENGTH).fill(""),
  );
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    boxes.current[0]?.focus();
  }, []);

  return (
    <div className="otp">
      <input type="hidden" name="code" value={digits.join("")} />
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, "").slice(-1);
            setDigits((prev) => prev.map((d, k) => (k === i ? next : d)));
            if (next && i < OTP_LENGTH - 1) boxes.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) {
              boxes.current[i - 1]?.focus();
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData
              .getData("text")
              .replace(/\D/g, "")
              .slice(0, OTP_LENGTH);
            if (!pasted) return;
            e.preventDefault();
            setDigits((prev) => prev.map((d, k) => pasted[k] ?? d));
            boxes.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
          }}
        />
      ))}
    </div>
  );
}

/**
 * The emailed-code step, shared by the two-step login and the invitation
 * sign-up. Rendered only once a code has been sent, so it mounts fresh — its
 * resend cooldown starts from `useState`'s initial value (no effect needed), and
 * a resend just resets it on click. `back` is an optional control above the
 * heading that dispatches the action with `intent=restart` to reset the flow to
 * its first step (login offers "use a different account"; sign-up has none). It
 * fires imperatively from a `type="button"`, not a submit, for two reasons: a
 * plain link to `/login` is a no-op since login is already there (soft nav keeps
 * this client component's action state stuck on the code step), and a submit
 * button placed here would steal Enter from "Verify" as the form's default.
 */
export function OtpCodeStep({
  email,
  error,
  notice,
  pending,
  formAction,
  back,
}: {
  email: string;
  error?: string;
  notice?: string;
  pending: boolean;
  formAction: (formData: FormData) => void;
  back?: { label: string };
}) {
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  return (
    <form action={formAction}>
      {back && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const data = new FormData();
            data.set("intent", "restart");
            formAction(data);
          }}
          className="link"
          style={{ display: "inline-block", marginBottom: 14 }}
        >
          {back.label}
        </button>
      )}
      <h1 className="h3" style={{ marginBottom: 4 }}>
        Enter your code
      </h1>
      <p className="text-muted caption" style={{ marginBottom: 18 }}>
        We emailed a 6-digit code to <strong>{maskEmail(email)}</strong>.
      </p>
      {error && (
        <div className="err-banner">
          <Icon name="alert" /> {error}
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      <div style={{ marginBottom: 20 }}>
        <OtpBoxes disabled={pending} />
      </div>
      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={pending}
        style={{ marginBottom: 14 }}
      >
        {pending ? "Verifying…" : "Verify"}
      </button>
      <div style={{ textAlign: "center" }}>
        <button
          type="submit"
          name="intent"
          value="resend"
          formNoValidate
          disabled={pending || cooldown > 0}
          onClick={() => setCooldown(RESEND_COOLDOWN_SECONDS)}
          className="link"
        >
          Resend code
        </button>{" "}
        {cooldown > 0 && (
          <span className="text-faint caption">({cooldown}s)</span>
        )}
      </div>
    </form>
  );
}
