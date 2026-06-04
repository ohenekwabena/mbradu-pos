import { describe, it, expect } from "vitest";

import { MIN_PASSWORD_LENGTH, validateNewPassword } from "./password";

describe("validateNewPassword", () => {
  it("rejects a password shorter than the minimum", () => {
    expect(validateNewPassword("short", "short")).toMatch(/at least/i);
  });

  it("rejects when the confirmation doesn't match", () => {
    expect(validateNewPassword("longenough1", "different1")).toMatch(/match/i);
  });

  it("accepts a long-enough, matching password", () => {
    expect(validateNewPassword("longenough1", "longenough1")).toBeNull();
  });

  it("treats exactly the minimum length as valid", () => {
    const pw = "x".repeat(MIN_PASSWORD_LENGTH);
    expect(validateNewPassword(pw, pw)).toBeNull();
  });
});
