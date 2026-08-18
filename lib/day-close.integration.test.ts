/**
 * Day-close integration test (MP-40) — exercises the real `record_day_close`
 * RPC against the remote Supabase, end to end, to prove what the pure module
 * can't: expected drawer cash is computed **server-side** as the business-wide
 * Float + that day's **cash** Payments at the Shop (a split Sale's MoMo half
 * is excluded), the stored Over/short is declared − expected, a duplicate
 * (Shop, day) is rejected, a close declared after the Shop's next Sale is
 * recorded but marked **stale**, authorization mirrors `complete_sale` (Owner
 * anywhere, Cashier own Shop only), the declarer can never read a close back
 * (Owner-only RLS — success response, no readback), and **selling is never
 * blocked** by a missing or existing close. The pure unit tests live in
 * `day-close.test.ts`.
 *
 * Seeds its own throwaway Shops, Item, stock, a Cashier (the declarer) and an
 * Owner, and pins the business-wide Float for the duration (restored after —
 * it's the singleton `shop_settings` row). Kept out of the default `npm test`;
 * run with `npm run test:integration`. Skips itself when the Supabase env is
 * absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ready = Boolean(url && anonKey && serviceKey);

const FLOAT = 20_000; // GH₵ 200 pinned for the test run

/** UTC `YYYY-MM-DD`, shifted by `days` — the Ghana business day (GMT). */
function dayKey(days = 0): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

