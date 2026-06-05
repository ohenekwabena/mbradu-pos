import { describe, it, expect } from "vitest";

import { signupReducer, initialSignupState } from "./signup-flow";

describe("invitation sign-up reducer", () => {
  it("advances from the password form to code entry, carrying the email, once the account is created", () => {
    const state = signupReducer(initialSignupState, {
      type: "account_created",
      email: "kojo@mbradu.example",
    });

    expect(state).toMatchObject({ step: "code", email: "kojo@mbradu.example" });
  });

  it("tells the user a one-time code was emailed after the account is created", () => {
    const state = signupReducer(initialSignupState, {
      type: "account_created",
      email: "kojo@mbradu.example",
    });

    expect(state.step).toBe("code");
    if (state.step !== "code") throw new Error("unreachable");
    expect(state.notice).toMatch(/code/i);
    expect(state.error).toBeUndefined();
  });

  it("keeps the user on the form with the given reason when sign-up is rejected", () => {
    const state = signupReducer(initialSignupState, {
      type: "signup_rejected",
      message: "Use at least 8 characters.",
    });

    expect(state.step).toBe("form");
    if (state.step !== "form") throw new Error("unreachable");
    expect(state.error).toBe("Use at least 8 characters.");
  });

  it("keeps the user on code entry with a clear error when the code is wrong or expired", () => {
    const codeState = signupReducer(initialSignupState, {
      type: "account_created",
      email: "kojo@mbradu.example",
    });

    const state = signupReducer(codeState, { type: "code_rejected" });

    expect(state.step).toBe("code");
    if (state.step !== "code") throw new Error("unreachable");
    expect(state.email).toBe("kojo@mbradu.example");
    expect(state.error).toMatch(/code/i);
    expect(state.notice).toBeUndefined();
  });

  it("confirms a fresh code was sent and clears the prior error on resend", () => {
    const rejected = signupReducer(
      signupReducer(initialSignupState, {
        type: "account_created",
        email: "kojo@mbradu.example",
      }),
      { type: "code_rejected" },
    );

    const state = signupReducer(rejected, { type: "code_resent" });

    expect(state.step).toBe("code");
    if (state.step !== "code") throw new Error("unreachable");
    expect(state.email).toBe("kojo@mbradu.example");
    expect(state.notice).toMatch(/code/i);
    expect(state.error).toBeUndefined();
  });

  it("ignores code events that arrive while still on the form step", () => {
    const state = signupReducer(initialSignupState, { type: "code_rejected" });

    expect(state).toEqual(initialSignupState);
  });
});
