"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The ruling (shell brief §1): four tabs, and everything else is a view of one
 * of them. Today holds everything needing a human, whatever module it came
 * from; Customers is all of them, list or board; Campaigns is set-up and
 * results; Diary is the week. A fifth top-level destination is a defect.
 *
 * Only Today carries a badge — it is the one tab where a number means "things
 * needing you", and a badge on anything else teaches the office to ignore
 * badges.
 */
const TABS = [
  { key: "today", label: "Today", href: "/crm/today" },
  { key: "customers", label: "Customers", href: "/crm/customers" },
  { key: "campaigns", label: "Campaigns", href: "/crm/campaigns" },
  { key: "diary", label: "Diary", href: "/crm/diary" },
] as const;

/** Routes that live under a tab without carrying its path. */
const TAB_OF: Array<[prefix: string, tab: string]> = [
  ["/crm/today", "today"],
  ["/crm/customers", "customers"],
  ["/crm/pipeline", "customers"],
  ["/crm/campaigns", "campaigns"],
  ["/crm/segments", "campaigns"],
  ["/crm/sources", "campaigns"],
  ["/crm/diary", "diary"],
];

export default function CrmTabs({ initialCount }: { initialCount: number }) {
  const path = usePathname();
  const [count, setCount] = useState(initialCount);

  // The layout renders once per hard load; the badge must not freeze there.
  // On every route change, ask the same evaluator again through the badge
  // route — one number, cheap, and never a second implementation of the queue.
  useEffect(() => {
    let gone = false;
    fetch("/crm/api/badge")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!gone && d && typeof d.count === "number") setCount(d.count); })
      .catch(() => {});
    return () => { gone = true; };
  }, [path]);

  const active = TAB_OF.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1]
    ?? (path === "/crm" ? "today" : null);

  return (
    <div className="tabs" role="tablist" aria-label="CRM sections">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} className="tab" role="tab" aria-selected={active === t.key}>
          {t.label}
          {t.key === "today" && count > 0 && <span className="badge">{count}</span>}
        </Link>
      ))}
    </div>
  );
}
