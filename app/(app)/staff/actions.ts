"use server";

import { NotAuthorizedError, assertCan } from "@/lib/auth/visibility";
import { lookupAccount, sendPasswordRecoveryEmail } from "@/lib/auth/reset";
import { getCurrentProfile } from "@/lib/dal";

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
