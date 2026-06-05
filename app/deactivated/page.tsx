import { Icon } from "@/components/icon";
import { signOut } from "@/lib/actions/shell";

/**
 * The locked-out screen a deactivated Cashier lands on. `getCurrentProfile`
 * (lib/dal) redirects every authenticated request from a deactivated account
 * here. The proxy lets an authenticated visitor reach it — it isn't a public
 * auth path, so it isn't bounced to /dashboard, and the account is still
 * technically signed in. Deliberately standalone (outside the app shell) so it
 * never re-runs the deactivation redirect on itself. The only way forward is to
 * sign out, which clears the dead session so /login is reachable again; the
 * login front door then refuses a deactivated account a fresh code. MP-30.
 */
export default function DeactivatedPage() {
  return (
    <main className="auth-screen">
      <div className="auth">
        <div className="auth-head">
          <div className="auth-mark">M</div>
          <div className="auth-wordmark">Mbradu</div>
          <div className="auth-sub">Wigs &amp; Cosmetics · POS</div>
        </div>
        <div className="card-auth" style={{ textAlign: "center" }}>
          <div className="empty-ico" style={{ margin: "4px auto 16px" }}>
            <Icon name="ban" />
          </div>
          <h1 className="h2" style={{ marginBottom: 8 }}>
            Your account has been deactivated
          </h1>
          <p className="text-muted" style={{ margin: "0 0 20px" }}>
            You no longer have access to this POS. If you think this is a
            mistake, contact the shop owner to have your access restored.
          </p>
          <form action={signOut}>
            <button type="submit" className="btn btn-primary btn-block">
              Return to sign in
            </button>
          </form>
        </div>
        <div className="auth-foot">Mbradu POS · Accra, Ghana</div>
      </div>
    </main>
  );
}
