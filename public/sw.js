/*
 * Mbradu POS service worker (ADR-0008 follow-up, GitHub #32).
 *
 * Purpose: a fast cold start on mobile data. It caches ONLY immutable static
 * assets — Next's content-hashed build output (/_next/static/…) and the app's
 * icons/brand images — cache-first, so after the first visit the app shell's
 * JS/CSS/fonts load from the phone instead of the network.
 *
 * It deliberately does NOT touch anything else: page HTML, RSC/data requests,
 * server actions, auth, and every Supabase call go straight to the network as
 * if this worker didn't exist. So it never serves stale or authenticated
 * content, never holds a Sale, and never enables offline selling (a non-goal).
 *
 * Deploy updates: page HTML is always fetched fresh and references the new
 * deploy's hashed filenames, so a cashier is never stuck on old code — new
 * assets are simply fetched and cached on first use. Old hashed files are
 * trimmed once the cache grows past MAX_ENTRIES. This file itself is served
 * with Cache-Control: no-cache (next.config.ts) so changes to it propagate.
 */

const CACHE = "mbradu-static-v1";
const MAX_ENTRIES = 300;

function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname.startsWith("/brand/"))
  );
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]); // oldest first
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!isStaticAsset(url)) return; // everything else: plain network

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        event.waitUntil(cache.put(request, response.clone()).then(() => trim(cache)));
      }
      return response;
    })(),
  );
});
