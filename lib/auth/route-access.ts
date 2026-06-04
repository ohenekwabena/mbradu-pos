export type AccessDecision =
  | { type: "allow" }
  | { type: "redirect"; to: string };

// Public, unauthenticated entry points. An already-authenticated visitor who
// lands on one of these is forwarded to the app home.
const PUBLIC_PATHS = new Set(["/login", "/forgot-password"]);

// Password-recovery surfaces that must stay reachable *regardless* of auth
// state. Clicking a recovery link establishes a (recovery) session via
// /auth/callback, so the visitor is already "authenticated" by the time they
// reach /reset-password — yet they still need to finish setting a new password
// rather than be bounced to the app home.
const ALWAYS_ALLOW_PATHS = new Set(["/reset-password", "/auth/callback"]);

const APP_HOME = "/dashboard";

export function decideRouteAccess({
  path,
  isAuthenticated,
}: {
  path: string;
  isAuthenticated: boolean;
}): AccessDecision {
  if (ALWAYS_ALLOW_PATHS.has(path)) {
    return { type: "allow" };
  }

  const isPublic = PUBLIC_PATHS.has(path);

  if (!isAuthenticated && !isPublic) {
    return { type: "redirect", to: "/login" };
  }
  if (isAuthenticated && isPublic) {
    return { type: "redirect", to: APP_HOME };
  }
  return { type: "allow" };
}
