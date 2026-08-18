import type { StockTakeStatus } from "@/lib/stock-take";

/** Display meta for a take's lifecycle status, shared by the history list and
 * detail. `cancelled` covers both a counter abandoning an open session and the
 * Owner rejecting a submitted one — either way nothing posted. */
export const TAKE_STATUS_META: Record<StockTakeStatus, { label: string; chip: string }> = {
  open: { label: "In progress", chip: "chip-accent" },
  submitted: { label: "Awaiting review", chip: "chip-warning" },
  approved: { label: "Approved", chip: "chip-success" },
  cancelled: { label: "Cancelled", chip: "chip-neutral" },
};

/** `formatDay` for the history surfaces (mirrors the review screen's). */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
