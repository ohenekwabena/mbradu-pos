"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/icon";
import { navFor, sectionFromPath } from "@/lib/nav";
import type { Role } from "@/lib/auth/visibility";

/** The 76px icon rail: brand mark, role-aware nav, and an account marker. */
export function Sidebar({
  role,
  accountTip,
}: {
  role: Role;
  accountTip: string;
}) {
  const active = sectionFromPath(usePathname());
  const nav = navFor(role);

  return (
    <aside className="sidebar">
      <Link className="brand-mark" href="/dashboard" aria-label="Mbradu home">
        M
      </Link>
      <div className="nav-list">
        {nav.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-label={item.label}
            className={`nav-item${item.key === active ? " active" : ""}`}
            aria-current={item.key === active ? "page" : undefined}
          >
            <Icon name={item.icon} />
            <span className="tip">{item.label}</span>
          </Link>
        ))}
      </div>
      <div className="nav-spacer" />
      <div className="nav-item" aria-label={accountTip} title={accountTip}>
        <Icon name="account" />
        <span className="tip">{accountTip}</span>
      </div>
    </aside>
  );
}
