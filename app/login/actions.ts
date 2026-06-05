"use server";

import { createClient as createBaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { sendLoginCode } from "@/lib/auth/login-code";
import { loginReducer, type LoginState } from "@/lib/auth/login-flow";
import { isProfileDeactivated } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/**
 * A Supabase client that never writes a session. Used to check the password
 * and to email codes, so that completing the password step alone does NOT
 * authenticate the user — the emailed code stays a genuine second factor
 * (ADR-0003). The real session is only set by `verifyOtp` in step 2.
 */
function ephemeralClient() {
  return createBaseClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Validate email + password against Supabase Auth *without* persisting a session
 * (the emailed code stays the real second factor). Returns the matched user's id
 * so the caller can run post-password checks — chiefly: is this account
 * deactivated? — or null when the credentials are wrong.
 */
async function validateCredentials(
  email: string,
  password: string,
): Promise<{ userId: string } | null> {
  const { data, error } = await ephemeralClient().auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) return null;
  return { userId: data.user.id };
}

async function emailOneTimeCode(email: string): Promise<void> {
  // The account already exists here — its password was just validated — which is
  // what generateLink (inside sendLoginCode) requires. A delivery failure must
  // not block the flow: the code is logged server-side and the user can resend.
  try {
    await sendLoginCode(email);
  } catch (error) {
    console.error("[login-otp] could not send sign-in code:", error);
  }
}

/**
 * Drives the two-step login. Bound to the login form via `useActionState`,
 * so it receives the previous `LoginState` and returns the next one. The
 * step transitions and user-facing copy come from the unit-tested reducer.
 */
export async function authenticate(
  prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  // Step 2 — the user is entering (or re-requesting) the emailed code.
  if (prevState.step === "code") {
    if (formData.get("intent") === "resend") {
      await emailOneTimeCode(prevState.email);
      return loginReducer(prevState, { type: "code_resent" });
    }

    const code = String(formData.get("code") ?? "").trim();
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      email: prevState.email,
      token: code,
      type: "email",
    });

    if (error) {
      return loginReducer(prevState, { type: "code_rejected" });
    }

    // Session established — land on the authenticated shell.
    redirect("/dashboard");
  }

  // Step 1 — email + password.
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  const credentials = await validateCredentials(email, password);
  if (!credentials) {
    return loginReducer(prevState, { type: "password_rejected" });
  }

  // A deactivated Cashier's password may still be correct, but they must not get
  // back in. Stop them at the front door with a clear message rather than
  // emailing a code and then bouncing them off every screen afterwards.
  if (await isProfileDeactivated(credentials.userId)) {
    return loginReducer(prevState, { type: "account_deactivated" });
  }

  await emailOneTimeCode(email);
  return loginReducer(prevState, { type: "password_accepted", email });
}
