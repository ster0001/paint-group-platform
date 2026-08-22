"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The console's tab rail. Client-side only so the current tab can light up —
 * a rail of five identical links gives no sense of where you are, and the
 * mockup's `.on` state was already in the stylesheet with nothing setting it.
 *
 * Order is the job's own order: schedule it, work the queue, watch progress,
 * read what came back from site.
 */
const TABS = [
  { href: "/pc/schedule", label: "Schedule" },
  { href: "/pc", label: "Dashboard" },
  { href: "/pc/flow", label: "Project Progress" },
  { href: "/pc/updates", label: "Updates" },
];

export default function PcNav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Console views">
      {TABS.map((t) => {
        // "/pc" is a prefix of every other tab, so it only matches exactly.
        const on = t.href === "/pc" ? path === "/pc" : path === t.href || path.startsWith(t.href + "/");
        return (
          <Link key={t.href} href={t.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
            {t.label}
          </Link>
        );
      })}
      <Link href="/estimates">← Back to app</Link>
    </nav>
  );
}
