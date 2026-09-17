"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PainterCapabilities } from "@/lib/painters/capabilities";

type Tab = {
  href: string;
  label: string;
  icon: string;
  /** Which capability the tab needs. Omitted = every painter. */
  needs?: keyof PainterCapabilities;
  /** A capability that HIDES the tab (the other type's version of the same route). */
  unless?: keyof PainterCapabilities;
};

const TABS: Tab[] = [
  { href: "/portal", label: "HOME", icon: "⌂" },
  // Offers are a contractor thing (ruling 1); the employee's assignments
  // land in Session 3.
  { href: "/portal/requests", label: "REQUESTS", icon: "◔", needs: "acceptsOffers" },
  { href: "/portal/jobs", label: "JOBS", icon: "▤" },
  // The money tab: a contractor's self-invoicing, an employee's EXPENSES
  // (ruling 4, Session 5). Same route, the page branches on capability.
  { href: "/portal/money", label: "INVOICING", icon: "$", needs: "canSelfInvoice" },
  { href: "/portal/money", label: "EXPENSES", icon: "🧾", needs: "canClaimExpenses", unless: "canSelfInvoice" },
  { href: "/portal/calendar", label: "CALENDAR", icon: "▦" },
  // Help centre (brief Phase C): the painter's own manuals, in the portal.
  { href: "/portal/help", label: "HELP", icon: "?" },
];

/**
 * The tab bar, filtered by the painter's capabilities. The filter is a
 * convenience for the thumb, not the control: every route it hides also
 * refuses the painter server-side (notFound) — hiding a tab never hid data.
 */
export default function PortalTabs({ capabilities }: { capabilities: PainterCapabilities }) {
  const path = usePathname();
  return (
    <nav className="tabs">
      {TABS.filter((t) => (!t.needs || capabilities[t.needs]) && !(t.unless && capabilities[t.unless])).map((t) => {
        // "/portal" must only light up on the dashboard itself, not every child.
        const active = t.href === "/portal" ? path === "/portal" : path.startsWith(t.href);
        return (
          <Link key={t.label} href={t.href} className={active ? "on" : ""}>
            <i aria-hidden>{t.icon}</i>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
