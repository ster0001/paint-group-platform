import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext, getPortalJobs, portalBrandOf } from "@/lib/portal/data";
import PaintHomeLogo from "@/app/(marketing)/_components/PaintHomeLogo";
import { brandFor } from "@/lib/marketing/brand";
import { ensureMembership } from "@/lib/portal/auth";
import AccountTabs from "./AccountTabs";
import AssistantWidget from "@/app/estimate/assist/AssistantWidget";

export const dynamic = "force-dynamic";

/**
 * The signed-in portal shell: header with the call chip (the phone number
 * never hides — §7), content, tab bar (bottom on a phone, sidebar on
 * desktop via CSS alone). Anonymous visitors go to the passwordless login.
 */
export default async function PortalShellLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  // Self-heal: a verified login whose membership write hiccuped joins its
  // account on the next visit. Redirect so a FRESH request re-reads the
  // chain (same-request refetches are memoised — the WO-loop lesson).
  if (ctx.accounts.length === 0) {
    const joined = await ensureMembership(ctx.userId, ctx.email).catch(() => null);
    if (joined) redirect("/account");
  }

  const trade = ctx.accounts.some((a) => a.account_type === "trade");
  const orgName = trade ? (ctx.accounts.find((a) => a.account_type === "trade")?.name ?? null) : null;
  // Session 6: a finance seat sees money and nothing else (§5.6) — the tab
  // bar narrows here, and the pages themselves redirect too.
  let financeOnly = false;
  if (trade) {
    const { roleForAccount } = await import("@/lib/portal/approvalData");
    const tradeAccountId = ctx.accounts.find((a) => a.account_type === "trade")!.id;
    const membership = await roleForAccount(ctx.userId, tradeAccountId);
    financeOnly = membership?.role === "finance";
  }
  const initial = (ctx.firstName ?? ctx.email)[0]?.toUpperCase() ?? "?";
  // Paint Home brief §5 (⚑ P8): the header follows the account's jobs — all Paint Home → the Paint Home mark and number.
  const { brand } = portalBrandOf((await getPortalJobs(ctx.accounts.map((a) => a.id))).estimates);
  const painthome = brand === "painthome";
  const phone = painthome ? brandFor("painthome").phoneDisplay : ctx.companyPhone;

  return (
    <div className="app" data-brand={brand}>
      <header className="hdr">
        <div>
          {painthome
            ? <PaintHomeLogo variant="nav" on="light" className="brandlogo" title="Paint Home" />
            : ctx.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img className="brandlogo" src={ctx.logoUrl} alt={ctx.companyName} />
              : <div className="brand">PAINT GROUP<span className="dot">.</span></div>}
          {trade && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5 }}>
              {orgName && <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>{orgName}</span>}
              <span className="trade-tag">Trade account</span>
            </div>
          )}
        </div>
        <div className="hdr-right">
          {phone && (
            <a className="call-chip" href={`tel:${phone.replace(/\s+/g, "")}`}>
              <svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z" /></svg>
              {phone}
            </a>
          )}
          <Link href="/account/profile" className="avatar" aria-label="My profile">{initial}</Link>
        </div>
      </header>
      <AccountTabs trade={trade} financeOnly={financeOnly} />
      <main className="scroll">{children}</main>
      {/* Tom, 7 Sep: bottom-right chat — the assistant on their latest estimate, or a person. */}
      {!financeOnly && <AssistantWidget />}
    </div>
  );
}
