// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { format } from "@/lib/money";

import { SellView, STOCK_REFRESH_MS, type SellItem } from "./sell-view";

type RpcResult = { data: unknown; error: { message: string; details?: string } | null };
const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => { abortSignal: () => Promise<RpcResult> }>();
// The stock refresh reads `from("shop_stock").select(...).eq("shop_id", …)`.
type StockRows = { item_id: string; quantity: number }[];
let stockRows: StockRows = [];
const stockRead = vi.fn(() => Promise.resolve({ data: stockRows, error: null }));
const from = vi.fn(() => ({ select: () => ({ eq: stockRead }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc, from }) }));

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
  stockRead.mockClear();
  from.mockClear();
  stockRows = [];
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
      error: { message: "not_carried", details: JSON.stringify({ item_id: WIG.id }) },
    });
    setup();
    await act(async () => fireEvent.click(completeButton()));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(`“${WIG.name}” isn’t stocked at this shop`);
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

describe("SellView — confirming a changed price (#30)", () => {
  const priceChanged: RpcResult = {
    data: null,
    error: {
      message: "price_changed",
      details: JSON.stringify({
        total_pesewas: 50_000,
        expected_pesewas: 45_000,
        prices: [{ item_id: WIG.id, price_pesewas: 50_000 }],
      }),
    },
  };

  it("shows old → new and the new total; confirming resends the same Sale at the new total", async () => {
    answers(priceChanged);
    setup();
    await act(async () => fireEvent.click(completeButton()));

    const dialog = screen.getByRole("dialog", { name: "Prices changed" });
    expect(within(dialog).getByText(WIG.name)).toBeInTheDocument();
    expect(within(dialog).getByText(format(45_000))).toBeInTheDocument(); // old, struck through
    expect(within(dialog).getAllByText(format(50_000)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).toBeNull(); // the dialog explains it

    answers({ data: "sale-7", error: null });
    await act(async () =>
      fireEvent.click(within(dialog).getByRole("button", { name: `Charge ${format(50_000)}` })),
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    const [, first] = rpc.mock.calls[0];
    const [, second] = rpc.mock.calls[1];
    expect(second.p_sale_id).toBe(first.p_sale_id);
    expect(second).toMatchObject({
      p_expected_total: 50_000,
      p_payments: [{ method: "cash", amount_pesewas: 50_000 }],
    });
    expect(document.querySelector(".receipt")).not.toBeNull();
  });

  it("Back to cart writes nothing and leaves the new price on screen", async () => {
    answers(priceChanged);
    setup();
    await act(async () => fireEvent.click(completeButton()));
    fireEvent.click(screen.getByRole("button", { name: "Back to cart" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByText(`${format(50_000)} ea`)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/total is now/);
  });

  it("a split payment goes back to the cart to rebalance instead of resending", async () => {
    answers(priceChanged);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "MoMo" }));
    fireEvent.change(screen.getByLabelText("Cash"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("MoMo"), { target: { value: "250" } });
    await act(async () => fireEvent.click(completeButton()));

    fireEvent.click(screen.getByRole("button", { name: "Adjust payments" }));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(completeButton()).toBeDisabled(); // GH₵450 no longer balances GH₵500
  });
});

describe("SellView — background stock refresh and clamping (#31)", () => {
  const SOLD_OUT: SellItem = { ...WIG, stock: 0 };
  function renderWith(items: SellItem[]) {
    render(
      <SellView shopId="shop-1" shopName="Osu" receiptShop={{ name: "Osu" }} sellerName={null} items={items} lowThreshold={0} />,
    );
  }

  it("picks up an Owner restock on the timer: out of stock becomes sellable", async () => {
    stockRows = [{ item_id: WIG.id, quantity: 5 }];
    renderWith([SOLD_OUT]);
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Add ${WIG.name}` })).toBeDisabled();

    await act(async () => vi.advanceTimersByTimeAsync(STOCK_REFRESH_MS));
    expect(from).toHaveBeenCalledWith("shop_stock");
    expect(stockRead).toHaveBeenCalledWith("shop_id", "shop-1");
    expect(screen.getByText("5 left")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Add ${WIG.name}` })).not.toBeDisabled();
  });

  it("is paused while the tab is hidden and refreshes when it comes back", async () => {
    stockRows = [{ item_id: WIG.id, quantity: 5 }];
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderWith([SOLD_OUT]);
    await act(async () => vi.advanceTimersByTimeAsync(STOCK_REFRESH_MS * 2));
    expect(stockRead).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(stockRead).toHaveBeenCalledTimes(1);
    expect(screen.getByText("5 left")).toBeInTheDocument();
    visibility.mockRestore();
  });

  it("doesn't refresh while a Sale is pending, and a failed refresh is silent", async () => {
    rpc.mockImplementation(() => ({ abortSignal: () => new Promise<RpcResult>(() => {}) })); // never answers
    renderWith([WIG]);
    addWig();
    await act(async () => fireEvent.click(completeButton()));
    await act(async () => vi.advanceTimersByTimeAsync(STOCK_REFRESH_MS));
    expect(stockRead).not.toHaveBeenCalled();
    cleanup();

    stockRead.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    renderWith([WIG]);
    addWig();
    await act(async () => vi.advanceTimersByTimeAsync(STOCK_REFRESH_MS));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText(WIG.name).length).toBeGreaterThan(1); // still in the cart
  });

  it("insufficient_stock clamps the cart to what's left, says so, and re-reads the Shop", async () => {
    stockRows = [{ item_id: WIG.id, quantity: 1 }];
    answers({
      data: null,
      error: { message: "insufficient_stock", details: JSON.stringify({ item_id: WIG.id, available: 1 }) },
    });
    renderWith([WIG]);
    addWig();
    addWig(); // 2 in the cart; the server says only 1 is left
    await act(async () => fireEvent.click(completeButton()));

    expect(screen.getByRole("alert")).toHaveTextContent(`Only 1 of “${WIG.name}” left at this shop — the cart has been updated`);
    expect(screen.getByText("1 left")).toBeInTheDocument();
    expect(document.querySelector(".stepper .val")).toHaveTextContent("1");
    expect(stockRead).toHaveBeenCalledTimes(1);

    // The clamped cart completes under the same Sale id.
    answers({ data: "sale-3", error: null });
    await act(async () => fireEvent.click(completeButton()));
    const [, retried] = rpc.mock.calls[1];
    expect(retried).toMatchObject({ p_lines: [{ item_id: WIG.id, quantity: 1 }], p_expected_total: 45_000 });
    expect(retried.p_sale_id).toBe(rpc.mock.calls[0][1].p_sale_id);
  });

  it("drops a line that has sold out entirely", async () => {
    answers({
      data: null,
      error: { message: "insufficient_stock", details: JSON.stringify({ item_id: WIG.id, available: 0 }) },
    });
    renderWith([WIG]);
    addWig();
    await act(async () => fireEvent.click(completeButton()));
    expect(screen.getByRole("alert")).toHaveTextContent(/out of stock at this shop — it’s been taken out of the cart/);
    expect(screen.getByText("Search to add items to the sale.")).toBeInTheDocument();
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
  });
});
