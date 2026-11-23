import { describe, it, expect } from "vitest";

import {
  TRUST_DURATION_MS,
  createTrustToken,
  isTrustTokenValid,
} from "./trusted-device";

const KEY = "test-signing-key";
const USER = "6f1c2a4e-0000-4000-8000-000000000001";
const OTHER_USER = "6f1c2a4e-0000-4000-8000-000000000002";
const NOW = Date.UTC(2026, 10, 23);

describe("trusted-device token", () => {
  it("is valid for the user it was issued to, right after the code is verified", () => {
    const { token } = createTrustToken(USER, KEY, NOW);
    expect(isTrustTokenValid(token, USER, KEY, NOW)).toBe(true);
  });

  it("expires 30 days after it was issued", () => {
    const { token, expiresAt } = createTrustToken(USER, KEY, NOW);
    expect(expiresAt).toBe(NOW + TRUST_DURATION_MS);
    expect(isTrustTokenValid(token, USER, KEY, expiresAt - 1)).toBe(true);
    expect(isTrustTokenValid(token, USER, KEY, expiresAt)).toBe(false);
  });

  it("does not let one user's token skip the code for a different user", () => {
    const { token } = createTrustToken(USER, KEY, NOW);
    expect(isTrustTokenValid(token, OTHER_USER, KEY, NOW)).toBe(false);
  });

  it("rejects a token whose expiry was tampered with", () => {
    const { token } = createTrustToken(USER, KEY, NOW);
    const [id, , sig] = token.split(".");
    const forged = `${id}.${NOW + 10 * TRUST_DURATION_MS}.${sig}`;
    expect(isTrustTokenValid(forged, USER, KEY, NOW)).toBe(false);
  });

  it("rejects a token signed with a different key", () => {
    const { token } = createTrustToken(USER, "another-key", NOW);
    expect(isTrustTokenValid(token, USER, KEY, NOW)).toBe(false);
  });

  it("rejects a missing or malformed token", () => {
    expect(isTrustTokenValid(undefined, USER, KEY, NOW)).toBe(false);
    expect(isTrustTokenValid("", USER, KEY, NOW)).toBe(false);
    expect(isTrustTokenValid("garbage", USER, KEY, NOW)).toBe(false);
    expect(isTrustTokenValid(`${USER}.abc.def`, USER, KEY, NOW)).toBe(false);
  });
});
