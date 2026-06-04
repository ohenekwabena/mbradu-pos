import { getCurrentProfile } from "@/lib/dal";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();

  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        Signed in as {profile.email} ({profile.role}).
      </p>
    </section>
  );
}
