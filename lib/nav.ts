import type { IconName } from "@/components/icon";
import type { Role } from "@/lib/auth/visibility";

/** One sidebar destination. `key` is the first path segment (drives active state). */
export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: IconName;
}

// Role-aware navigation (design.md §7). The Owner administers everything; a
// Cashier only sells and reviews their own Shop's sales.
export const OWNER_NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { key: "sell", label: "Sell", href: "/sell", icon: "sell" },
  { key: "inventory", label: "Inventory", href: "/inventory", icon: "inventory" },
  { key: "sales", label: "Sales", href: "/sales", icon: "sales" },
  { key: "shops", label: "Shops", href: "/shops", icon: "shops" },
  { key: "staff", label: "Staff", href: "/staff", icon: "staff" },
  { key: "settings", label: "Settings", href: "/settings", icon: "settings" },
];

export const CASHIER_NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { key: "sell", label: "Sell", href: "/sell", icon: "sell" },
  { key: "sales", label: "Sales", href: "/sales", icon: "sales" },
];

export function navFor(role: Role): NavItem[] {
  return role === "owner" ? OWNER_NAV : CASHIER_NAV;
}

/** Topbar title + subtitle per section. Pages with dynamic headers can override. */
export interface SectionMeta {
  title: string;
  subtitle?: string;
}

export const SECTION_META: Record<string, SectionMeta> = {
  dashboard: { title: "Dashboard", subtitle: "Your business at a glance." },
  sell: { title: "Sell", subtitle: "Ring up a sale." },
  inventory: {
    title: "Inventory",
    subtitle: "Catalog and per-shop stock.",
  },
  sales: { title: "Sales", subtitle: "Completed sales." },
  shops: {
    title: "Shops",
    subtitle:
      "Open and manage the business's shops. Catalog and prices are shared across all of them.",
  },
  staff: { title: "Staff", subtitle: "Cashiers and invitations." },
  settings: { title: "Settings", subtitle: "Business-wide settings." },
};

/** First path segment, e.g. "/inventory/items/42" → "inventory". */
export function sectionFromPath(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? "dashboard";
}
