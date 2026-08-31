"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Views inside the Campaigns tab. The approval queue is deliberately NOT here
 * (shell brief §2.4): approving a message is a daily task, so it surfaces in
 * Today as a work item and this rail never mentions it. Segments and lead
 * sources are set-up views — they live under Campaigns because the four
 * top-level tabs are the whole rail, and a fifth destination is a defect.
 */
export default function SubNav() {
  const path = usePathname();
  const on = (p: string) => path === p || path.startsWith(`${p}/`);
  const onCampaigns = on("/crm/campaigns") && !on("/crm/campaigns/emails");
  return (
    <div className="chips" style={{ marginBottom: 14 }}>
      <Link href="/crm/campaigns" className={`chip ${onCampaigns ? "on" : ""}`}>Campaigns</Link>
      <Link href="/crm/campaigns/emails" className={`chip ${on("/crm/campaigns/emails") ? "on" : ""}`}>Emails</Link>
      <Link href="/crm/segments" className={`chip ${on("/crm/segments") ? "on" : ""}`}>Audiences</Link>
      <Link href="/crm/sources" className={`chip ${on("/crm/sources") ? "on" : ""}`}>Lead sources</Link>
    </div>
  );
}
