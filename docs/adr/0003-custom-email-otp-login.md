# Custom two-step email-OTP login instead of Supabase's built-in MFA

Sign-in is password + a one-time code emailed to the Cashier, who enters it to finish logging in. This is a custom two-step flow layered on Supabase's native email OTP (`signInWithOtp` / `verifyOtp`), not Supabase's first-class MFA.

We chose this because Supabase's built-in second factors are authenticator-app (TOTP) and SMS — and the Owner specifically wants an emailed code, which is not a first-class Supabase MFA factor. TOTP was rejected as too much friction for shop staff; SMS was rejected to avoid a paid SMS gateway. The trade-off: this is not formal AAL2 MFA, and it relies on a production SMTP provider (e.g. Resend) because Supabase's built-in email sender is heavily rate-limited.

## Consequences

- Do not "upgrade" this to Supabase MFA without re-checking the Owner's requirement — the email-code flow is deliberate.
- A custom SMTP provider must be configured in Supabase before going live.
- **Remember me for 30 days** (ticked by default): after a code is verified, the browser gets a signed, httpOnly, per-user cookie (`mbradu_td_<userId>`, see `lib/auth/trusted-device.ts`). While it's valid, that user signs in on that browser with the password alone. The 30 days count from when the code was verified, and password-only sign-ins don't extend them. Unticking the box always asks for a code and clears the cookie. The cookie is signed with `TRUSTED_DEVICE_SECRET` if set, otherwise with a key derived from `SUPABASE_SERVICE_ROLE_KEY`.
