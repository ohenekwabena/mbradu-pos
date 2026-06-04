/**
 * Forgot-password screen state. The request step collects an email; the outcome
 * is either "we emailed you a link" (Owner) or "your Owner resets this"
 * (Cashier / unrecognized email — we never reveal which). Pure and unit-tested,
 * mirroring {@link "@/lib/auth/login-flow"}, so the Server Action stays thin.
 */
export type ForgotState =
  | { step: "request"; error?: string }
  | { step: "sent"; email: string }
  | { step: "blocked" };

export type ForgotEvent =
  | { type: "invalid_email" }
  | { type: "send_failed" }
  | { type: "recovery_sent"; email: string }
  | { type: "owner_resets" };

export const initialForgotState: ForgotState = { step: "request" };

export function forgotReducer(
  state: ForgotState,
  event: ForgotEvent,
): ForgotState {
  switch (event.type) {
    case "invalid_email":
      return { step: "request", error: "Enter your account email to continue." };
    case "send_failed":
      return {
        step: "request",
        error: "We couldn't send the reset email just now. Please try again.",
      };
    case "recovery_sent":
      return { step: "sent", email: event.email };
    case "owner_resets":
      return { step: "blocked" };
    default:
      return state;
  }
}
