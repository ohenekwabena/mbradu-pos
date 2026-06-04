"use server";

import {
  forgotReducer,
  initialForgotState,
  type ForgotState,
} from "@/lib/auth/forgot-flow";
import {
  lookupAccount,
  notifyOwnerOfCashierResetRequest,
  sendPasswordRecoveryEmail,
} from "@/lib/auth/reset";

/**
 * Forgot-password request. Enforces the rule that only an Owner can self-serve
 * a reset (ADR/CONTEXT: cashiers can't change their own password). A Cashier or
 * unrecognized email gets the same "your Owner resets this" outcome — so the
 * form never reveals whether a given cashier email exists.
 */
export async function requestPasswordReset(
  _prevState: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email) {
    return forgotReducer(initialForgotState, { type: "invalid_email" });
  }

  const account = await lookupAccount(email);

  if (account?.role === "owner") {
    try {
      await sendPasswordRecoveryEmail(account.email, account.fullName);
    } catch {
      return forgotReducer(initialForgotState, { type: "send_failed" });
    }
    return forgotReducer(initialForgotState, {
      type: "recovery_sent",
      email: account.email,
    });
  }

  // Cashier or unknown email — the Owner triggers cashier resets from Staff.
  await notifyOwnerOfCashierResetRequest(email);
  return forgotReducer(initialForgotState, { type: "owner_resets" });
}
