import "server-only";

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

/**
 * Sends a transactional email via Resend's REST API (no SDK dependency).
 *
 * The sending domain matters: the default `onboarding@resend.dev` only delivers
 * to the Resend account's own address, so to reach real cashiers a verified
 * domain must be set in `EMAIL_FROM`. Throws on a non-2xx response so callers
 * can surface a failure rather than silently "succeeding".
 */
export async function sendEmail({
  to,
  subject,
  html,
}: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  const from = process.env.EMAIL_FROM ?? "Mbradu POS <onboarding@resend.dev>";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Email send failed (${response.status}): ${detail}`);
  }
}
