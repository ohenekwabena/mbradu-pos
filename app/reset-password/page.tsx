import Link from "next/link";

import { Icon } from "@/components/icon";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-form";

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="auth-screen">
      <div className="auth">
        <div className="auth-head">
          <div className="auth-mark">M</div>
          <div className="auth-wordmark">Mbradu</div>
          <div className="auth-sub">Set a new password</div>
        </div>
        <div className="card-auth">
          {user ? <ResetPasswordForm email={user.email ?? ""} /> : <InvalidLink />}
        </div>
        <div className="auth-foot">Mbradu POS · Accra, Ghana</div>
      </div>
    </main>
  );
}

function InvalidLink() {
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
      <h1 className="h3">This reset link can&apos;t be used</h1>
      <p className="text-muted caption" style={{ margin: "8px 0 20px" }}>
        The link is invalid, expired, or already used. Ask the Owner to send a
        fresh reset.
      </p>
      <Link className="btn btn-secondary btn-block" href="/login">
        Go to sign in
      </Link>
    </div>
  );
}
