/**
 * Invitation sign-up state machine — the pure transitions a Cashier moves
 * through when completing a token-gated invitation (MP-28). Mirrors
 * `login-flow.ts`: the form starts at "set a password", and on success advances
 * to the same emailed one-time-code step the two-step login uses (ADR-0003), so
 * finishing sign-up and signing in share one second factor.
 *
 * Kept free of any server/React imports so the client form imports the type +
 * initial state, the Server Action drives it, and the unit tests exercise the
 * copy — all from one source. The Action supplies rejection messages (a
 * too-short password, a stale token, a taken email), so they ride on the event
 * rather than being baked in here; the code-step copy lives in the reducer, as
 * in the login flow.
 */
export type SignupState =
  | { step: "form"; error?: string }
  | { step: "code"; email: string; error?: string; notice?: string };

export type SignupEvent =
  | { type: "account_created"; email: string }
  | { type: "signup_rejected"; message: string }
  | { type: "code_rejected" }
  | { type: "code_resent" };

export const initialSignupState: SignupState = { step: "form" };

/**
 * The invited Cashier's name, validated. Both the first and last name are
 * compulsory when accepting an invitation, so the profile is never born nameless
 * (it would otherwise show as "—" on the Owner's Staff roster). Returns the
 * trimmed, single-string `fullName` to store on the profile, or a user-facing
 * `error` when either part is blank. Pure + unit-tested like `validateNewPassword`,
 * so the Server Action stays a thin caller and the rule is exercised in isolation.
 */
export type NameValidation =
  | { ok: true; fullName: string }
  | { ok: false; error: string };

export function validateInvitedName(
  firstName: string,
  lastName: string,
): NameValidation {
  const first = firstName.trim();
  const last = lastName.trim();
  if (!first || !last) {
    return { ok: false, error: "Enter your first and last name." };
  }
  return { ok: true, fullName: `${first} ${last}` };
}

export function signupReducer(
  state: SignupState,
  event: SignupEvent,
): SignupState {
  switch (event.type) {
    case "account_created":
      return {
        step: "code",
        email: event.email,
        notice:
          "Account created. We emailed you a one-time code — enter it below to finish signing in.",
      };
    case "signup_rejected":
      return { step: "form", error: event.message };
    case "code_rejected":
      if (state.step !== "code") return state;
      return {
        step: "code",
        email: state.email,
        error:
          "That code is invalid or expired. Request a fresh code and try again.",
      };
    case "code_resent":
      if (state.step !== "code") return state;
      return {
        step: "code",
        email: state.email,
        notice: "We sent a fresh code to your email.",
      };
    default:
      return state;
  }
}
