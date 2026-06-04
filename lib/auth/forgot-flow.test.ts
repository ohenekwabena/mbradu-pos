import { describe, it, expect } from "vitest";

import { forgotReducer, initialForgotState } from "./forgot-flow";

describe("forgot-password reducer", () => {
  it("keeps the user on the request step with an error when no email is given", () => {
    const state = forgotReducer(initialForgotState, { type: "invalid_email" });

    expect(state.step).toBe("request");
    if (state.step !== "request") throw new Error("unreachable");
    expect(state.error).toMatch(/email/i);
  });

  it("moves to the sent step carrying the email when a recovery link goes out", () => {
    const state = forgotReducer(initialForgotState, {
      type: "recovery_sent",
      email: "owner@mbradu.shop",
    });

    expect(state).toEqual({ step: "sent", email: "owner@mbradu.shop" });
  });

  it("routes a cashier (or unknown email) to the Owner-resets-this step", () => {
    const state = forgotReducer(initialForgotState, { type: "owner_resets" });

    expect(state).toEqual({ step: "blocked" });
  });

  it("surfaces a retryable error on the request step when the email fails to send", () => {
    const state = forgotReducer(initialForgotState, { type: "send_failed" });

    expect(state.step).toBe("request");
    if (state.step !== "request") throw new Error("unreachable");
    expect(state.error).toMatch(/try again/i);
  });
});
