import { describe, it, expect } from "vitest";

import {
  EMAIL_RE,
  INVITE_TTL_DAYS,
  formatInvitedAgo,
  parseInviteInput,
  type InviteInput,
} from "./invitations";

const SHOP = "11111111-1111-1111-1111-111111111111";

describe("parseInviteInput", () => {
  it("accepts a valid email + shop and returns the normalized write", () => {
    const result = parseInviteInput({ email: "kojo@mbradu.shop", shopId: SHOP });
    expect(result).toEqual({
      ok: true,
      value: { email: "kojo@mbradu.shop", shopId: SHOP },
    });
  });

  it("lower-cases and trims the email so it stores in one canonical form", () => {
    const result = parseInviteInput({
      email: "  Kojo.Mensah@Mbradu.Shop  ",
      shopId: SHOP,
    });
    expect(result).toEqual({
      ok: true,
      value: { email: "kojo.mensah@mbradu.shop", shopId: SHOP },
    });
  });

  it("trims the chosen shop id", () => {
    const result = parseInviteInput({ email: "a@b.com", shopId: `  ${SHOP} ` });
    expect(result.ok && result.value.shopId).toBe(SHOP);
  });

  it("rejects a blank email", () => {
    const result = parseInviteInput({ email: "   ", shopId: SHOP });
    expect(result).toEqual({ ok: false, error: "Enter an email address." });
  });

  it.each([
    "nope",
    "no-at-sign.com",
    "missing@domain",
    "trailing@dot.",
    "two spaces@x.com",
    "@nolocal.com",
  ])("rejects the malformed email %j", (email) => {
    const result = parseInviteInput({ email, shopId: SHOP });
    expect(result).toEqual({ ok: false, error: "Enter a valid email address." });
  });

  it("requires a target shop (a Cashier is bound to exactly one)", () => {
    const result = parseInviteInput({ email: "kojo@mbradu.shop", shopId: "  " });
    expect(result).toEqual({
      ok: false,
      error: "Choose a shop for this cashier.",
    });
  });

  it("reports the email problem before the missing shop", () => {
    const result = parseInviteInput({ email: "bad", shopId: "" } as InviteInput);
    expect(result).toEqual({ ok: false, error: "Enter a valid email address." });
  });
});

describe("EMAIL_RE", () => {
  it("matches a plain address and rejects an obviously broken one", () => {
    expect(EMAIL_RE.test("ama@mbradu.shop")).toBe(true);
    expect(EMAIL_RE.test("ama@@mbradu.shop")).toBe(false);
  });
});

describe("INVITE_TTL_DAYS", () => {
  it("is a positive whole number of days", () => {
    expect(Number.isInteger(INVITE_TTL_DAYS)).toBe(true);
    expect(INVITE_TTL_DAYS).toBeGreaterThan(0);
  });
});

describe("formatInvitedAgo", () => {
  const now = Date.parse("2026-06-05T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it("says 'just now' under a minute", () => {
    expect(formatInvitedAgo(ago(0), now)).toBe("just now");
    expect(formatInvitedAgo(ago(59 * SECOND), now)).toBe("just now");
  });

  it("counts minutes, singular and plural", () => {
    expect(formatInvitedAgo(ago(MINUTE), now)).toBe("1 minute ago");
    expect(formatInvitedAgo(ago(5 * MINUTE), now)).toBe("5 minutes ago");
    expect(formatInvitedAgo(ago(59 * MINUTE), now)).toBe("59 minutes ago");
  });

  it("counts hours, singular and plural", () => {
    expect(formatInvitedAgo(ago(HOUR), now)).toBe("1 hour ago");
    expect(formatInvitedAgo(ago(5 * HOUR), now)).toBe("5 hours ago");
    expect(formatInvitedAgo(ago(23 * HOUR), now)).toBe("23 hours ago");
  });

  it("counts days, singular and plural", () => {
    expect(formatInvitedAgo(ago(DAY), now)).toBe("1 day ago");
    expect(formatInvitedAgo(ago(2 * DAY), now)).toBe("2 days ago");
  });

  it("falls back to 'just now' for an unparseable or future timestamp", () => {
    expect(formatInvitedAgo("not-a-date", now)).toBe("just now");
    expect(formatInvitedAgo(new Date(now + HOUR).toISOString(), now)).toBe(
      "just now",
    );
  });
});
