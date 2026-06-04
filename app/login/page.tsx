import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-black/10 p-6 shadow-sm dark:border-white/15">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Mbradu Wigs &amp; Cosmetics</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Sign in to the point of sale.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
