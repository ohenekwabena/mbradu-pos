import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16 renamed Middleware to Proxy. This runs before every matched
// request to refresh the Supabase session and gate protected routes.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and image files. Auth
     * should run on everything else, including the app routes and /login.
     * The PWA manifest and service worker (#32) are public: browsers fetch the
     * manifest without cookies, and a redirect to /login would break install.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
