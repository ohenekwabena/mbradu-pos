import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { decideRouteAccess } from "@/lib/auth/route-access";

/**
 * Refreshes the Supabase auth session on every request and enforces the
 * route-access policy. The allow/redirect decision is delegated to the
 * pure, unit-tested `decideRouteAccess` so this layer stays a thin wrapper.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // With Fluid compute, don't hoist this client to a global. Create it per request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getClaims().
  // A mistake here can randomly log users out.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims);

  const decision = decideRouteAccess({
    path: request.nextUrl.pathname,
    isAuthenticated,
  });

  if (decision.type === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = decision.to;
    const redirectResponse = NextResponse.redirect(url);
    // Carry the refreshed auth cookies onto the redirect so the session stays in sync.
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  return supabaseResponse;
}
