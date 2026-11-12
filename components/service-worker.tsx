"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js` (static-asset cache for fast cold starts, #32).
 * Production only: in `next dev` a cache-first worker would fight hot reload.
 * `updateViaCache: "none"` makes the browser always re-check the worker script.
 * Renders nothing; failure to register is harmless (the app works without it).
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Not fatal: without the worker the app simply loads from the network.
    });
  }, []);
  return null;
}
