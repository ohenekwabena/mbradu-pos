import { notFound } from "next/navigation";

import { getCurrentProfile } from "@/lib/dal";
import { format } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

import { ReceiptActions } from "./receipt-actions";

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  momo: "MoMo",
  card: "Card",
  transfer: "Transfer",
};

/**
 * A completed sale's receipt — the immutable, printable record (design — Receipt).
 * Server-rendered from the sale, its line items, payments, and Shop; readable by
 * the Owner (any Shop) or the Cashier whose Shop it is (RLS). The cash tendered
 * isn't stored (only the payment, which equals the total), so the change line is
 * driven by an optional `?tendered=` carried over from completion. Re-visiting the
 * permalink later simply omits the change line. MP-22.
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
  const hasCash = payments.some((p) => p.method === "cash");
  const tenderedPesewas = tendered !== undefined && /^\d+$/.test(tendered) ? Number(tendered) : null;
  const change =
    hasCash && tenderedPesewas !== null ? Math.max(0, tenderedPesewas - total) : null;

  const created = new Date(sale.created_at as string);
  const dateText = created.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const timeText = created.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const sellerName = (seller?.full_name as string | null) ?? null;
  const customerName = (sale.customer_name as string | null) ?? null;

  return (
    <div className="receipt-wrap">
      <ReceiptActions />

      <div className="receipt print-root">
        <div className="r-head">
          <div className="r-mark">M</div>
          <div className="h3">Mbradu</div>
          <div className="r-shop">
            <strong style={{ color: "var(--ink)", fontWeight: 600 }}>{(shop?.name as string) ?? "Shop"}</strong>
            {shop?.address ? (
              <>
                <br />
                {shop.address as string}
              </>
            ) : null}
            {shop?.phone ? (
              <>
                <br />
                {shop.phone as string}
              </>
            ) : null}
          </div>
        </div>

        <div className="r-meta">
          <div>
            {dateText}
            <br />
            {timeText}
          </div>
          <div style={{ textAlign: "right" }}>
            {sellerName ? (
              <>
                Served by: {sellerName}
                {customerName ? <br /> : null}
              </>
            ) : null}
            {customerName ? <>Customer: {customerName}</> : null}
          </div>
        </div>

        {lines.map((line) => (
          <div key={line.id} className="r-line">
            <div className="qn">
              <div className="nm">{line.name}</div>
              <div className="up tnum">
                {line.quantity} × {format(line.unitPrice)}
              </div>
            </div>
            <div className="lt tnum">{format(line.unitPrice * line.quantity)}</div>
          </div>
        ))}

        <div className="r-total">
          <span className="body-med">Total</span>
          <span className="tv">{format(total)}</span>
        </div>

        <div style={{ marginTop: 10 }}>
          {payments.map((payment) => (
            <div key={payment.id} className="r-pay">
              <span className="text-muted">{METHOD_LABEL[payment.method] ?? payment.method}</span>
              <span className="tnum">{format(payment.amount)}</span>
            </div>
          ))}
          {change !== null && (
            <div className="r-pay">
              <span className="text-muted">Change due</span>
              <span className="tnum">{format(change)}</span>
            </div>
          )}
        </div>

        <div className="r-foot">
          No returns or exchanges · Prices include all charges
          <br />
          Thank you for shopping with Mbradu
        </div>
      </div>
    </div>
  );
}
