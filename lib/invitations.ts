/**
 * Invitations domain — the Owner's act of authorizing a new Cashier to sign up
 * **into a specific Shop** (CONTEXT.md: Invitation; ADR-0005). An Invitation
 * names an email and a target Shop and carries a single-use `token` for the
 * token-gated sign-up the Cashier later completes.
 *
 * Like the Money, Catalog, and Stock-ledger modules this file is deliberately
 * free of any server/Supabase imports, so the Server Action that issues an
 * invitation, the Staff page that lists pending ones, and the unit tests can all
 * share the same pure validation/formatting. The real write goes through the
 * `invitations` table under the Owner-only "Owner manages invitations" RLS
 * policy, and the public sign-up page reads a pending, unexpired row by exact
 * token via the SECURITY DEFINER `invitation_for_token` RPC (both already exist
 * in `…_create_invitations.sql`). MP-27 is the Owner-side issue + pending list;
 * the Cashier-side sign-up that consumes the token is MP-28.
 */

/**
 * How long an issued Invitation stays valid. After this, the token is dead and
 * `invitation_for_token` returns nothing (its `expires_at > now()` guard), so
 * the Owner must send a fresh one. A fortnight is long enough to reach a new
 * hire without leaving stale, accept-able links lying around indefinitely.
 */
export const INVITE_TTL_DAYS = 14;

/**
 * Pragmatic email shape check: a non-empty local part, an `@`, a domain with at
 * least one dot, and no whitespace. Deliberately permissive — the authoritative
 * proof an address works is that the invitation email actually arrives — but it
 * catches the obvious typos ("name@", "nodomain", a stray space) before a row is
 * written.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Raw invite input from the Staff page form (all strings). */
export interface InviteInput {
  /** The Cashier's email — what the invitation is addressed to. */
  email: string;
  /** The Shop the Cashier will be bound to on sign-up. */
  shopId: string;
}

/** A validated, normalized invitation, ready to insert + email. */
export interface InviteWrite {
  /** Lower-cased, trimmed email — the canonical form stored and matched. */
  email: string;
  /** The chosen target Shop's id. */
  shopId: string;
}

export type InviteParseResult =
  | { ok: true; value: InviteWrite }
  | { ok: false; error: string };

/**
 * Validate + normalize raw invite input into an {@link InviteWrite}, or return
 * the first problem as a human message:
 *   - an email is required and must look like an address;
 *   - a target Shop must be chosen (a Cashier is bound to exactly one Shop).
 *
 * The email is lower-cased and trimmed so the stored value, the duplicate check,
 * and the eventual sign-up match on one canonical form. Pure (no I/O): the
 * unit-tested core the Server Action wraps before the Owner-gated insert, which
 * RLS re-checks via "Owner manages invitations".
 */
export function parseInviteInput(input: InviteInput): InviteParseResult {
  const email = input.email.trim().toLowerCase();
  if (email === "") return { ok: false, error: "Enter an email address." };
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const shopId = input.shopId.trim();
  if (shopId === "") return { ok: false, error: "Choose a shop for this cashier." };

  return { ok: true, value: { email, shopId } };
}

/**
 * A short, human "how long ago" for a pending invitation's `created_at`, e.g.
 * "just now", "5 minutes ago", "2 hours ago", "3 days ago" — the Staff page
 * prefixes it with "Invited ". `nowMs` is passed in (not read from the clock) so
 * the formatting is pure and deterministically testable. An unparseable or
 * future timestamp falls back to "just now".
 */
export function formatInvitedAgo(createdAtIso: string, nowMs: number): string {
  const thenMs = Date.parse(createdAtIso);
  if (Number.isNaN(thenMs)) return "just now";

  const seconds = Math.floor((nowMs - thenMs) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${plural(minutes, "minute")} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "hour")} ago`;

  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, "day")} ago`;
}

/** "1 minute" / "2 minutes" — pluralize a unit by its count. */
function plural(count: number, unit: string): string {
  return count === 1 ? unit : `${unit}s`;
}