describe.skipIf(!ready)("record_day_close RPC (remote integration)", () => {
  const uniq = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`).replace(/-/g, "").slice(0, 10);

  let admin: SupabaseClient;
  let cashier: SupabaseClient;
  let owner: SupabaseClient;
  let shopId: string;
  let otherShopId: string;
  let itemId: string;
  let cashierId: string;
  let ownerId: string;
  let hadSettingsRow = false;
  let previousFloat: number | null = null;

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: shops, error: shopErr } = await admin
      .from("shops")
      .insert([{ name: `ITEST Close Shop ${uniq}` }, { name: `ITEST Close Other ${uniq}` }])
      .select("id, name");
    if (shopErr) throw shopErr;
    shopId = (shops.find((s) => s.name.includes("Close Shop")) as { id: string }).id;
    otherShopId = (shops.find((s) => s.name.includes("Close Other")) as { id: string }).id;

    const { data: item, error: itemErr } = await admin
      .from("items")
      .insert({ category: "wig", name: `ITEST Close Wig ${uniq}`, price_pesewas: 10_000, cost_pesewas: 4_000 })
      .select("id")
      .single();
    if (itemErr) throw itemErr;
    itemId = item.id as string;

    const { error: stockErr } = await admin
      .from("shop_stock")
      .insert({ item_id: itemId, shop_id: shopId, quantity: 50 });
    if (stockErr) throw stockErr;

    // Pin the business-wide Float (the singleton settings row) — remembered
    // and restored in afterAll, since it's shared state on the remote.
    const { data: settingsRow } = await admin
      .from("shop_settings")
      .select("float_pesewas")
      .eq("id", true)
      .maybeSingle();
    hadSettingsRow = settingsRow !== null;
    previousFloat = (settingsRow?.float_pesewas ?? null) as number | null;
    if (hadSettingsRow) {
      const { error } = await admin.from("shop_settings").update({ float_pesewas: FLOAT }).eq("id", true);
      if (error) throw error;
    } else {
      const { error } = await admin.from("shop_settings").insert({ id: true, float_pesewas: FLOAT });
      if (error) throw error;
    }

    const cashierEmail = `itest_close_cashier_${uniq}@example.com`;
    const ownerEmail = `itest_close_owner_${uniq}@example.com`;
    const password = `Itest!${uniq}aA9`;

    const { data: cashierUser, error: cashierErr } = await admin.auth.admin.createUser({
      email: cashierEmail,
      password,
      email_confirm: true,
      user_metadata: { role: "cashier", shop_id: shopId, full_name: `ITEST Declarer ${uniq}` },
    });
    if (cashierErr) throw cashierErr;
    cashierId = cashierUser.user.id;

    const { data: ownerUser, error: ownerErr } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: { role: "owner", full_name: `ITEST Owner ${uniq}` },
    });
    if (ownerErr) throw ownerErr;
    ownerId = ownerUser.user.id;

    cashier = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    owner = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: cashierSignIn } = await cashier.auth.signInWithPassword({
      email: cashierEmail,
      password,
    });
    if (cashierSignIn) throw cashierSignIn;
    const { error: ownerSignIn } = await owner.auth.signInWithPassword({
      email: ownerEmail,
      password,
    });
    if (ownerSignIn) throw ownerSignIn;
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
    // FK-safe order: movements (reference sales) → closes → sales (cascade
    // lines + payments) → shop_stock → item → users (cascade profiles) → shops.
    const shopIds = [shopId, otherShopId].filter(Boolean);
    if (shopIds.length > 0) {
      await best(() => admin.from("stock_movements").delete().in("shop_id", shopIds));
      await best(() => admin.from("day_closes").delete().in("shop_id", shopIds));
      await best(() => admin.from("sales").delete().in("shop_id", shopIds));
      await best(() => admin.from("shop_stock").delete().in("shop_id", shopIds));
    }
    if (itemId) await best(() => admin.from("items").delete().eq("id", itemId));
    if (cashierId) await best(() => admin.auth.admin.deleteUser(cashierId));
    if (ownerId) await best(() => admin.auth.admin.deleteUser(ownerId));
    if (shopIds.length > 0) await best(() => admin.from("shops").delete().in("id", shopIds));
    // Put the shared Float back the way we found it.
    if (hadSettingsRow) {
      await best(() =>
        admin.from("shop_settings").update({ float_pesewas: previousFloat ?? 0 }).eq("id", true),
      );
    } else {
      await best(() => admin.from("shop_settings").delete().eq("id", true));
    }
  });

  /** Ring a Sale at the seeded Shop as the Cashier. */
  async function ringSale(quantity: number, payments: { method: string; amount_pesewas: number }[]) {
    return cashier.rpc("complete_sale", {
      p_shop_id: shopId,
      p_customer: "",
      p_lines: [{ item_id: itemId, quantity }],
      p_payments: payments,
    });
  }

  async function closeRow(shop: string, date: string) {
    const { data } = await admin
      .from("day_closes")
      .select("close_date, declared_pesewas, expected_pesewas, over_short_pesewas, stale, note, actor")
      .eq("shop_id", shop)
      .eq("close_date", date)
      .single();
    return data!;
  }

  it("computes expected = Float + the day's cash payments and stores the Over/short", async () => {
    // No close exists yet, and selling proceeds regardless — a missing close
    // never blocks complete_sale (the AC's non-blocking guarantee).
    const { error: sale1Err } = await ringSale(4, [{ method: "cash", amount_pesewas: 40_000 }]);
    expect(sale1Err).toBeNull();
    // A split Sale: only its cash half belongs to the drawer.
    const { error: sale2Err } = await ringSale(2, [
      { method: "cash", amount_pesewas: 12_000 },
      { method: "momo", amount_pesewas: 8_000 },
    ]);
    expect(sale2Err).toBeNull();

    // Declared GH₵ 710 against expected Float 20 000 + cash 52 000 = 72 000.
    const { error } = await cashier.rpc("record_day_close", {
      p_shop_id: shopId,
      p_close_date: dayKey(0),
      p_declared: 71_000,
      p_note: "  two torn notes  ",
    });
    expect(error).toBeNull();

    expect(await closeRow(shopId, dayKey(0))).toEqual({
      close_date: dayKey(0),
      declared_pesewas: 71_000,
      expected_pesewas: 72_000,
      over_short_pesewas: -1_000, // short by GH₵ 10 — the skim signal
      stale: false, // today is still running; nothing rang after its end
      note: "two torn notes", // trimmed by the RPC
      actor: cashierId,
    });
  });

  it("rejects a duplicate close for the same (shop, day)", async () => {
    const { error } = await cashier.rpc("record_day_close", {
      p_shop_id: shopId,
      p_close_date: dayKey(0),
      p_declared: 72_000,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/already closed/i);
  });

  it("gives the declarer a success response but no readback — closes are Owner-only reads", async () => {
    // The Cashier's own close is invisible to them: RLS filters, no rows.
    const { data: cashierRows, error: cashierErr } = await cashier
      .from("day_closes")
      .select("declared_pesewas, expected_pesewas, over_short_pesewas")
      .eq("shop_id", shopId);
    expect(cashierErr).toBeNull();
    expect(cashierRows).toEqual([]);

    // The Owner reads the full row, Over/short included.
    const { data: ownerRows } = await owner
      .from("day_closes")
      .select("over_short_pesewas")
      .eq("shop_id", shopId);
    expect(ownerRows).toEqual([{ over_short_pesewas: -1_000 }]);

    // The one fact the close screen may ask: "is this day closed?" — own Shop
    // only for a Cashier.
    const { data: exists } = await cashier.rpc("day_close_exists", {
      p_shop_id: shopId,
      p_close_date: dayKey(0),
    });
    expect(exists).toBe(true);
    const { error: probeErr } = await cashier.rpc("day_close_exists", {
      p_shop_id: otherShopId,
      p_close_date: dayKey(0),
    });
    expect(probeErr).not.toBeNull();
    expect(probeErr!.message).toMatch(/not authorized/i);
  });

  it("marks a late close stale once the next Sale rings — and never blocks that Sale", async () => {
    // Selling continues after today's close exists: never blocked.
    const { error: saleErr } = await ringSale(1, [{ method: "cash", amount_pesewas: 10_000 }]);
    expect(saleErr).toBeNull();

    // Yesterday was never closed; today's Sales have already rung, so the
    // drawer no longer represents yesterday. The Owner (anywhere) declares it:
    // recorded, but stale. Yesterday had no Sales → expected is the Float alone.
    const { error } = await owner.rpc("record_day_close", {
      p_shop_id: shopId,
      p_close_date: dayKey(-1),
      p_declared: FLOAT,
    });
    expect(error).toBeNull();

    expect(await closeRow(shopId, dayKey(-1))).toEqual({
      close_date: dayKey(-1),
      declared_pesewas: FLOAT,
      expected_pesewas: FLOAT, // Float + no cash that day
      over_short_pesewas: 0,
      stale: true, // a later Sale had rung before the declaration
      note: null,
      actor: ownerId,
    });
  });

  it("refuses a Cashier closing another Shop (authz mirrors complete_sale)", async () => {
    const { error } = await cashier.rpc("record_day_close", {
      p_shop_id: otherShopId,
      p_close_date: dayKey(0),
      p_declared: 0,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not authorized/i);
  });

  it("rejects a close for a day that has not ended", async () => {
    const { error } = await owner.rpc("record_day_close", {
      p_shop_id: otherShopId,
      p_close_date: dayKey(1),
      p_declared: 0,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/has not ended/i);
  });
});
