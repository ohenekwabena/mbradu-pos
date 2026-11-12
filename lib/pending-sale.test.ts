import { describe, expect, it, vi } from "vitest";

import {
  classifyAttempt,
  IDLE,
  isInFlight,
  isLocked,
  pendingSaleReducer,
  sendWithRetry,
  type AttemptResult,
  type PendingSaleEvent,
  type PendingSaleState,
} from "./pending-sale";

const network: AttemptResult = { ok: false, error: { message: "TypeError: Failed to fetch" } };
const stock: AttemptResult = {
  ok: false,
  error: { message: "insufficient_stock", details: JSON.stringify({ item_id: "i1", available: 0 }) },
};
const done: AttemptResult = { ok: true, saleId: "sale-1" };

/** Run a send cycle against scripted attempt results; returns the calls made,
 * every dispatched event, the final reduced state and the backoffs slept. */
async function run(script: (AttemptResult | Error)[], delays = [10, 20]) {
  const calls: number[] = [];
  const events: PendingSaleEvent[] = [];
  const slept: number[] = [];
  let state: PendingSaleState = IDLE;
  let i = 0;
  const final = await sendWithRetry(
    async () => {
      calls.push(i);
      const next = script[Math.min(i++, script.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
    (event) => {
      events.push(event);
      state = pendingSaleReducer(state, event);
    },
    { delays, sleep: async (ms) => void slept.push(ms) },
  );
  return { calls: calls.length, events, state, slept, final };
}

describe("classifyAttempt", () => {
  it("treats a stable code as a definitive rejection", () => {
    expect(classifyAttempt(stock)).toMatchObject({ kind: "rejected", error: { code: "insufficient_stock" } });
  });
  it("treats network failures and unknown errors as transient", () => {
    expect(classifyAttempt(network)).toEqual({ kind: "transient" });
    expect(classifyAttempt({ ok: false, error: null })).toEqual({ kind: "transient" });
    expect(classifyAttempt({ ok: false, error: { message: "AbortError: signal timed out" } })).toEqual({
      kind: "transient",
    });
  });
  it("confirms a Sale", () => {
    expect(classifyAttempt(done)).toEqual({ kind: "completed", saleId: "sale-1" });
  });
});

describe("sendWithRetry", () => {
  it("completes on the first attempt without sleeping", async () => {
    const r = await run([done]);
    expect(r.calls).toBe(1);
    expect(r.slept).toEqual([]);
    expect(r.state).toEqual({ status: "completed", saleId: "sale-1" });
  });

  it("retries transient failures with backoff, then completes", async () => {
    const r = await run([network, new Error("boom"), done]);
    expect(r.calls).toBe(3);
    expect(r.slept).toEqual([10, 20]);
    expect(r.events.map((e) => e.type)).toEqual(["attempt", "backoff", "attempt", "backoff", "attempt", "completed"]);
    expect(r.state.status).toBe("completed");
  });

  it("stalls after the last attempt fails, without a trailing sleep", async () => {
    const r = await run([network]);
    expect(r.calls).toBe(3);
    expect(r.slept).toEqual([10, 20]);
    expect(r.final).toEqual({ type: "stalled" });
    expect(r.state).toEqual({ status: "stalled" });
  });

  it("stops at once on a business rejection", async () => {
    const r = await run([network, stock, done]);
    expect(r.calls).toBe(2);
    expect(r.state).toMatchObject({ status: "rejected", error: { code: "insufficient_stock", available: 0 } });
  });

  it("reports attempt numbers out of the total", async () => {
    const r = await run([network, done]);
    expect(r.events[0]).toEqual({ type: "attempt", attempt: 1, of: 3 });
    expect(r.events[2]).toEqual({ type: "attempt", attempt: 2, of: 3 });
  });
});

describe("pendingSaleReducer / locks", () => {
  it("never leaves completed except by reset", () => {
    const completed: PendingSaleState = { status: "completed", saleId: "s" };
    expect(pendingSaleReducer(completed, { type: "stalled" })).toBe(completed);
    expect(pendingSaleReducer(completed, { type: "reset" })).toEqual(IDLE);
  });

  it("locks the cart while sending, waiting, stalled or completed — not when idle or rejected", () => {
    const states: [PendingSaleState, boolean, boolean][] = [
      [IDLE, false, false],
      [{ status: "sending", attempt: 1, of: 3 }, true, true],
      [{ status: "waiting", attempt: 1, of: 3 }, true, true],
      [{ status: "stalled" }, true, false],
      [{ status: "rejected", error: { code: "price_changed" } }, false, false],
      [{ status: "completed", saleId: "s" }, true, false],
    ];
    for (const [state, locked, inFlight] of states) {
      expect(isLocked(state)).toBe(locked);
      expect(isInFlight(state)).toBe(inFlight);
    }
  });

  it("uses real timers by default (smoke)", async () => {
    vi.useFakeTimers();
    let n = 0;
    const p = sendWithRetry(async () => (n++ === 0 ? network : done), () => {});
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(p).resolves.toEqual({ type: "completed", saleId: "sale-1" });
    vi.useRealTimers();
  });
});
