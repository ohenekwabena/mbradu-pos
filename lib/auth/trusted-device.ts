import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * "Remember me for 30 days" — a signed, per-user token proving this browser
 * already passed the emailed-code step (ADR-0003). While it is valid, signing in
 * needs only the password; after it lapses the code is required again.
 *
 * The token is `<userId>.<expiresAtMs>.<hmac>`. It is bound to one user (a shared
 * till can hold one per Cashier) and its expiry is fixed when the code is
 * verified — password-only sign-ins do NOT extend it, so the code comes back at
 * least every 30 days.
 */

export const TRUST_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const COOKIE_PREFIX = "mbradu_td_";

export function trustedDeviceCookieName(userId: string): string {
  return `${COOKIE_PREFIX}${userId}`;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createTrustToken(
  userId: string,
  key: string,
  now: number = Date.now(),
): { token: string; expiresAt: number } {
  const expiresAt = now + TRUST_DURATION_MS;
  const payload = `${userId}.${expiresAt}`;
  return { token: `${payload}.${sign(payload, key)}`, expiresAt };
}

export function isTrustTokenValid(
  token: string | undefined,
  userId: string,
  key: string,
  now: number = Date.now(),
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokenUserId, expiresAtRaw, signature] = parts;

  if (tokenUserId !== userId) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;

  const expected = Buffer.from(sign(`${tokenUserId}.${expiresAtRaw}`, key));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
