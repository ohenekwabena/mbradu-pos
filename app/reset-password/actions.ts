"use server";

import { type ResetState, validateNewPassword } from "@/lib/auth/password";
import { createClient } from "@/lib/supabase/server";

/**
 * Completes a password reset. The recovery session (established by
 * /auth/callback) authorizes the update; afterward we sign out so the user
 * re-enters through the normal two-step login (ADR-0003) rather than staying
 * signed in on the recovery session.
 */
export async function setNewPassword(
  _prevState: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const validationError = validateNewPassword(password, confirm);
  if (validationError) {
    return { step: "form", error: validationError };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      step: "form",
      error: "Your reset link has expired. Ask the Owner for a fresh one.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { step: "form", error: error.message };
  }

  await supabase.auth.signOut();
  return { step: "done" };
}
