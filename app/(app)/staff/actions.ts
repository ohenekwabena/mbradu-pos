"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { NotAuthorizedError, assertCan } from "@/lib/auth/visibility";
import { lookupAccount, sendPasswordRecoveryEmail } from "@/lib/auth/reset";
import { getCurrentProfile } from "@/lib/dal";
import { INVITE_TTL_DAYS, parseInviteInput } from "@/lib/invitations";
import { invitationSignupLink, sendInvitationEmail } from "@/lib/invite-email";
import { createClient } from "@/lib/supabase/server";

export type ResetCashierResult = { ok: true } | { ok: false; error: string };

/**
 * Owner-triggered password reset for a Cashier. Cashiers can't self-reset, so
 * this is how they get back in: the Owner sends them a fresh recovery link.
 * Owner-only (defence-in-depth on top of the page guard), and it refuses to act
 * on a non-cashier account.
 */
export async function resetCashierPassword(
  email: string,
): Promise<ResetCashierResult> {
  const profile = await getCurrentProfile();

  try {
    assertCan(profile, "staff:reset");
  } catch (error) {
    if (error instanceof NotAuthorizedError) {
      return { ok: false, error: "Only the Owner can reset a cashier's password." };
    }
    throw error;
  }

  const account = await lookupAccount(email.trim().toLowerCase());
  if (!account) {
    return { ok: false, error: "No account found for that email." };
  }
  if (account.role !== "cashier") {
    return {
      ok: false,
      error: "Only cashier passwords are reset here.",
    };
  }

  try {
    await sendPasswordRecoveryEmail(account.email, account.fullName);
  } catch {
    return {
      ok: false,
      error: "Couldn't send the reset email just now. Please try again.",
    };
  }

  return { ok: true };
}

const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

export type InviteFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

/**
 * Issue an Invitation: authorize `email` to sign up as a Cashier into the chosen
 * Shop. Owner-only — gated here (early rejection) and again by the DB's "Owner
 * manages invitations" RLS on the insert, which is the server-side proof of "only
 * the Owner can issue Invitations". Writes a `pending` row carrying the target
 * `shop_id`, a single-use `token`, and an expiry, then best-effort emails the
 * token-gated sign-up link. The invitation exists whether or not the email goes
 * out (the Owner can Resend), so a delivery failure is reported as a soft
 * success, not a hard error. Bound to the invite form via `useActionState`.
 */
export async function sendInvitation(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const profile = await getCurrentProfile();
  try {
    assertCan(profile, "staff:invite");
  } catch (error) {
    if (error instanceof NotAuthorizedError) {
      return { status: "error", message: "Only the Owner can invite cashiers." };
    }
    throw error;
  }

  const parsed = parseInviteInput({
    email: String(formData.get("email") ?? ""),
    shopId: String(formData.get("shopId") ?? ""),
  });
  if (!parsed.ok) return { status: "error", message: parsed.error };
  const { email, shopId } = parsed.value;

  // Don't invite someone who already has an account — they'd have nothing to
  // accept, and a duplicate would only confuse the roster.
  const existing = await lookupAccount(email);
  if (existing) {
    return { status: "error", message: `${email} already has an account.` };
  }

  const supabase = await createClient();

  // One open invitation per email at a time, so the pending list stays honest
  // and Resend (not a second row) is how the Owner nudges.
  const { data: alreadyPending } = await supabase
    .from("invitations")
    .select("id")
    .eq("email", email)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (alreadyPending) {
    return {
      status: "error",
      message: `There's already a pending invitation for ${email}.`,
    };
  }

  const { data: shop } = await supabase
    .from("shops")
    .select("name")
    .eq("id", shopId)
    .single();
  if (!shop) {
    return { status: "error", message: "That shop no longer exists." };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const { error } = await supabase.from("invitations").insert({
    email,
    shop_id: shopId,
    invited_by: profile.id,
    token,
    expires_at: expiresAt,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath("/staff");

  try {
    await sendInvitationEmail({
      to: email,
      shopName: shop.name,
      inviterName: profile.fullName,
      link: invitationSignupLink(token),
    });
  } catch {
    return {
      status: "success",
      message: `Invitation created for ${email}, but the email couldn't be sent — use Resend once email is set up.`,
    };
  }

  return {
    status: "success",
    message: `Invitation sent to ${email} for ${shop.name}.`,
  };
}

export type InviteActionResult = { ok: true } | { ok: false; error: string };

/**
 * Cancel a still-pending Invitation (flip it to `cancelled`), so its token can no
 * longer be accepted and it drops off the pending list. Owner-only via the same
 * "Owner manages invitations" RLS. The `status = 'pending'` guard makes this a
 * no-op on an already-accepted or already-cancelled row.
 */
export async function cancelInvitation(
  id: string,
): Promise<InviteActionResult> {
  const profile = await getCurrentProfile();
  try {
    assertCan(profile, "staff:invite");
  } catch (error) {
    if (error instanceof NotAuthorizedError) {
      return { ok: false, error: "Only the Owner can manage invitations." };
    }
    throw error;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("invitations")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };

  revalidatePath("/staff");
  return { ok: true };
}

/**
 * Re-send a pending Invitation's sign-up email, refreshing its expiry so the
 * Cashier gets a fresh window. Reuses the existing token (the link is stable),
 * so an already-sent link keeps working. Owner-only; a no-op error if the
 * invitation isn't pending anymore.
 */
export async function resendInvitation(
  id: string,
): Promise<InviteActionResult> {
  const profile = await getCurrentProfile();
  try {
    assertCan(profile, "staff:invite");
  } catch (error) {
    if (error instanceof NotAuthorizedError) {
      return { ok: false, error: "Only the Owner can manage invitations." };
    }
    throw error;
  }

  const supabase = await createClient();
  const { data: invite } = await supabase
    .from("invitations")
    .select("email, token, status, shop_id")
    .eq("id", id)
    .single();
  if (!invite || invite.status !== "pending") {
    return { ok: false, error: "That invitation is no longer pending." };
  }

  const { data: shop } = await supabase
    .from("shops")
    .select("name")
    .eq("id", invite.shop_id)
    .single();

  await supabase
    .from("invitations")
    .update({ expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString() })
    .eq("id", id)
    .eq("status", "pending");

  try {
    await sendInvitationEmail({
      to: invite.email,
      shopName: shop?.name ?? "your shop",
      inviterName: profile.fullName,
      link: invitationSignupLink(invite.token),
    });
  } catch {
    return {
      ok: false,
      error: "Couldn't send the email just now. Please try again.",
    };
  }

  return { ok: true };
}
