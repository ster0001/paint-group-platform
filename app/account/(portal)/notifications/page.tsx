import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { ALWAYS_SENT_NOTE, CHANNEL_LABEL, NOTIFY_CHANNELS, NOTIFY_TYPES, notifyAllowed, parseNotifyPrefs } from "@/lib/notifications/prefs";
import { saveNotificationsAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Notifications & alerts (Tom, 7 Sep 2026, item 3) — for every customer and
 * every trade account: which kinds of message reach them, and whether by
 * email, by text, or both. One grid, one Save. The marketing row is the
 * account's permission and is worded as the opt-out it is.
 */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const own = ctx.accounts.find((a) => a.email.toLowerCase() === ctx.email.toLowerCase()) ?? ctx.accounts[0] ?? null;
  const canEdit = own != null && own.email.toLowerCase() === ctx.email.toLowerCase();

  let prefs = parseNotifyPrefs(null);
  let marketingOn = true;
  let hasPhone = Boolean(own?.phone);
  const svc = createServiceClient();
  if (svc && own) {
    const { data } = await svc.from("accounts").select("notify_prefs, permit_email, permit_sms, flags, phone").eq("id", own.id).maybeSingle();
    const row = data as { notify_prefs?: unknown; permit_email?: string; permit_sms?: string; flags?: { marketing_opt_out?: boolean }; phone?: string | null } | null;
    prefs = parseNotifyPrefs(row?.notify_prefs);
    marketingOn = !(row?.flags?.marketing_opt_out === true || row?.permit_email === "declined" || row?.permit_sms === "declined");
    hasPhone = Boolean(row?.phone);
  }

  return (
    <div>
      <Link href="/account/profile" className="note" style={{ display: "inline-block", marginBottom: 10 }}>← My profile</Link>
      <h1>Notifications &amp; alerts</h1>
      <p className="sub">Choose what we send you, and how. {ALWAYS_SENT_NOTE}</p>

      {saved && (
        <div className="card" style={{ borderColor: "rgba(47,164,107,.5)" }} data-testid="notify-saved">
          <p className="sub">Saved — from now on we&rsquo;ll only send what you&rsquo;ve ticked.</p>
        </div>
      )}
      {error && (
        <div className="card" style={{ borderColor: "rgba(224,168,60,.5)" }}>
          <p className="sub">That didn&rsquo;t save — please try again.</p>
        </div>
      )}
      {!canEdit && (
        <div className="card" style={{ borderColor: "rgba(224,168,60,.5)" }}>
          <p className="sub">These settings belong to the account holder. Ask them to change what the office sends.</p>
        </div>
      )}

      <form action={saveNotificationsAction} className="card" data-testid="notify-form">
        <h3>What we send you</h3>
        {!hasPhone && <p className="note" style={{ marginTop: 6 }}>Add a mobile number on your profile to receive texts.</p>}
        <div className="notify-grid" role="table" aria-label="Notification types">
          <div className="notify-head" role="row">
            <span role="columnheader">Type</span>
            {NOTIFY_CHANNELS.map((c) => <span key={c} role="columnheader">{CHANNEL_LABEL[c]}</span>)}
          </div>
          {NOTIFY_TYPES.map((t) => (
            <div className="notify-row" role="row" key={t.key} data-testid={`notify-${t.key}`}>
              <span role="cell">
                <b>{t.label}</b>
                <small>{t.hint}</small>
              </span>
              {NOTIFY_CHANNELS.map((c) => (
                <span role="cell" key={c}>
                  <label className="notify-tick">
                    <input type="checkbox" name={`${t.key}_${c}`} defaultChecked={notifyAllowed(prefs, t.key, c)} disabled={!canEdit} aria-label={`${t.label} by ${CHANNEL_LABEL[c].toLowerCase()}`} />
                    <span>{CHANNEL_LABEL[c] === "Email" ? "Email" : "Text"}</span>
                  </label>
                </span>
              ))}
            </div>
          ))}
        </div>

        <div className="hr" />
        <h3>Offers and tips</h3>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginTop: 8 }}>
          <input type="checkbox" name="marketing" defaultChecked={marketingOn} disabled={!canEdit} style={{ marginTop: 4 }} data-testid="notify-marketing" />
          <span className="sub">
            Occasional offers, seasonal reminders and tips from {ctx.companyName || "Paint Group"}. Every one has an
            unsubscribe link; untick here to stop them all. Messages about your own jobs and invoices are not affected.
          </span>
        </label>

        {canEdit && (
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-cyan" type="submit" data-testid="notify-save">Save</button>
          </div>
        )}
      </form>
    </div>
  );
}
