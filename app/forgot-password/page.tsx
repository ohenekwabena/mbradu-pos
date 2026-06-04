import { ForgotPasswordForm } from "./forgot-form";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-screen">
      <div className="auth">
        <div className="auth-head">
          <div className="auth-mark">M</div>
          <div className="auth-wordmark">Mbradu</div>
          <div className="auth-sub">Wigs &amp; Cosmetics · POS</div>
        </div>
        <div className="card-auth">
          <ForgotPasswordForm />
        </div>
        <div className="auth-foot">Mbradu POS · Accra, Ghana</div>
      </div>
    </main>
  );
}
