"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The mockup's five tabs. A tab whose session hasn't shipped is marked SOON and
 * does not navigate — a dead link into a blank screen teaches the office not to
 * trust the tab rail.
 */
const TABS = [
  { key: "pipeline", label: "Pipeline", href: null, soon: "2.3" },
  { key: "customer", label: "Customer", href: "/crm", soon: null },
  { key: "segments", label: "Segments", href: null, soon: "2.5" },
  { key: "campaigns", label: "Campaigns", href: null, soon: "3.1" },
  { key: "sources", label: "Lead sources", href: null, soon: "2.4" },
] as const;

export default function CrmTabs() {
  const path = usePathname();
  return (
    <div className="tabs" role="tablist" aria-label="CRM sections">
      {TABS.map((t) =>
        t.href ? (
          <Link
            key={t.key}
            href={t.href}
            className="tab"
            role="tab"
            aria-selected={path === t.href || path.startsWith(`${t.href}/`)}
          >
            {t.label}
          </Link>
        ) : (
          <span key={t.key} className="tab" role="tab" aria-selected={false} aria-disabled="true">
            {t.label}<i>soon</i>
          </span>
        ),
      )}
    </div>
  );
}
