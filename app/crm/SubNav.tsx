"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Campaigns and emails are different things and the office thinks of them
 * differently: an email is written once, a campaign decides who gets it and
 * when. Two links rather than a sixth top-level tab, so the mockup's five
 * stay five.
 */
export default function SubNav() {
  const path = usePathname();
  const onEmails = path.startsWith("/crm/campaigns/emails");
  return (
    <div className="chips" style={{ marginBottom: 14 }}>
      <Link href="/crm/campaigns" className={`chip ${onEmails ? "" : "on"}`}>Campaigns</Link>
      <Link href="/crm/campaigns/emails" className={`chip ${onEmails ? "on" : ""}`}>Emails</Link>
    </div>
  );
}
