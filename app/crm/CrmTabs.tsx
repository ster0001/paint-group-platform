"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The mockup's five tabs. A tab whose session hasn't shipped is marked SOON and
 * does not navigate — a dead link into a blank screen teaches the office not to
 * trust the tab rail.
 */
type Tab = { key: string; label: string; href: string | null; soon: string | null };

const TABS: Tab[] = [
  { key: "pipeline", label: "Pipeline", href: "/crm/pipeline", soon: null },
  { key: "customer", label: "Customer", href: "/crm", soon: null },
  { key: "segments", label: "Segments", href: "/crm/segments", soon: null },
  { key: "campaigns", label: "Campaigns", href: "/crm/campaigns", soon: null },
  { key: "sources", label: "Lead sources", href: "/crm/sources", soon: null },
];

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
