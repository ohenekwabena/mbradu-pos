/**
 * Sale-write integration test (MP-22, split payments MP-23) — exercises the real
 * `complete_sale` RPC against the remote Supabase, end to end, to prove what the
 * Sale-builder can't on its own: the write is **atomic**, it **can't oversell**,
 * and a **split payment** lands as one row per method summing to the total. The
 * pure unit tests live in `sale.test.ts`; this one needs a live database because
 * those properties are enforced in PL/pgSQL under a row lock.
 *
 * It seeds its own throwaway Shop, Item, stock, and a Cashier bound to that Shop
 * (via the service-role key, bypassing RLS), then calls the RPC **as that signed-
 * in Cashier** — the RPC derives `auth.uid()` for the seller and authorizes the
 * Shop, so it must run with a real session, not the service role. Everything is
 * cleaned up afterwards.
 *
 * Kept out of the default `npm test` (it touches the shared remote DB); run with
 * `npm run test:integration`. Skips itself when the Supabase env isn't present.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ready = Boolean(url && anonKey && serviceKey);

describe.skipIf(!ready)("complete_sale RPC (remote integration)", () => {
  const PRICE = 15_000; // GH₵150.00
  const PRICE2 = 9_000; // GH₵90.00
  const START_QTY = 5;
  const uniq = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`).replace(/-/g, "").slice(0, 10);
  const email = `itest_${uniq}@example.com`;
  const password = `Itest!${uniq}aA9`;

  let admin: SupabaseClient;
  let cashier: SupabaseClient;
  let shopId: string;
  let itemId: string; // carried + stocked at the Shop
  let uncarriedItemId: string; // exists in the catalog but not stocked here
  let userId: string;

  beforeAll(async () => {
    // Clients are created here (not at module/suite top level) so a skipped run
    // — missing env — never constructs a client or touches the network.
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: shop, error: shopErr } = await admin
      .from("shops")
      .insert({ name: `ITEST Shop ${uniq}` })
      .select("id")
      .single();
    if (shopErr) throw shopErr;
    shopId = shop.id as string;

    const { data: items, error: itemErr } = await admin
      .from("items")
      .insert([
        { category: "wig", name: `ITEST Wig ${uniq}`, price_pesewas: PRICE, cost_pesewas: 5_000 },
        { category: "wig", name: `ITEST Uncarried ${uniq}`, price_pesewas: PRICE2, cost_pesewas: 4_000 },
      ])
      .select("id, name");
    if (itemErr) throw itemErr;
    itemId = (items.find((i) => i.name.includes("Wig")) as { id: string }).id;
    uncarriedItemId = (items.find((i) => i.name.includes("Uncarried")) as { id: string }).id;

    const { error: stockErr } = await admin
      .from("shop_stock")
      .insert({ item_id: itemId, shop_id: shopId, quantity: START_QTY });
    if (stockErr) throw stockErr;

    // The trigger builds the profile from this metadata (role + shop_id), which
    // satisfies the cashier-must-have-a-shop CHECK.
    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: "cashier", shop_id: shopId, full_name: `ITEST Cashier ${uniq}` },
    });
    if (userErr) throw userErr;
    userId = created.user.id;

    cashier = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInErr } = await cashier.auth.signInWithPassword({ email, password });
    if (signInErr) throw signInErr;
  });

  afterAll(async () => {
    if (!admin) return;
    const best = async (run: () => PromiseLike<unknown>) => {
      try {
        await run();
      } catch {
        /* best-effort cleanup */
      }
    };
    // FK-safe order: movements (reference sales) → sales (cascades line items +
    // payments) → shop_stock → items → user (cascades the profile, freeing
    // profiles.shop_id) → shop.
    if (shopId) {
      await best(() => admin.from("stock_movements").delete().eq("shop_id", shopId));
      await best(() => admin.from("sales").delete().eq("shop_id", shopId));
      await best(() => admin.from("shop_stock").delete().eq("shop_id", shopId));
    }
    await best(() => admin.from("items").delete().in("id", [itemId, uncarriedItemId].filter(Boolean)));
    if (userId) await best(() => admin.auth.admin.deleteUser(userId));
    if (shopId) await best(() => admin.from("shops").delete().eq("id", shopId));
  });

  async function stockQty(): Promise<number> {
    const { data } = await admin
      .from("shop_stock")
      .select("quantity")
      .eq("item_id", itemId)
      .eq("shop_id", shopId)
      .single();
    return data!.quantity as number;
  }
  async function salesCount(): Promise<number> {
    const { count } = await admin
      .from("sales")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId);
    return count ?? 0;
  }

  it("completes a cash sale: writes it atomically and decrements the Shop's stock", async () => {
    expect(await stockQty()).toBe(START_QTY);

    const { data: saleId, error } = await cashier.rpc("complete_sale", {
      p_shop_id: shopId,
      p_customer: "ITEST Customer",
      p_lines: [{ item_id: itemId, quantity: 2 }],
      p_payments: [{ method: "cash", amount_pesewas: 2 * PRICE }],
    });
    expect(error).toBeNull();
    expect(typeof saleId).toBe("string");

    // Stock down by exactly the quantity sold.
    expect(await stockQty()).toBe(START_QTY - 2);

    // The Sale — total computed server-side, seller = the signed-in Cashier.
    const { data: sale } = await admin
      .from("sales")
      .select("shop_id, seller, customer_name, total_pesewas")
      .eq("id", saleId)
      .single();
    expect(sale).toMatchObject({
      shop_id: shopId,
      seller: userId,
      customer_name: "ITEST Customer",
      total_pesewas: 2 * PRICE,
    });

    // One line item at the catalog price, one Sale movement, one cash payment.
    const { data: lines } = await admin
      .from("sale_line_items")
      .select("item_id, quantity, unit_price_pesewas")
      .eq("sale_id", saleId);
    expect(lines).toEqual([{ item_id: itemId, quantity: 2, unit_price_pesewas: PRICE }]);

    const { data: movements } = await admin
      .from("stock_movements")
      .select("reason, amount, sale_id")
      .eq("sale_id", saleId);
    expect(movements).toEqual([{ reason: "sale", amount: -2, sale_id: saleId }]);

    const { data: payments } = await admin
      .from("payments")
      .select("method, amount_pesewas")
      .eq("sale_id", saleId);
    expect(payments).toEqual([{ method: "cash", amount_pesewas: 2 * PRICE }]);
  });

  it("blocks overselling and rolls the whole transaction back (atomicity)", async () => {
    const before = await stockQty();
    const salesBefore = await salesCount();

    const { error } = await cashier.rpc("complete_sale", {
      p_shop_id: shopId,
      p_customer: "",
      p_lines: [{ item_id: itemId, quantity: before + 100 }],
      p_payments: [{ method: "cash", amount_pesewas: (before + 100) * PRICE }],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/insufficient stock/i);

    // Nothing moved: stock unchanged and no Sale row written.
    expect(await stockQty()).toBe(before);
    expect(await salesCount()).toBe(salesBefore);
  });

  it("rejects selling an Item the Shop doesn't carry", async () => {
    const salesBefore = await salesCount();

    const { error } = await cashier.rpc("complete_sale", {
      p_shop_id: shopId,
      p_customer: "",
      p_lines: [{ item_id: uncarriedItemId, quantity: 1 }],
      p_payments: [{ method: "cash", amount_pesewas: PRICE2 }],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not carried/i);
    expect(await salesCount()).toBe(salesBefore);
  });

  it("rejects a payment set that doesn't sum to the total", async () => {
    const before = await stockQty();

    const { error } = await cashier.rpc("complete_sale", {
      p_shop_id: shopId,
      p_customer: "",
      p_lines: [{ item_id: itemId, quantity: 1 }],
      p_payments: [{ method: "cash", amount_pesewas: PRICE - 100 }],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/do not sum/i);
    expect(await stockQty()).toBe(before);
  });

  it("records a split payment as one row per method, summing to the total (MP-23)", async () => {
    const before = await stockQty();
    const cashPart = 5_000;
    const momoPart = PRICE - cashPart; // one unit at PRICE, settled part cash / part MoMo

    const { data: saleId, error } = await cashier.rpc("complete_sale", {
      p_shop_id: shopId,
      p_customer: "ITEST Split",
      p_lines: [{ item_id: itemId, quantity: 1 }],
      p_payments: [
        { method: "momo", amount_pesewas: momoPart },
        { method: "cash", amount_pesewas: cashPart },
      ],
    });
    expect(error).toBeNull();
    expect(typeof saleId).toBe("string");

    // Stock down by exactly one; total is the sum of the split.
    expect(await stockQty()).toBe(before - 1);
    const { data: sale } = await admin.from("sales").select("total_pesewas").eq("id", saleId).single();
    expect(sale!.total_pesewas).toBe(PRICE);

    // Both methods persisted, one row each (ordered here for a stable assertion).
    const { data: payments } = await admin
      .from("payments")
      .select("method, amount_pesewas")
      .eq("sale_id", saleId)
      .order("method");
    expect(payments).toEqual([
      { method: "cash", amount_pesewas: cashPart },
      { method: "momo", amount_pesewas: momoPart },
    ]);
  });
});
