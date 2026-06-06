import { describe, it, expect } from "vitest";

import { loginReducer, initialLoginState } from "./login-flow";

describe("two-step login reducer", () => {
  it("advances from password entry to code entry, carrying the email, when the password is accepted", () => {
    const state = loginReducer(initialLoginState, {
      type: "password_accepted",
      email: "owner@mbradu.example",
    });

    expect(state).toMatchObject({ step: "code", email: "owner@mbradu.example" });
  });

  it("tells the user a one-time code was emailed after the password is accepted", () => {
    const state = loginReducer(initialLoginState, {
      type: "password_accepted",
      email: "owner@mbradu.example",
    });

    expect(state.step).toBe("code");
    if (state.step !== "code") throw new Error("unreachable");
    expect(state.notice).toMatch(/code/i);
    expect(state.error).toBeUndefined();
  });

  it("keeps the user on password entry with a clear error when the password is rejected", () => {
    const state = loginReducer(initialLoginState, { type: "password_rejected" });

    expect(state.step).toBe("password");
    if (state.step !== "password") throw new Error("unreachable");
    expect(state.error).toMatch(/password/i);
  });

  it("blocks a deactivated account at the password step with a clear message", () => {
    const state = loginReducer(initialLoginState, {
      type: "account_deactivated",
    });

    expect(state.step).toBe("password");
    if (state.step !== "password") throw new Error("unreachable");
    expect(state.error).toMatch(/deactivated/i);
  });

  it("completes login when the emailed code is accepted", () => {
    const codeState = loginReducer(initialLoginState, {
      type: "password_accepted",
      email: "owner@mbradu.example",
    });

    const state = loginReducer(codeState, { type: "code_accepted" });

    expect(state.step).toBe("authenticated");
  });

  it("keeps the user on code entry with a clear error when the code is wrong or expired", () => {
    const codeState = loginReducer(initialLoginState, {
      type: "password_accepted",
      email: "owner@mbradu.example",
    });

    const state = loginReducer(codeState, { type: "code_rejected" });

    expect(state.step).toBe("code");
    if (state.step !== "code") throw new Error("unreachable");
    expect(state.email).toBe("owner@mbradu.example");
    expect(state.error).toMatch(/code/i);
    expect(state.notice).toBeUndefined();
  });

  it("confirms a fresh code was sent and clears the prior error when the user requests a resend", () => {
    const rejected = loginReducer(
      loginReducer(initialLoginState, {
        type: "password_accepted",
        email: "owner@mbradu.example",
      }),
      { type: "code_rejected" },
    );

    const state = loginReducer(rejected, { type: "code_resent" });

    expect(state.step).toBe("code");
    if (state.step !== "code") throw new Error("unreachable");
    expect(state.email).toBe("owner@mbradu.example");
    expect(state.notice).toMatch(/code/i);
    expect(state.error).toBeUndefined();
  });

  it("returns to a pristine password step, dropping the email and any message, when the user starts over", () => {
    const rejected = loginReducer(
      loginReducer(initialLoginState, {
        type: "password_accepted",
        email: "owner@mbradu.example",
      }),
      { type: "code_rejected" },
    );

    const state = loginReducer(rejected, { type: "start_over" });

    expect(state).toEqual(initialLoginState);
  });
});
