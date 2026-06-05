"use server";

import { redirect } from "next/navigation";

import { sendLoginCode } from "@/lib/auth/login-code";
import { validateNewPassword } from "@/lib/auth/password";
import { signupReducer, type SignupState } from "@/lib/auth/signup-flow";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

interface TokenInvitation {
  email: string;
  shopId: string;
}

/**
 * The authoritative server-side token check: the pending, unexpired invitation
 * for this exact token, or null. Re-read on every submit via the public
 * `invitation_for_token` RPC — the email and Shop come from here, never from the
 * client (the hidden form fields could be tampered with, and the page's check can
 * go stale between load and submit).
 */
async function invitationForToken(
  token: string,
): Promise<TokenInvitation | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invitation_for_token", {
    p_token: token,
  });
  const rows = (data ?? []) as Array<{ email: string; shop_id: string }>;
  if (error || rows.length === 0) return null;
  return { email: rows[0].email, shopId: rows[0].shop_id };
}

/**
 * Email the one-time sign-in code, best-effort. A delivery failure must not block
 * the flow — the code is logged server-side (dev) and the user can resend — so we
 * swallow it here exactly as the login action does.
 */
async function emailOneTimeCode(email: string): Promise<void> {
  try {
    await sendLoginCode(email);
  } catch (error) {
    console.error("[invitation] could not send sign-in code:", error);
  }
}

/**
 * Drives invitation sign-up, bound to the form via `useActionState`. Step 1
 * creates the Cashier from a valid token; step 2 is the emailed-code
 * verification shared with the two-step login (ADR-0003). Step transitions and
 * copy come from the unit-tested `signupReducer`.
 */
export async function completeSignup(
  prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  // Step 2 — entering or re-requesting the emailed code (mirrors login step 2).
  if (prevState.step === "code") {
    if (formData.get("intent") === "resend") {
      await emailOneTimeCode(prevState.email);
      return signupReducer(prevState, { type: "code_resent" });
    }

    const code = String(formData.get("code") ?? "").trim();
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      email: prevState.email,
      token: code,
      type: "email",
    });
    if (error) {
      return signupReducer(prevState, { type: "code_rejected" });
    }

    // Session established — land on the authenticated shell.
    redirect("/dashboard");
  }

  // Step 1 — token-gated account creation.
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const passwordError = validateNewPassword(password, confirm);
  if (passwordError) {
    return signupReducer(prevState, {
      type: "signup_rejected",
      message: passwordError,
    });
  }

  // Re-validate the token and resolve the invited email + Shop server-side.
  const invite = await invitationForToken(token);
  if (!invite) {
    return signupReducer(prevState, {
      type: "signup_rejected",
      message:
        "This invitation can no longer be used. Ask the Owner for a fresh one.",
    });
  }

  const admin = createAdminClient();

  // Create the Cashier already email-confirmed (the invitation proved the
  // address) and bound to the invitation's Shop: the role + shop_id ride in user
  // metadata that the handle_new_user trigger writes onto their profile, so they
  // land scoped to exactly one Shop. role is fixed here, never taken from the
  // client, so sign-up can't mint an Owner.
  const { error: createError } = await admin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { role: "cashier", shop_id: invite.shopId },
  });
  if (createError) {
    const message = /already|registered|exists/i.test(createError.message)
      ? "An account for this email already exists. Try signing in instead."
      : "Could not create your account. Please try again.";
    return signupReducer(prevState, { type: "signup_rejected", message });
  }

  // Consume the single-use token so the link can't be replayed. The sign-up is
  // anonymous, so this write goes through the service-role client (RLS limits
  // invitation writes to the Owner); the status guard makes it a safe no-op if
  // the row was concurrently accepted or cancelled.
  await admin
    .from("invitations")
    .update({ status: "accepted" })
    .eq("token", token)
    .eq("status", "pending");

  // Email the first one-time code and hand off to the shared code step — the
  // same emailed second factor the Cashier will use to sign in from now on.
  await emailOneTimeCode(invite.email);
  return signupReducer(prevState, {
    type: "account_created",
    email: invite.email,
  });
}
