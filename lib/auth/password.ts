/**
 * Set-a-new-password screen: its state plus the pure validation rule. Kept
 * separate from the Server Action (which can only export async functions) so
 * the client form can import the type + initial state, and the rule is
 * unit-tested in isolation.
 */
export const MIN_PASSWORD_LENGTH = 8;

export type ResetState =
  | { step: "form"; error?: string }
  | { step: "done" };

export const initialResetState: ResetState = { step: "form" };

/** Returns an error message, or `null` when the new password is acceptable. */
export function validateNewPassword(
  password: string,
  confirm: string,
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) {
    return "Both passwords must match.";
  }
  return null;
}
