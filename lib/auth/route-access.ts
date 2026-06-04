export type AccessDecision =
  | { type: "allow" }
  | { type: "redirect"; to: string };

const PUBLIC_PATHS = new Set(["/login"]);
const APP_HOME = "/dashboard";

export function decideRouteAccess({
  path,
  isAuthenticated,
}: {
  path: string;
  isAuthenticated: boolean;
}): AccessDecision {
  const isPublic = PUBLIC_PATHS.has(path);

  if (!isAuthenticated && !isPublic) {
    return { type: "redirect", to: "/login" };
  }
  if (isAuthenticated && isPublic) {
    return { type: "redirect", to: APP_HOME };
  }
  return { type: "allow" };
}
