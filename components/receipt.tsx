import { BrandLogo } from "@/components/brand-logo";
import { format } from "@/lib/money";

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  momo: "MoMo",
  card: "Card",
  transfer: "Transfer",
};

/** Everything a printed receipt shows — independent of where it came from (the
 * stored Sale on `/sales/[id]`, or the confirmed checkout on the Sell screen). */
export interface ReceiptData {
  shop: { name: string; address?: string | null; phone?: string | null };
  createdAt: Date;
  sellerName: string | null;
  customerName: string | null;
  lines: { key: string; name: string; quantity: number; unitPrice: number }[];
  total: number;
  payments: { key: string; method: string; amount: number }[];
  /** Change on the cash portion, or `null` to omit the line. */
  change: number | null;
}

/**
 * The receipt card (design — Receipt): the immutable, printable rendering of a
 * Sale. Presentational only — shared by the receipt page and the Sell screen's
 * inline receipt (ADR-0008, #29) so the two can't drift. `.print-root` is what the
 * print stylesheet keeps.
 */
export function Receipt({ data }: { data: ReceiptData }) {
  const { shop, createdAt, sellerName, customerName, lines, total, payments, change } = data;
  const dateText = createdAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const timeText = createdAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="receipt print-root">
      <div className="r-head">
        <div className="r-mark">
          <BrandLogo size={56} />
        </div>
        <div className="h3">Mbradu</div>
        <div className="r-shop">
          <strong style={{ color: "var(--ink)", fontWeight: 600 }}>{shop.name}</strong>
          {shop.address ? (
            <>
              <br />
              {shop.address}
            </>
          ) : null}
          {shop.phone ? (
            <>
              <br />
              {shop.phone}
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
        <div key={line.key} className="r-line">
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
          <div key={payment.key} className="r-pay">
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
  );
}
