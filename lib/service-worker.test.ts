/**
 * Behaviour of `public/sw.js` (#32), run in a sandbox with fake `self`,
 * `caches` and `fetch`. The guarantees that matter: it intercepts ONLY immutable
 * static assets (cache-first), and never touches pages, data, server actions or
 * Supabase — so it can't serve stale/authenticated content or hold a Sale.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

const ORIGIN = "https://pos.example.com";
const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

type Listener = (event: unknown) => void;

function loadWorker() {
  const listeners: Record<string, Listener> = {};
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (req: Request) => store.get(req.url)?.clone()),
    put: vi.fn(async (req: Request, res: Response) => void store.set(req.url, res)),
    keys: vi.fn(async () => [...store.keys()].map((url) => new Request(url))),
    delete: vi.fn(async (req: Request) => store.delete(req.url)),
  };
  const fetchMock = vi.fn(async () => {
    const res = new Response("asset", { status: 200 });
    Object.defineProperty(res, "type", { value: "basic" });
    return res;
  });
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, fn: Listener) => void (listeners[type] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ["old-v0", "mbradu-static-v1"]), delete: vi.fn() };
  vm.runInNewContext(source, { self, caches, fetch: fetchMock, URL, Promise });

  /** Dispatch a fetch; returns the response if the worker took it, else null. */
  async function dispatch(url: string, method = "GET"): Promise<Response | null> {
    let responded: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    listeners.fetch({
      request: new Request(url, { method }),
      respondWith: (p: Promise<Response>) => void (responded = p),
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
    });
    if (!responded) return null;
    const res = await responded;
    await Promise.all(waits);
    return res;
  }
  return { listeners, dispatch, fetchMock, cache, caches, self };
}

describe("public/sw.js", () => {
  it("leaves pages, data, server actions and Supabase to the network", async () => {
    const { dispatch, fetchMock } = loadWorker();
    for (const url of [
      `${ORIGIN}/sell`,
      `${ORIGIN}/sales/abc?tendered=500`,
      `${ORIGIN}/sell?_rsc=1x2y`,
      `${ORIGIN}/manifest.webmanifest`,
      `https://project.supabase.co/rest/v1/rpc/complete_sale`,
      `https://project.supabase.co/rest/v1/shop_stock?shop_id=eq.1`,
      `https://cdn.example.com/_next/static/chunks/x.js`,
    ]) {
      expect(await dispatch(url)).toBeNull();
    }
    expect(await dispatch(`${ORIGIN}/_next/static/chunks/app.js`, "POST")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves hashed static assets and icons cache-first", async () => {
    const { dispatch, fetchMock, cache } = loadWorker();
    const asset = `${ORIGIN}/_next/static/chunks/app-3f9a.js`;
    expect(await (await dispatch(asset))!.text()).toBe("asset");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);

    expect(await (await dispatch(asset))!.text()).toBe("asset"); // from cache
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await dispatch(`${ORIGIN}/icons/icon-192.png`)).not.toBeNull();
  });

  it("takes over immediately and deletes caches from older worker versions", async () => {
    const { listeners, self, caches } = loadWorker();
    listeners.install({});
    expect(self.skipWaiting).toHaveBeenCalled();
    let done: Promise<unknown> = Promise.resolve();
    listeners.activate({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
    expect(caches.delete).toHaveBeenCalledWith("old-v0");
    expect(caches.delete).not.toHaveBeenCalledWith("mbradu-static-v1");
    expect(self.clients.claim).toHaveBeenCalled();
  });
});
