import "server-only";

import { sendEmail } from "@/lib/email";

/**
 * Building and sending the Cashier **invitation** email — the message that
 * carries the token-gated sign-up link to a freshly-invited Cashier. Kept beside
 * (not inside) the Staff Server Action so the link shape and copy live in one
 * place, mirroring how `lib/auth/reset.ts` owns the recovery email.
 *
 * The link points at the token-gated sign-up page the Cashier completes in
 * MP-28; until that route ships the link is only meaningful in development,
 * where it's also logged to the server console (below) so the flow is testable
 * without working email delivery.
 */

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The public sign-up URL for an invitation token: `/invitation?token=…`. The
 * Cashier opens it to set a password and is bound to the invitation's Shop
 * (MP-28). Read by the SECURITY DEFINER `invitation_for_token` RPC, never by
 * exposing the table.
 */
export function invitationSignupLink(token: string): string {
  const url = new URL(`${siteUrl()}/invitation`);
  url.searchParams.set("token", token);
  return url.toString();
}

function invitationEmailHtml(
  link: string,
  shopName: string,
  inviterName: string | null,
): string {
  const inviter = inviterName ? escapeHtml(inviterName) : "The Owner";
  return `
  <div style="font-family:Poppins,Arial,sans-serif;color:#212121;max-width:480px;margin:0 auto;">
    <p style="font-size:15px;">Hi,</p>
    <p style="font-size:15px;line-height:22px;">
      ${inviter} invited you to ring up sales at <strong>${escapeHtml(shopName)}</strong>
      on Mbradu POS. Click below to choose a password and finish setting up your
      account. This invitation expires in two weeks and can be used once.
    </p>
    <p style="margin:24px 0;">
      <a href="${link}" style="background:#673AB7;color:#ffffff;text-decoration:none;
        padding:12px 22px;border-radius:12px;font-weight:600;display:inline-block;">
        Accept invitation
      </a>
    </p>
    <p style="font-size:12px;color:#616161;line-height:18px;">
      After setting your password, we'll email you a one-time code to verify it's
      you. If you weren't expecting this, you can ignore this email.
    </p>
    <p style="font-size:12px;color:#9e9e9e;margin-top:24px;">Mbradu POS · Accra, Ghana</p>
  </div>`;
}

/**
 * Email an invited Cashier their token-gated sign-up link. The caller has
 * already created the `invitations` row; this is the best-effort delivery on top
 * of it. Throws on a send failure (no `RESEND_API_KEY`, a non-2xx from Resend)
 * so the Server Action can tell the Owner the invitation was saved but the email
 * didn't go out — they can Resend once email is configured. In development the
 * link is logged to the server console first, so the flow is testable even
 * without delivery; the guard keeps real tokens out of production logs.
 */
export async function sendInvitationEmail(params: {
  to: string;
  shopName: string;
  inviterName: string | null;
  link: string;
}): Promise<void> {
  const { to, shopName, inviterName, link } = params;

  if (process.env.NODE_ENV !== "production") {
    console.log(
      [
        `[invitation] sign-up email → ${to} (${shopName})`,
        `[invitation]   link: ${link}`,
      ].join("\n"),
    );
  }

  await sendEmail({
    to,
    subject: "You're invited to Mbradu POS",
    html: invitationEmailHtml(link, shopName, inviterName),
  });
}
