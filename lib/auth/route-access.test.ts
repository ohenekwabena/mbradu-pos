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
});
