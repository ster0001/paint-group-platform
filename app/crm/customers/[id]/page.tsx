import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildTimeline } from "@/lib/crm/timeline";
import CustomerPanel from "../../CustomerPanel";

export const dynamic = "force-dynamic";

const money = (c: number | null | undefined) =>
  c == null ? "—" : "$" + Math.round(c / 100).toLocaleString("en-AU");

const initials = (name: string, email: string) => {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
};

const daysSince = (iso: string | null) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;

type AccountRow = {
  id: string; name: string | null; email: string; phone: string | null; account_type: string;
  temperature: string | null; snoozed_until: string | null;
  followup_due_at: string | null; followup_note: string | null;
};

/**
 * THE customer record (§4.1). Every work item, search result and board card
 * opens this same route — one record, many routes in. No module gets its own
 * variant of a customer page.
 */
export default async function CustomerRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const columns = "id, name, email, phone, account_type, temperature, snoozed_until, followup_due_at, followup_note";
  const { data: account } = await supabase.from("accounts").select(columns).eq("id", id).maybeSingle();
  if (!account) {
    return (
      <>
        <Link className="back" href="/crm/customers">← Customers</Link>
        <p className="empty">That customer isn&rsquo;t here any more.</p>
      </>
    );
  }
  const a = account as AccountRow;

  const [{ data: events }, { data: estimates }, { data: props }] = await Promise.all([
    supabase.from("crm_events")
      .select("id, type, payload, occurred_at, source")
      .eq("account_id", id).order("occurred_at", { ascending: false }).limit(200),
    supabase.from("estimates")
      .select("id, title, status, total_cents, created_at").eq("account_id", id)
      .order("created_at", { ascending: false }).limit(20),
    supabase.from("properties").select("address, suburb, state, postcode").eq("account_id", id).limit(5),
  ]);

  const timeline = buildTimeline((events ?? []) as Parameters<typeof buildTimeline>[0]);
  const est = (estimates ?? []) as Array<{ status: string; total_cents: number | null; created_at: string }>;
  const latest = est[0] ?? null;
  const property = (props ?? [])[0] as { address?: string; suburb?: string; state?: string; postcode?: string } | undefined;
  const address = property
    ? [property.address, property.suburb, property.state, property.postcode].filter(Boolean).join(" ")
    : "";

  return (
    <>
      <Link className="back" href="/crm/customers">← Customers</Link>

      <div className="head">
        <span className="avatar">{initials(a.name ?? "", a.email)}</span>
        <span>
          <span className="hname">{a.name || a.email}</span>
          <span className="haddr">
            {[address, a.account_type === "trade" ? "Trade" : "Residential",
              `${est.length} estimate${est.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
          </span>
        </span>
      </div>

      <div className="stats">
        <div className="stat">
          <span>Latest estimate</span>
          <b>{money(latest?.total_cents)}</b>
          <em>{latest ? latest.status : "none yet"}</em>
        </div>
        <div className="stat">
          <span>Since it was sent</span>
          <b>{latest ? `${daysSince(latest.created_at)}d` : "—"}</b>
          <em>{latest ? "worked out from the record" : "nothing to chase"}</em>
        </div>
        <div className="stat">
          <span>Temperature</span>
          <b>{a.temperature ? a.temperature[0].toUpperCase() + a.temperature.slice(1) : "Not set"}</b>
          <em>{a.snoozed_until && new Date(a.snoozed_until) > new Date()
            ? `snoozed to ${new Date(a.snoozed_until).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`
            : "yours to set"}</em>
        </div>
        <div className="stat">
          <span>Next touch</span>
          <b>{a.followup_due_at
            ? new Date(a.followup_due_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
            : "—"}</b>
          <em>{a.followup_note || (a.followup_due_at ? "no note with it" : "no reminder set")}</em>
        </div>
      </div>

      <CustomerPanel accountId={a.id} temperature={a.temperature} />

      <p className="plabel" style={{ marginTop: 22 }}>Everything, in order</p>
      {timeline.length === 0 ? (
        <p className="empty">
          Nothing logged yet. Anything you record above appears here, newest first —
          and so does everything the system does for this customer from now on.
        </p>
      ) : (
        <div className="tl">
          {timeline.map((row) => (
            <div key={row.id} className={`ev ${row.kind}`}>
              <i className="pip" aria-hidden="true" />
              <span>
                <span className="evhead">
                  <span className="evlabel">{row.label}</span>
                  <Stamp iso={row.occurredAt} />
                </span>
                {row.detail && <span className="evdetail">{row.detail}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Rendered on the server, so the timeline's clock is Melbourne's, not the
 *  visitor's laptop's. */
function Stamp({ iso }: { iso: string }) {
  const d = new Date(iso);
  const text = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return <span className="evwhen">{text}</span>;
}
