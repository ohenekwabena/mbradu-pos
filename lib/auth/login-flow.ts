export type LoginState =
  | { step: "password"; error?: string }
  | { step: "code"; email: string; error?: string; notice?: string }
  | { step: "authenticated" };

export type LoginEvent =
  | { type: "password_accepted"; email: string }
  | { type: "password_rejected" }
  | { type: "code_accepted" }
  | { type: "code_rejected" }
  | { type: "code_resent" }
  | { type: "account_deactivated" };

export const initialLoginState: LoginState = { step: "password" };

export function loginReducer(state: LoginState, event: LoginEvent): LoginState {
  switch (event.type) {
    case "password_accepted":
      return {
        step: "code",
        email: event.email,
        notice: "We emailed you a one-time code. Enter it below to finish signing in.",
      };
    case "password_rejected":
      return { step: "password", error: "Incorrect email or password." };
    case "account_deactivated":
      return {
        step: "password",
        error:
          "This account has been deactivated. Contact the shop owner to regain access.",
      };
    case "code_accepted":
      return { step: "authenticated" };
    case "code_rejected":
      if (state.step !== "code") return state;
      return {
        step: "code",
        email: state.email,
        error: "That code is invalid or expired. Request a fresh code and try again.",
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
