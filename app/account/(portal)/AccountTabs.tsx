"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The five tabs from the approved mockup — plain words, never jargon:
// Home · My project · My colours · Money · Messages.
const TABS = [
  {
    href: "/account",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
    ),
  },
  {
    href: "/account/project",
    label: "My project",
    icon: (
      <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 15-4.5-4.5L8 19" /></svg>
    ),
  },
  {
    href: "/account/colours",
    label: "My colours",
    icon: (
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="8.5" cy="9.5" r="1.4" /><circle cx="14.5" cy="7.8" r="1.4" /><circle cx="16.5" cy="13" r="1.4" /><path d="M12 21a3.5 3.5 0 0 0 0-7h-1.4a1.8 1.8 0 0 1 0-3.6" /></svg>
    ),
  },
  {
    href: "/account/money",
    label: "Money",
    icon: (
      <svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
    ),
  },
  {
    href: "/account/messages",
    label: "Messages",
    icon: (
      <svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.9-.9L3 20l1-4.9a8.4 8.4 0 1 1 17-3.6z" /></svg>
    ),
  },
];

// The trade tab set (§6, the mockup's commercial persona): the portfolio
// replaces the single-job story; colours/documents stay reachable from
// Properties and Home. Same shell, same components — different emphasis.
const TRADE_TABS = [
  TABS[0],
  {
    href: "/account/properties",
    label: "Properties",
    icon: (
      <svg viewBox="0 0 24 24"><rect x="3" y="7" width="8" height="14" /><rect x="13" y="3" width="8" height="18" /><path d="M6 11h2M6 15h2M16 7h2M16 11h2M16 15h2" /></svg>
    ),
  },
  {
    href: "/account/new-estimate",
    label: "New estimate",
    icon: (
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
    ),
  },
  TABS[3],
  {
    href: "/account/team",
    label: "Team",
    icon: (
      <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3" /></svg>
    ),
  },
];

// A finance seat's whole portal is the money view (§5.6).
const FINANCE_TABS = [TABS[3]];

export default function AccountTabs({ trade = false, financeOnly = false }: { trade?: boolean; financeOnly?: boolean }) {
  const pathname = usePathname();
  const tabs = financeOnly ? FINANCE_TABS : trade ? TRADE_TABS : TABS;
  return (
    <nav className="tabbar" aria-label="Your account">
      {tabs.map((t) => {
        const on = t.href === "/account" ? pathname === "/account" : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
            {t.icon}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
