import "server-only";

import { createHmac } from "node:crypto";
import { cookies } from "next/headers";

import {
  TRUST_DURATION_MS,
  createTrustToken,
  isTrustTokenValid,
  trustedDeviceCookieName,
} from "./trusted-device";

/**
 * Signing key for the trusted-device cookie. Uses TRUSTED_DEVICE_SECRET when set,
 * otherwise derives a purpose-bound key from the service-role key (already a
 * required server secret), so no new env var is needed to deploy. Rotating
 * either one invalidates every remembered device — everyone gets a code once.
 */
function signingKey(): string {
  const secret =
    process.env.TRUSTED_DEVICE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("No secret available to sign trusted devices.");
  return createHmac("sha256", secret).update("mbradu-trusted-device-v1").digest("hex");
}

/** Has this browser verified an emailed code for `userId` in the last 30 days? */
export async function isDeviceTrusted(userId: string): Promise<boolean> {
  const store = await cookies();
  const token = store.get(trustedDeviceCookieName(userId))?.value;
  return isTrustTokenValid(token, userId, signingKey());
}

/** Remember this browser for `userId` for 30 days from now. */
export async function trustDevice(userId: string): Promise<void> {
  const { token } = createTrustToken(userId, signingKey());
  const store = await cookies();
  store.set(trustedDeviceCookieName(userId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(TRUST_DURATION_MS / 1000),
  });
}

/** Stop remembering this browser for `userId` (Remember me was unticked). */
export async function forgetDevice(userId: string): Promise<void> {
  const store = await cookies();
  store.delete(trustedDeviceCookieName(userId));
}
