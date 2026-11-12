import { notFound } from "next/navigation";

import { Receipt } from "@/components/receipt";
import { getCurrentProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

import { ReceiptActions } from "./receipt-actions";

/**
 * A completed sale's receipt — the immutable, printable record (design — Receipt).
 * Server-rendered from the sale, its line items, payments, and Shop; readable by
 * the Owner (any Shop) or the Cashier whose Shop it is (RLS). The cash tendered
 * isn't stored (only the payments, which sum to the total), so the change line is
 * driven by an optional `?tendered=` carried over from completion and computed
 * against the cash portion. Re-visiting the permalink later simply omits the
 * change line. Payments may be split across methods (MP-23). MP-22.
 */
export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tendered?: string }>;
}) {
  const { id } = await params;
  const { tendered } = await searchParams;
  await getCurrentProfile(); // require auth; RLS scopes which sales are visible

  const supabase = await createClient();
  const { data: sale } = await supabase
    .from("sales")
    .select("id, shop_id, seller, customer_name, total_pesewas, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!sale) notFound();

  const [{ data: lineRows }, { data: payRows }, { data: shop }, { data: seller }] = await Promise.all([
    supabase
      .from("sale_line_items")
      .select("id, item_id, quantity, unit_price_pesewas")
      .eq("sale_id", id),
    supabase.from("payments").select("id, method, amount_pesewas").eq("sale_id", id),
    supabase.from("shops").select("name, address, phone").eq("id", sale.shop_id).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", sale.seller).maybeSingle(),
  ]);

  // Resolve line-item names from the catalog (immutable receipt still shows the
  // current display name; the price is captured at sale time on the line).
  const itemIds = [...new Set((lineRows ?? []).map((r) => r.item_id as string))];
  const { data: itemRows } = await supabase.from("items_catalog").select("id, name").in("id", itemIds);
  const nameById = new Map((itemRows ?? []).map((r) => [r.id as string, r.name as string]));

  const lines = (lineRows ?? []).map((r) => ({
    id: r.id as string,
    name: nameById.get(r.item_id as string) ?? "Item",
    quantity: r.quantity as number,
    unitPrice: r.unit_price_pesewas as number,
  }));
  const payments = (payRows ?? []).map((r) => ({
    id: r.id as string,
    method: r.method as string,
    amount: r.amount_pesewas as number,
  }));

  const total = sale.total_pesewas as number;
  // Change is the over-tender on the cash portion only (tendered − cash charged);
  // for a cash-only sale the cash payment equals the total, so this also covers
  // the simple case. A fully cashless sale shows no change line.
  const cashPayment = payments.find((p) => p.method === "cash");
  const tenderedPesewas = tendered !== undefined && /^\d+$/.test(tendered) ? Number(tendered) : null;
  const change =
    cashPayment && tenderedPesewas !== null ? Math.max(0, tenderedPesewas - cashPayment.amount) : null;

  return (
    <div className="receipt-wrap">
      <ReceiptActions />
      <Receipt
        data={{
          shop: {
            name: (shop?.name as string) ?? "Shop",
            address: (shop?.address as string | null) ?? null,
            phone: (shop?.phone as string | null) ?? null,
          },
          createdAt: new Date(sale.created_at as string),
          sellerName: (seller?.full_name as string | null) ?? null,
          customerName: (sale.customer_name as string | null) ?? null,
          lines: lines.map((line) => ({ ...line, key: line.id })),
          total,
          payments: payments.map((payment) => ({ ...payment, key: payment.id })),
          change,
        }}
      />
    </div>
  );
}
