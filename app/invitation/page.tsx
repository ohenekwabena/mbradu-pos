import Link from "next/link";

import { Icon } from "@/components/icon";
import { createClient } from "@/lib/supabase/server";

import { InvitationForm } from "./invitation-form";

/**
 * Token-gated invitation sign-up (§10.2, MP-28). A freshly-invited Cashier opens
 * `/invitation?token=…` from their email; the public, SECURITY DEFINER
 * `invitation_for_token` RPC resolves the invited email + Shop for a pending,
 * unexpired token WITHOUT exposing the invitations table. A valid token shows the
 * set-a-password form (bound to the Shop on the server); anything else — missing,
 * invalid, expired, or already-used — shows the "can't be used" card. The page is
 * public by design, so it lives outside the authenticated `(app)` group.
 */
export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const invite = token ? await lookupInvitation(token) : null;

  return (
    <main className="auth-screen">
      <div className="auth">
        <div className="auth-head">
          <div className="auth-mark">M</div>
          <div className="auth-wordmark">Mbradu</div>
          <div className="auth-sub">
            {invite ? "You've been invited to join" : "Invitation"}
          </div>
        </div>
        <div className="card-auth">
          {invite ? (
            <InvitationForm
              token={token!}
              email={invite.email}
              shopName={invite.shopName}
            />
          ) : (
            <InvalidInvitation />
          )}
        </div>
        <div className="auth-foot">Mbradu POS · Accra, Ghana</div>
      </div>
    </main>
  );
}

/**
 * Resolve a pending, unexpired invitation by exact token via the public RPC, as
 * the invited email + Shop name to show. Returns null for any non-usable token
 * (the RPC yields no row) so the page falls back to the invalid card. Uses the
 * ordinary (anon-capable) server client — the RPC is granted to anon, and the
 * caller here is unauthenticated.
 */
async function lookupInvitation(
  token: string,
): Promise<{ email: string; shopName: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invitation_for_token", {
    p_token: token,
  });
  const rows = (data ?? []) as Array<{ email: string; shop_name: string }>;
  if (error || rows.length === 0) return null;
  return { email: rows[0].email, shopName: rows[0].shop_name };
}

function InvalidInvitation() {
  return (
    <div style={{ textAlign: "center", padding: "8px 0" }}>
      <div
        className="empty-ico"
        style={{
          margin: "0 auto 14px",
          background: "var(--danger-tint)",
          color: "var(--danger)",
        }}
      >
        <Icon name="alert" />
      </div>
      <h1 className="h3">This invitation can&apos;t be used</h1>
      <p className="text-muted caption" style={{ margin: "8px 0 20px" }}>
        The link is invalid, expired, or already used. Ask the Owner to send you
        a fresh invitation.
      </p>
      <Link className="btn btn-secondary btn-block" href="/login">
        Go to sign in
      </Link>
    </div>
  );
}
