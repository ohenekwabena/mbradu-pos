// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SellView, type SellItem } from "./sell-view";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

type RpcResult = { data: unknown; error: { message: string; details?: string } | null };
const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => { abortSignal: () => Promise<RpcResult> }>();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

/** Script the RPC's answers, one per call (the last repeats). */
function answers(...results: RpcResult[]) {
  let i = 0;
  rpc.mockImplementation(() => ({
    abortSignal: () => Promise.resolve(results[Math.min(i++, results.length - 1)]),
  }));
}

const WIG: SellItem = { id: "item-wig", category: "wig", name: "Bone Straight 16in", subline: "", price: 45_000, stock: 2 };

function setup() {
  render(<SellView shopId="shop-1" shopName="Osu" items={[WIG]} lowThreshold={1} />);
  fireEvent.click(screen.getAllByRole("button", { name: `Add ${WIG.name}` })[0]);
}
const completeButton = () => screen.getByRole("button", { name: /complete sale|completing|retrying|connection slow/i });
const sentSaleIds = () => rpc.mock.calls.map(([, args]) => args.p_sale_id);

beforeEach(() => {
  rpc.mockReset();
  push.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SellView — sending a Sale on a flaky connection", () => {
  it("sends one direct RPC with a fresh Sale id and the displayed total, then opens the receipt", async () => {
    answers({ data: "sale-123", error: null });
    setup();
    await act(async () => fireEvent.click(completeButton()));

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("complete_sale");
    expect(args).toMatchObject({
      p_shop_id: "shop-1",
      p_lines: [{ item_id: WIG.id, quantity: 1 }],
      p_payments: [{ method: "cash", amount_pesewas: 45_000 }],
      p_expected_total: 45_000,
    });
    expect(args.p_sale_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/sales\/sale-123\?tendered=45000$/));
  });

  it("retries network failures under the same id, then offers Retry, which resends that id", async () => {
    answers({ data: null, error: { message: "TypeError: Failed to fetch" } });
    setup();
    await act(async () => fireEvent.click(completeButton()));
    // The cart is frozen while the Sale is pending.
    expect(screen.getByRole("button", { name: `Add ${WIG.name}` })).toBeDisabled();

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status")).toHaveTextContent(/still sending/i);
    expect(screen.getByRole("button", { name: `Add ${WIG.name}` })).toBeDisabled();

    answers({ data: "sale-9", error: null });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    expect(new Set(sentSaleIds()).size).toBe(1); // every attempt carried the same id
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/sales/sale-9"));
  });

  it("stops on a business rejection, explains it, and unlocks the cart (same id kept)", async () => {
    answers({
      data: null,
      error: { message: "insufficient_stock", details: JSON.stringify({ item_id: WIG.id, available: 0 }) },
    });
    setup();
    await act(async () => fireEvent.click(completeButton()));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(`“${WIG.name}” is out of stock at this shop`);
    expect(screen.getByRole("button", { name: `Add ${WIG.name}` })).not.toBeDisabled();
    expect(push).not.toHaveBeenCalled();

    answers({ data: "sale-2", error: null });
    await act(async () => fireEvent.click(completeButton()));
    expect(new Set(sentSaleIds()).size).toBe(1);
  });

  it("never shows raw database text", async () => {
    answers({ data: null, error: { message: "payment_mismatch", details: "{}" } });
    setup();
    await act(async () => fireEvent.click(completeButton()));
    const alert = screen.getByRole("alert");
    expect(alert).not.toHaveTextContent("payment_mismatch");
    expect(alert).toHaveTextContent(/don’t add up/);
  });
});
