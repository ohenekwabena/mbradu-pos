import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for password-recovery links. Links built via the admin
 * `generateLink` carry a `token_hash`; verifying it here establishes the
 * recovery session (sets the auth cookies) and forwards to the reset page.
 *
 * This uses the `token_hash` flow rather than PKCE on purpose: it works even
 * when the link is opened in a different browser from the one that requested
 * it, which is exactly the Owner-triggered-reset case.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Only allow same-origin relative redirects (no open redirect).
  const nextParam = searchParams.get("next") ?? "/reset-password";
  const next =
    nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/reset-password";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Missing / invalid / expired token — let the reset page show its error state.
  return NextResponse.redirect(new URL("/reset-password?error=link", origin));
}
