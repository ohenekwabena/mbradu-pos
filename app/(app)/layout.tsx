import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { getCurrentProfile } from "@/lib/dal";
import { ALL_SHOPS } from "@/lib/shop-context";
import { readShopScope } from "@/lib/shop-context-server";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  // Shop-context data for the shell. The Owner gets the full Shop list + their
  // active scope (cookie); a Cashier gets only their fixed Shop's name.
  let shops: { id: string; name: string }[] = [];
  let scope = ALL_SHOPS;
  let activeShopName: string | null = null;
  let cashierShopName: string | null = null;

  if (profile.role === "owner") {
    const { data } = await supabase.from("shops").select("id, name").order("name");
    shops = data ?? [];
    scope = await readShopScope();
    if (scope !== ALL_SHOPS && !shops.some((s) => s.id === scope)) {
      scope = ALL_SHOPS; // stale/forged cookie → all shops
    }
    activeShopName =
      scope === ALL_SHOPS ? null : (shops.find((s) => s.id === scope)?.name ?? null);
  } else if (profile.shopId) {
    const { data } = await supabase
      .from("shops")
      .select("name")
      .eq("id", profile.shopId)
      .maybeSingle();
    cashierShopName = data?.name ?? null;
  }

  const name = profile.fullName ?? profile.email ?? "Account";
  const roleLabel = profile.role === "owner" ? "Owner" : "Cashier";
  const account = {
    name,
    roleLabel,
    shopLabel: profile.role === "cashier" ? cashierShopName : null,
    initial: (name.trim()[0] ?? "?").toUpperCase(),
  };

  return (
    <div className="app">
      <Sidebar role={profile.role} accountTip={`${name} (${roleLabel})`} />
      <div className="main">
        <TopBar
          role={profile.role}
          shops={shops}
          scope={scope}
          activeShopName={activeShopName}
          cashierShopName={cashierShopName}
          account={account}
        />
        <main className="content" id="page">
          {children}
        </main>
      </div>
    </div>
  );
}
