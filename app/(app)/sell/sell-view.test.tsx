// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { format } from "@/lib/money";

import { deductSold, SellView, type SellItem } from "./sell-view";

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

function renderView() {
  render(
    <SellView
      shopId="shop-1"
      shopName="Osu"
      receiptShop={{ name: "Osu", address: "Oxford St", phone: null }}
      sellerName="Ama"
      items={[WIG]}
      lowThreshold={0}
    />,
  );
}
const addWig = () => fireEvent.click(screen.getByRole("button", { name: `Add ${WIG.name}` }));
function setup() {
  renderView();
  addWig();
}
const completeButton = () => screen.getByRole("button", { name: /complete sale|completing|retrying|connection slow/i });
const sentSaleIds = () => rpc.mock.calls.map(([, args]) => args.p_sale_id);

beforeEach(() => {
  rpc.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SellView — sending a Sale on a flaky connection", () => {
  it("sends one direct RPC with a fresh Sale id and the displayed total", async () => {
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
    expect(screen.getByRole("link", { name: "Open receipt" })).toHaveAttribute("href", expect.stringContaining("/sales/sale-9"));
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

describe("SellView — inline receipt and the next Sale (#29)", () => {
  it("shows the receipt in place, with the permanent link carrying the cash tendered", async () => {
    answers({ data: "sale-123", error: null });
    setup();
    fireEvent.change(screen.getByLabelText("Tendered"), { target: { value: "500" } });
    await act(async () => fireEvent.click(completeButton()));

    const receipt = document.querySelector(".receipt") as HTMLElement;
    expect(receipt).not.toBeNull();
    const r = within(receipt);
    expect(r.getByText(WIG.name)).toBeInTheDocument();
    expect(r.getByText("Oxford St")).toBeInTheDocument();
    expect(r.getByText(/Served by: Ama/)).toBeInTheDocument();
    expect(r.getAllByText(format(45_000)).length).toBeGreaterThan(0);
    expect(r.getByText("Change due").nextSibling).toHaveTextContent(format(5_000));
    expect(screen.getByRole("link", { name: "Open receipt" })).toHaveAttribute("href", "/sales/sale-123?tendered=50000");
    expect(screen.getByRole("button", { name: /Print receipt/ })).toBeInTheDocument();
  });

  it("New sale starts fresh with no network request, stock deducted, and a new Sale id", async () => {
    answers({ data: "sale-1", error: null });
    setup();
    await act(async () => fireEvent.click(completeButton()));
    expect(rpc).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "New sale" }));
    expect(rpc).toHaveBeenCalledTimes(1); // no request to start the next Sale
    expect(document.querySelector(".receipt")).toBeNull();
    expect(screen.getByText("1 left")).toBeInTheDocument(); // 2 on hand − 1 sold
    expect(screen.getByText("Search to add items to the sale.")).toBeInTheDocument();

    // Sell the last one; then the Item reads out of stock and can't be added.
    answers({ data: "sale-2", error: null });
    addWig();
    await act(async () => fireEvent.click(completeButton()));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(sentSaleIds()[0]).not.toBe(sentSaleIds()[1]);
    fireEvent.click(screen.getByRole("button", { name: "New sale" }));
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Add ${WIG.name}` })).toBeDisabled();
  });
});

describe("deductSold", () => {
  it("takes sold quantities off matching Items, merging duplicates and flooring at 0", () => {
    const items: SellItem[] = [WIG, { ...WIG, id: "other", stock: 4 }];
    expect(
      deductSold(items, [
        { item_id: WIG.id, quantity: 1 },
        { item_id: WIG.id, quantity: 5 },
      ]).map((i) => i.stock),
    ).toEqual([0, 4]);
  });
});
