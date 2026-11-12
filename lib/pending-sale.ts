/**
 * The **pending Sale** on a flaky connection (ADR-0008, GitHub #28).
 *
 * A checkout becomes a Sale only when the server confirms it. Until then it is
 * pending: the cart is locked, the phone resends the same Sale id (so a retry can
 * never book it twice — `complete_sale` is idempotent on that id), and the
 * outcome is one of:
 *   - **completed** — the server confirmed the Sale (first time or on a replay);
 *   - **rejected**  — a definitive business error (a stable code). Nothing was
 *     written for this id, so the cart unlocks for the cashier to fix;
 *   - **stalled**   — automatic retries ran out with no answer. The outcome is
 *     unknown, so the cart stays locked and only *Retry* (same id) is offered.
 *
 * Only one pending Sale exists at a time; there is no queue of unsent Sales.
 * Pure — the reducer and the retry driver are unit-tested with fakes.
 */

import { parseSaleError, type RpcErrorLike, type SaleError } from "./sale-errors";

/** Backoff before each automatic retry; attempts = delays + 1. */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];
/** Give up on one attempt after this long (mobile data can hang, not fail). */
export const ATTEMPT_TIMEOUT_MS = 15_000;

export type PendingSaleState =
  | { status: "idle" }
  | { status: "sending"; attempt: number; of: number }
  | { status: "waiting"; attempt: number; of: number }
  | { status: "stalled" }
  | { status: "rejected"; error: SaleError }
  | { status: "completed"; saleId: string };

export type PendingSaleEvent =
  | { type: "attempt"; attempt: number; of: number }
  | { type: "backoff"; attempt: number; of: number }
  | { type: "stalled" }
  | { type: "rejected"; error: SaleError }
  | { type: "completed"; saleId: string }
  | { type: "reset" };

export const IDLE: PendingSaleState = { status: "idle" };

export function pendingSaleReducer(state: PendingSaleState, event: PendingSaleEvent): PendingSaleState {
  // A confirmed Sale is final: nothing but an explicit reset (a new checkout)
  // moves it on — a late duplicate answer can't flip it.
  if (state.status === "completed" && event.type !== "reset") return state;

  switch (event.type) {
    case "attempt":
      return { status: "sending", attempt: event.attempt, of: event.of };
    case "backoff":
      return { status: "waiting", attempt: event.attempt, of: event.of };
    case "stalled":
      return { status: "stalled" };
    case "rejected":
      return { status: "rejected", error: event.error };
    case "completed":
      return { status: "completed", saleId: event.saleId };
    case "reset":
      return IDLE;
  }
}

/** Whether the cart must stay frozen: a Sale is in flight, unresolved, or done. */
export function isLocked(state: PendingSaleState): boolean {
  return state.status === "sending" || state.status === "waiting" || state.status === "stalled" || state.status === "completed";
}

/** Whether a send loop is running right now (Complete/Retry must be inert). */
export function isInFlight(state: PendingSaleState): boolean {
  return state.status === "sending" || state.status === "waiting";
}

/** One attempt's raw outcome: the RPC's data or its error. */
export type AttemptResult = { ok: true; saleId: string } | { ok: false; error: RpcErrorLike | null };

/**
 * Classify an attempt: a confirmed Sale, a definitive business rejection (a
 * known stable code — retrying can't help), or **transient** (network failure,
 * timeout, unexpected server error — safe to retry because the id is idempotent).
 */
export function classifyAttempt(
  result: AttemptResult,
): { kind: "completed"; saleId: string } | { kind: "rejected"; error: SaleError } | { kind: "transient" } {
  if (result.ok) return { kind: "completed", saleId: result.saleId };
  const error = parseSaleError(result.error);
  return error.code === "unexpected" ? { kind: "transient" } : { kind: "rejected", error };
}

/**
 * Drive one send cycle: attempt, and on a transient failure back off and retry
 * with the **same** call (same Sale id), up to `delays.length + 1` attempts.
 * Dispatches every transition and resolves with the final state's event. A
 * thrown attempt counts as transient.
 */
export async function sendWithRetry(
  attempt: () => Promise<AttemptResult>,
  dispatch: (event: PendingSaleEvent) => void,
  { delays = RETRY_DELAYS_MS, sleep = defaultSleep }: { delays?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<PendingSaleEvent> {
  const of = delays.length + 1;
  for (let n = 1; n <= of; n++) {
    dispatch({ type: "attempt", attempt: n, of });

    let result: AttemptResult;
    try {
      result = await attempt();
    } catch {
      result = { ok: false, error: null };
    }

    const outcome = classifyAttempt(result);
    if (outcome.kind === "completed") {
      const event: PendingSaleEvent = { type: "completed", saleId: outcome.saleId };
      dispatch(event);
      return event;
    }
    if (outcome.kind === "rejected") {
      const event: PendingSaleEvent = { type: "rejected", error: outcome.error };
      dispatch(event);
      return event;
    }
    if (n < of) {
      dispatch({ type: "backoff", attempt: n, of });
      await sleep(delays[n - 1]);
    }
  }
  const event: PendingSaleEvent = { type: "stalled" };
  dispatch(event);
  return event;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
