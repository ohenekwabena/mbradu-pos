import Link from "next/link";

import { Icon } from "@/components/icon";

/**
 * Friendly "this area is for the Owner" card shown when a Cashier reaches an
 * Owner-only route (design.md §10.12). RLS is the hard boundary; this is the
 * gentle in-app treatment, not a 403 dump.
 */
export function NotOwner({
  message = "Only the Owner can open this area.",
}: {
  message?: string;
}) {
  return (
    <div
      className="card"
      style={{ maxWidth: 460, margin: "48px auto", textAlign: "center" }}
    >
      <div
        className="empty-ico"
        style={{
          margin: "8px auto 16px",
          background: "var(--grey-100)",
          color: "var(--faint)",
        }}
      >
        <Icon name="lock" />
      </div>
      <h2 className="h2">This area is for the Owner</h2>
      <p className="text-muted" style={{ margin: "8px 0 20px" }}>
        {message}
      </p>
      <Link className="btn btn-primary" href="/dashboard">
        Back to Dashboard
      </Link>
    </div>
  );
}
