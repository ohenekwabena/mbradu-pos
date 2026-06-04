import Link from "next/link";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/sell", label: "Sell" },
  { href: "/inventory", label: "Inventory" },
] as const;

export function AppNav() {
  return (
    <nav aria-label="Primary" className="flex items-center gap-1">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-black/70 hover:bg-black/5 hover:text-foreground dark:text-white/70 dark:hover:bg-white/10"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
