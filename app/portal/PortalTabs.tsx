"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/portal", label: "HOME", icon: "⌂" },
  { href: "/portal/requests", label: "REQUESTS", icon: "◔" },
  { href: "/portal/jobs", label: "JOBS", icon: "▤" },
  { href: "/portal/money", label: "MONEY", icon: "$" },
  { href: "/portal/calendar", label: "CALENDAR", icon: "▦" },
];

export default function PortalTabs() {
  const path = usePathname();
  return (
    <nav className="tabs">
      {TABS.map((t) => {
        // "/portal" must only light up on the dashboard itself, not every child.
        const active = t.href === "/portal" ? path === "/portal" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={active ? "on" : ""}>
            <i aria-hidden>{t.icon}</i>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
