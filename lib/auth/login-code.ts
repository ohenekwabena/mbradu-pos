import "server-only";

import { sendEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

function loginCodeEmailHtml(code: string): string {
  return `
  <div style="font-family:Poppins,Arial,sans-serif;color:#212121;max-width:480px;margin:0 auto;">
    <p style="font-size:15px;line-height:22px;">Your one-time sign-in code for Mbradu POS:</p>
    <p style="font-size:30px;font-weight:600;letter-spacing:.12em;color:#c2185b;margin:16px 0;">${code}</p>
    <p style="font-size:12px;color:#616161;line-height:18px;">
      Enter this code to finish signing in. It expires in 60 minutes. If you
      didn't try to sign in, you can ignore this email.
    </p>
    <p style="font-size:12px;color:#9e9e9e;margin-top:24px;">Mbradu POS · Accra, Ghana</p>
  </div>`;
}

/**
 * Generates and emails the two-step login's one-time code. Uses the admin
 * `generateLink` (magiclink) rather than `signInWithOtp` so the app actually
 * receives the code — which lets us log it for local testing — then delivers
 * it via Resend. The code is verified in the login action with
 * `verifyOtp({ type: "email" })`, unchanged.
 */
export async function sendLoginCode(email: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.email_otp) {
    throw error ?? new Error("Could not generate a sign-in code.");
  }
  const code = data.properties.email_otp;

  // Dev convenience: surface the code in the server console so login is testable
  // without working email delivery. Logged before the send (so it's available
  // even if delivery fails) and guarded so codes never hit production logs.
  if (process.env.NODE_ENV !== "production") {
    console.log(`[login-otp] sign-in code for ${email}: ${code}`);
  }

  await sendEmail({
    to: email,
    subject: "Your Mbradu POS sign-in code",
    html: loginCodeEmailHtml(code),
  });
}
