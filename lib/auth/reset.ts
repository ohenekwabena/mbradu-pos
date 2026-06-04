import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";

export type AccountRole = "owner" | "cashier";

export interface Account {
  id: string;
  email: string;
  role: AccountRole;
  fullName: string | null;
}

type AdminClient = ReturnType<typeof createAdminClient>;

const PER_PAGE = 200;
const MAX_PAGES = 25;

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

/** Paginates the auth users (admin) to find one by exact, case-insensitive email. */
async function findAuthUserByEmail(admin: AdminClient, email: string) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match;
    if (data.users.length < PER_PAGE) break; // reached the last page
  }
  return null;
}

/**
 * Resolves an email to its POS account (id + role), or `null` if no such user.
 * Drives the "cashiers can't self-reset" decision on the forgot-password page.
 */
export async function lookupAccount(email: string): Promise<Account | null> {
  const admin = createAdminClient();
  const user = await findAuthUserByEmail(admin, email);
  if (!user) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  return {
    id: user.id,
    email: user.email ?? email,
    role: (profile?.role as AccountRole) ?? "cashier",
    fullName: profile?.full_name ?? null,
  };
}

function recoveryEmailHtml(link: string, name: string | null): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  return `
  <div style="font-family:Poppins,Arial,sans-serif;color:#212121;max-width:480px;margin:0 auto;">
    <p style="font-size:15px;">${greeting}</p>
    <p style="font-size:15px;line-height:22px;">
      A password reset was requested for your Mbradu POS account. Click below to
      choose a new password. This link expires in 60 minutes and can be used once.
    </p>
    <p style="margin:24px 0;">
      <a href="${link}" style="background:#c2185b;color:#ffffff;text-decoration:none;
        padding:12px 22px;border-radius:12px;font-weight:600;display:inline-block;">
        Set a new password
      </a>
    </p>
    <p style="font-size:12px;color:#616161;line-height:18px;">
      If you didn't request this, you can ignore this email — your password won't
      change. After setting a new password you'll sign in with a one-time code as usual.
    </p>
    <p style="font-size:12px;color:#9e9e9e;margin-top:24px;">Mbradu POS · Accra, Ghana</p>
  </div>`;
}

/**
 * Generates a one-time recovery link (admin) and emails it to `email`. Uses the
 * `token_hash` flow rather than PKCE so the link works in a different browser
 * from the one that triggered it — essential for the Owner-triggered reset,
 * where the Owner starts it but the Cashier clicks the link.
 */
export async function sendPasswordRecoveryEmail(
  email: string,
  name: string | null = null,
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    throw error ?? new Error("Could not generate a recovery link.");
  }

  const callback = new URL(`${siteUrl()}/auth/callback`);
  callback.searchParams.set("token_hash", data.properties.hashed_token);
  callback.searchParams.set("type", "recovery");
  callback.searchParams.set("next", "/reset-password");
  const link = callback.toString();

  // Dev convenience: surface the recovery link/token in the server console so
  // the reset flow is testable without working email delivery. Logged before
  // the send so it's available even if delivery fails, and guarded so real
  // reset tokens never land in production logs.
  if (process.env.NODE_ENV !== "production") {
    console.log(
      [
        `[password-reset] recovery email → ${email}`,
        `[password-reset]   link:  ${link}`,
        `[password-reset]   token: ${data.properties.hashed_token}`,
      ].join("\n"),
    );
  }

  await sendEmail({
    to: email,
    subject: "Reset your Mbradu POS password",
    html: recoveryEmailHtml(link, name),
  });
}

/**
 * Best-effort heads-up to the Owner that a Cashier tried to self-reset (which
 * isn't allowed). Never throws — a failed notification must not change what the
 * Cashier sees. The Owner completes the reset from the Staff page.
 */
export async function notifyOwnerOfCashierResetRequest(
  cashierEmail: string,
): Promise<void> {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) return;
  try {
    await sendEmail({
      to: ownerEmail,
      subject: "A cashier asked to reset their password",
      html: `
      <div style="font-family:Poppins,Arial,sans-serif;color:#212121;max-width:480px;margin:0 auto;">
        <p style="font-size:15px;line-height:22px;">
          <strong>${escapeHtml(cashierEmail)}</strong> tried to reset their Mbradu POS
          password. Cashiers can't reset their own password — open the
          <strong>Staff</strong> page and use <strong>Reset password</strong> to send them a fresh link.
        </p>
        <p style="font-size:12px;color:#9e9e9e;margin-top:24px;">Mbradu POS · Accra, Ghana</p>
      </div>`,
    });
  } catch {
    // Swallow — the Cashier's outcome must not depend on this.
  }
}
