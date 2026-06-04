import { AppNav } from "@/components/app-nav";
import { getCurrentProfile } from "@/lib/dal";

import { signOut } from "./actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-black/10 px-4 py-3 dark:border-white/15">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold">Mbradu POS</span>
          <AppNav />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-black/55 dark:text-white/55">
            {profile.email} · {profile.role}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-black/15 px-2.5 py-1 text-xs font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
