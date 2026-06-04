import { describe, it, expect } from "vitest";

import { decideRouteAccess } from "./route-access";

describe("route-access policy", () => {
  it("redirects an unauthenticated visitor on a protected app route to /login", () => {
    const decision = decideRouteAccess({
      path: "/dashboard",
      isAuthenticated: false,
    });

    expect(decision).toEqual({ type: "redirect", to: "/login" });
  });

  it("allows an unauthenticated visitor to reach the login page", () => {
    const decision = decideRouteAccess({
      path: "/login",
      isAuthenticated: false,
    });

    expect(decision).toEqual({ type: "allow" });
  });

  it("sends an already-authenticated user away from the login page to the app home", () => {
    const decision = decideRouteAccess({
      path: "/login",
      isAuthenticated: true,
    });

    expect(decision).toEqual({ type: "redirect", to: "/dashboard" });
  });

  it("allows an authenticated user onto a protected app route", () => {
    const decision = decideRouteAccess({
      path: "/inventory",
      isAuthenticated: true,
    });

    expect(decision).toEqual({ type: "allow" });
  });

  it("allows an unauthenticated visitor to reach the forgot-password page", () => {
    const decision = decideRouteAccess({
      path: "/forgot-password",
      isAuthenticated: false,
    });

    expect(decision).toEqual({ type: "allow" });
  });

  it("sends an already-authenticated user away from the forgot-password page", () => {
    const decision = decideRouteAccess({
      path: "/forgot-password",
      isAuthenticated: true,
    });

    expect(decision).toEqual({ type: "redirect", to: "/dashboard" });
  });

  it("lets an unauthenticated visitor reach /reset-password (e.g. an invalid link)", () => {
    const decision = decideRouteAccess({
      path: "/reset-password",
      isAuthenticated: false,
    });

    expect(decision).toEqual({ type: "allow" });
  });

  it("keeps /reset-password reachable for the recovery session instead of bouncing home", () => {
    // The recovery link logs the user in, so isAuthenticated is true here — but
    // they must still be allowed to finish setting a new password.
    const decision = decideRouteAccess({
      path: "/reset-password",
      isAuthenticated: true,
    });

    expect(decision).toEqual({ type: "allow" });
  });

  it("always allows the /auth/callback recovery handler", () => {
    expect(
      decideRouteAccess({ path: "/auth/callback", isAuthenticated: false }),
    ).toEqual({ type: "allow" });
    expect(
      decideRouteAccess({ path: "/auth/callback", isAuthenticated: true }),
    ).toEqual({ type: "allow" });
  });
});
