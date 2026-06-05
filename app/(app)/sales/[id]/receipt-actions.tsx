"use client";

import Link from "next/link";

import { Icon } from "@/components/icon";

/**
 * The receipt's screen-only action bar: start a new sale, or print. Hidden from
 * the printed output (`.receipt-actions` is dropped by the print stylesheet).
 * Print is client-only (`window.print()`); the receipt content itself is
 * server-rendered and immutable. MP-22.
 */
export function ReceiptActions() {
  return (
    <div className="receipt-actions no-print">
      <Link className="btn btn-secondary" href="/sell">
        New sale
      </Link>
      <button type="button" className="btn btn-primary" onClick={() => window.print()}>
        <Icon name="print" /> Print receipt
      </button>
    </div>
  );
}
