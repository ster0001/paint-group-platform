import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildTimeline } from "@/lib/crm/timeline";
import { LANES } from "@/lib/crm/stage";
import { refreshAccountFacts } from "@/lib/crm/facts";
import { reportError } from "@/lib/monitoring/report";
import CustomerPanel from "../../CustomerPanel";
import RecordDetails, { type StaffOption } from "./RecordDetails";
import Contacts, { type ContactRow } from "./Contacts";
import DuplicateBanner, { type DuplicateHit } from "./DuplicateBanner";
import Messages, { type MessageRow } from "./Messages";
import StatusPanel, { type TagOption } from "./StatusPanel";
import VisitPanel from "./VisitPanel";
import { loadStaffAvailability, VISIT_COLUMNS } from "@/lib/visits/book";
import type { VisitRow } from "@/lib/visits/types";
import { melbourneDate } from "@/lib/workorder/console";
import { LOST_REASONS, STATE_LABEL, delayEnded, type PermitChannel, type PermitValue, type RelationshipState } from "@/lib/crm/states";
import { invoiceBalanceCents, invoiceIsOverdue, type DeriveInvoice, type DerivePayment } from "@/lib/invoicing/derive";
import { OPEN_STATUSES } from "@/lib/invoicing/stateMachine";
import { CONSENT_HOW_LABEL, CONSENT_LABEL, parseConsents, type ConsentKind } from "@/lib/accounts/consent";
import { CHANNEL_LABEL, NOTIFY_TYPES, parseNotifyPrefs, switchedOff } from "@/lib/notifications/prefs";

export const dynamic = "force-dynamic";

const money = (c: number | null | undefined) =>
  c == null ? "—" : "$" + Math.round(c / 100).toLocaleString("en-AU");

const initials = (name: string) => {
  const parts = (name || "?").trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
};

const daysSince = (iso: string | null | undefined) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;

const shortDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", year: "2-digit" }).format(new Date(iso)) : "—";

type AccountRow = {
  id: string; name: string | null; email: string | null; phone: string | null; account_type: string;
  temperature: string | null; snoozed_until: string | null; followup_due_at: string | null; followup_note: string | null;
  owner_id: string | null;
  relationship_state: RelationshipState; state_until: string | null; state_note: string | null; state_reason: string | null; lost_reason: string | null;
  permit_email: PermitValue; permit_sms: PermitValue; permit_phone: PermitValue; permit_meta: Record<string, { how?: string; at?: string }> | null; tags: string[] | null;
  consents: unknown; notify_prefs: unknown;
};
type FactsRow = {
  stage: string; because: string; opened_count: number; last_opened_at: string | null; quote_at: string | null;
  last_contact_at: string | null; last_contact_channel: string | null; won_cents: number | null; open_value_cents: number | null;
  estimates_count: number; stale: boolean;
};
type EstimateRow = { id: string; title: string | null; status: string; total_cents: number | null; created_at: string; sent_at: string | null; viewed_at: string | null; accepted_at: string | null; valid_until: string | null };
type WoRow = { id: string; estimate_id: string; wo_ref: string | null; stage: string | null; start_date: string | null; end_date: string | null };
type InvoiceRow = { id: string; estimate_id: string | null; number: string | null; status: string; total_inc_cents: number | null; due_on: string | null; issued_on: string | null; kind: string | null };

const STATUS_PILL: Record<string, string> = { sent: "cy", accepted: "gr", declined: "rd", expired: "am", draft: "gy" };
const WO_LABEL: Record<string, string> = {
  offered: "Offered", pre_start: "Booked", in_progress: "In progress", qa: "Quality check", completion_prep: "Wrapping up", walkthrough: "Walkthrough", closed: "Done",
};

/**
 * THE customer record (§4.1). Every work item, search result and board card
 * opens this same route — one record, many routes in. No module gets its own
 * variant of a customer page.
 *
 * P2: the head shows and edits the contact details; the status line is the
 * cached card; every estimate, job, invoice, property and contact is on the
 * page; the panel logs in one tap and takes real dates.
 */
export default async function CustomerRecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string; found?: string }> }) {
  const { id } = await params;
  const flags = await searchParams;
  const supabase = await createClient();

  const { data: account } = await supabase.from("accounts")
    .select("id, name, email, phone, account_type, temperature, snoozed_until, followup_due_at, followup_note, owner_id, relationship_state, state_until, state_note, state_reason, lost_reason, permit_email, permit_sms, permit_phone, permit_meta, tags, consents, notify_prefs")
    .eq("id", id).maybeSingle();
  if (!account) {
    return (
      <>
        <Link className="back" href="/crm/customers">← Customers</Link>
        <p className="empty">That customer isn&rsquo;t here any more.</p>
      </>
    );
  }
  const a = account as AccountRow;

  const [{ data: events }, { data: estimates }, { data: props }, { data: contacts }, factsRead, { data: staffRows }, dupRead, { data: messages }, { data: tagRows }] = await Promise.all([
    supabase.from("crm_events")
      .select("id, type, payload, occurred_at, source")
      .eq("account_id", id).order("occurred_at", { ascending: false }).limit(200),
    supabase.from("estimates")
      .select("id, title, status, total_cents, created_at, sent_at, viewed_at, accepted_at, valid_until").eq("account_id", id)
      .order("created_at", { ascending: false }).limit(50),
    supabase.from("properties").select("id, address, suburb, state, postcode").eq("account_id", id).order("created_at", { ascending: true }).limit(20),
    supabase.from("account_contacts").select("id, name, role, email, phone, preferred_channel, is_primary, notes").eq("account_id", id).order("is_primary", { ascending: false }).order("created_at", { ascending: true }),
    supabase.from("crm_account_facts").select("stage, because, opened_count, last_opened_at, quote_at, last_contact_at, last_contact_channel, won_cents, open_value_cents, estimates_count, stale").eq("account_id", id).maybeSingle(),
    supabase.from("profiles").select("id, name").eq("role", "staff").order("name", { ascending: true }).limit(50),
    supabase.rpc("crm_duplicate_candidates", { p_limit: 5, p_account: id }),
    supabase.from("messages").select("id, channel, direction, subject, body, provider, status, status_at, read_at, occurred_at, to_address, from_address, meta")
      .eq("account_id", id).order("occurred_at", { ascending: false }).limit(100),
    supabase.from("crm_tags").select("key, label").order("sort_order").order("label"),
  ]);

  // The card is a cache; a stale one is recomputed before it is shown.
  let facts = (factsRead.data ?? null) as FactsRow | null;
  if (!facts || facts.stale) {
    await refreshAccountFacts(supabase, [id]).catch((e) => reportError(e, { where: "record.refreshFacts", bestEffort: true, extra: { id } }));
    // A DIFFERENT select shape from the first read — Next memoises a
    // byte-identical fetch within one request and would hand back the stale row.
    const again = await supabase.from("crm_account_facts").select("stage, because, opened_count, last_opened_at, quote_at, last_contact_at, last_contact_channel, won_cents, open_value_cents, estimates_count, stale, refreshed_at").eq("account_id", id).maybeSingle();
    facts = (again.data ?? facts) as FactsRow | null;
  }

  const est = (estimates ?? []) as EstimateRow[];
  // P6: the account's visits and who can take one.
  const [{ data: visitRows }, staffAvail] = await Promise.all([
    supabase.from("visits").select(VISIT_COLUMNS).eq("account_id", id).order("starts_at", { ascending: false }).limit(20),
    loadStaffAvailability(supabase),
  ]);
  const estIds = est.map((e) => e.id);
  const [{ data: wos }, { data: invoices }] = await Promise.all([
    estIds.length ? supabase.from("work_orders").select("id, estimate_id, wo_ref, stage, start_date, end_date").in("estimate_id", estIds).order("start_date", { ascending: false, nullsFirst: false }).limit(50) : Promise.resolve({ data: [] }),
    supabase.from("invoices").select("id, estimate_id, number, status, total_inc_cents, due_on, issued_on, kind").or(`account_id.eq.${id}${estIds.length ? `,estimate_id.in.(${estIds.join(",")})` : ""}`).order("created_at", { ascending: false }).limit(50),
  ]);
  // Item 13: overdue and "deposit unpaid" need the payments — the one rule the
  // invoicing dashboard uses (lib/invoicing/derive), never a second one here.
  const invRows = (invoices ?? []) as InvoiceRow[];
  const { data: payRows } = invRows.length
    ? await supabase.from("payments").select("invoice_id, amount_cents, status, paid_on").in("invoice_id", invRows.map((i) => i.id))
    : { data: [] as Array<{ invoice_id: string; amount_cents: number; status: string; paid_on: string | null }> };
  const payments: DerivePayment[] = ((payRows ?? []) as Array<{ invoice_id: string; amount_cents: number; status: string; paid_on: string | null }>)
    .map((p) => ({ invoiceId: p.invoice_id, amountCents: p.amount_cents, status: p.status, paidOn: p.paid_on }));
  const todayIso = melbourneDate(new Date());
  const toDerive = (i: InvoiceRow): DeriveInvoice => ({
    id: i.id, estimateId: i.estimate_id ?? "", kind: (i.kind ?? "standalone") as DeriveInvoice["kind"], status: i.status as DeriveInvoice["status"],
    totalIncCents: i.total_inc_cents ?? 0, dueOn: i.due_on, issuedOn: i.issued_on,
  });
  const invoiceFlags = (i: InvoiceRow): { overdue: boolean; depositUnpaid: boolean; balanceCents: number; daysLate: number } => {
    const d = toDerive(i);
    const open = (OPEN_STATUSES as readonly string[]).includes(i.status);
    const balance = open ? invoiceBalanceCents(d, payments) : 0;
    const overdue = open && invoiceIsOverdue(d, payments, todayIso);
    const daysLate = overdue && i.due_on ? Math.max(0, Math.round((Date.parse(todayIso + "T00:00:00Z") - Date.parse(i.due_on + "T00:00:00Z")) / 86_400_000)) : 0;
    return { overdue, depositUnpaid: i.kind === "deposit" && open && balance > 0, balanceCents: balance, daysLate };
  };
  const lateInvoices = invRows.filter((i) => invoiceFlags(i).overdue);
  const unpaidDeposits = invRows.filter((i) => invoiceFlags(i).depositUnpaid);

  // Names for the duplicate banner.
  const dupRows = ((dupRead.error ? [] : dupRead.data) ?? []) as Array<{ account_a: string; account_b: string; reason: string }>;
  const otherIds = [...new Set(dupRows.map((d) => (d.account_a === id ? d.account_b : d.account_a)))];
  const { data: others } = otherIds.length ? await supabase.from("accounts").select("id, name, email, phone").in("id", otherIds) : { data: [] };
  const otherName = new Map(((others ?? []) as Array<{ id: string; name: string | null; email: string | null; phone: string | null }>).map((o) => [o.id, o.name || o.email || o.phone || "Unnamed"]));
  const hits: DuplicateHit[] = [];
  for (const d of dupRows) {
    const other = d.account_a === id ? d.account_b : d.account_a;
    if (hits.some((h) => h.otherId === other)) continue;
    hits.push({ otherId: other, otherName: otherName.get(other) ?? "Another record", reason: d.reason });
  }

  const timeline = buildTimeline((events ?? []) as Parameters<typeof buildTimeline>[0]);
  const latest = est[0] ?? null;
  const staff = ((staffRows ?? []) as Array<{ id: string; name: string | null }>).map((s) => ({ id: s.id, name: s.name || "Staff" })) as StaffOption[];
  const ownerName = staff.find((s) => s.id === a.owner_id)?.name ?? null;
  const laneLabel = LANES.find((l) => l.key === facts?.stage)?.label ?? "";
  const snoozeLive = a.snoozed_until != null && new Date(a.snoozed_until) > new Date();
  const name = a.name || a.email || a.phone || "Unnamed";
  const woOf = new Map<string, WoRow[]>();
  for (const w of (wos ?? []) as WoRow[]) { const l = woOf.get(w.estimate_id) ?? []; l.push(w); woOf.set(w.estimate_id, l); }

  return (
    <>
      <Link className="back" href="/crm/customers">← Customers</Link>
      {flags.new && <p className="said" data-testid="flash">New customer added.</p>}
      {flags.found && <p className="said" data-testid="flash">Already a customer — this is their record.</p>}

      <DuplicateBanner keepId={a.id} hits={hits} />

      {/* Tom, 7 Sep (item 7, clarified): the status block — stage, why, opened
          count, owner — sits in the TOP RIGHT of the screen beside the name,
          in large plain text. Stacks under the name on a phone. */}
      <div className="rtop">
      <RecordDetails account={a} staff={staff} initials={initials(name)} />

      {(() => {
        const consents = parseConsents(a.consents);
        const off = switchedOff(parseNotifyPrefs(a.notify_prefs));
        const hold = a.relationship_state !== "active";
        const bad = a.relationship_state === "lost" || a.relationship_state === "do_not_contact" || lateInvoices.length > 0;
        const stateText = a.relationship_state === "delayed"
          ? (delayEnded(a.relationship_state, a.state_until, new Date()) ? "Delay ended — pick it back up" : `Delayed to ${shortDate(a.state_until)}`)
          : a.relationship_state === "lost"
            ? `Lost${a.lost_reason ? ` — ${LOST_REASONS.find((r) => r.key === a.lost_reason)?.label ?? a.lost_reason}` : ""}`
            : STATE_LABEL[a.relationship_state];
        return (
          <div className={`stcard ${bad ? "bad" : hold ? "hold" : ""}`} data-testid="status-card">
            <span className="stlabel">Where they&rsquo;re at</span>
            <span className="ststage" data-testid="status-stage">{laneLabel || (facts ? "New" : "Working it out…")}</span>
            {facts?.because && <span className="stwhy">{facts.because}</span>}
            <span className="stflags">
              {hold && <span className={`stflag ${a.relationship_state === "delayed" ? "warm" : "hot"}`}>{stateText}</span>}
              {lateInvoices.length > 0 && <span className="stflag hot" data-testid="flag-overdue">{lateInvoices.length === 1 ? "An invoice is overdue" : `${lateInvoices.length} invoices overdue`}</span>}
              {unpaidDeposits.length > 0 && lateInvoices.length === 0 && <span className="stflag warm" data-testid="flag-deposit">Deposit unpaid</span>}
              {a.followup_due_at && <span className="stflag">Follow up {shortDate(a.followup_due_at)}</span>}
              {snoozeLive && <span className="stflag">Snoozed to {shortDate(a.snoozed_until)}</span>}
              {a.temperature && <span className={`stflag ${a.temperature === "hot" ? "hot" : a.temperature === "warm" ? "warm" : ""}`}>{a.temperature[0].toUpperCase() + a.temperature.slice(1)}</span>}
              {a.permit_email === "declined" && <span className="stflag hot">No marketing email</span>}
              {a.permit_sms === "declined" && <span className="stflag hot">No texts</span>}
              {a.permit_phone === "declined" && <span className="stflag hot">No calls</span>}
              {(a.tags ?? []).map((t) => <span key={t} className="stflag">{((tagRows ?? []) as TagOption[]).find((o) => o.key === t)?.label ?? t}</span>)}
            </span>
            <span className="stmeta">
              {facts && facts.opened_count > 0 && <span>Opened the estimate {facts.opened_count}×</span>}
              <span>Owner: {ownerName ?? "nobody yet"}</span>
              {(Object.keys(consents) as ConsentKind[]).map((k) => (
                <span key={k} data-testid={`consent-${k}`}>{CONSENT_LABEL[k]}: agreed {shortDate(consents[k]!.at)} ({CONSENT_HOW_LABEL[consents[k]!.how] ?? consents[k]!.how})</span>
              ))}
              {off.length > 0 && (
                <span data-testid="prefs-off">
                  Switched off in their account: {off.map((o) => `${NOTIFY_TYPES.find((t) => t.key === o.type)?.label.toLowerCase()} by ${CHANNEL_LABEL[o.channel].toLowerCase()}`).join(", ")}
                </span>
              )}
            </span>
          </div>
        );
      })()}
      </div>

      {/* Item 8: everything of theirs, one tap away. */}
      <nav className="jumpstrip" aria-label="On this record" data-testid="jumpstrip">
        <a href="#estimates">Estimates<b>{est.length}</b></a>
        <a href="#jobs">Jobs<b>{(wos ?? []).length}</b></a>
        <a href="#invoices">Invoices<b>{invRows.length}</b></a>
        <a href="#visits">Visits</a>
        <a href="#messages">Messages</a>
        <a href="#history">History</a>
      </nav>

      <div className="stats">
        <div className="stat">
          <span>Latest estimate</span>
          <b>{money(latest?.total_cents)}</b>
          <em>{latest ? latest.status : "none yet"}</em>
        </div>
        <div className="stat">
          <span>Since it was sent</span>
          <b>{latest?.sent_at ? `${daysSince(latest.sent_at)}d` : "—"}</b>
          <em>{latest?.sent_at ? (latest.viewed_at ? `opened ${shortDate(latest.viewed_at)}` : "never opened") : "not sent yet"}</em>
        </div>
        <div className="stat">
          <span>Won so far</span>
          <b>{money(facts?.won_cents ?? 0)}</b>
          <em>{facts?.estimates_count ? `${facts.estimates_count} estimate${facts.estimates_count === 1 ? "" : "s"}` : "no estimates"}</em>
        </div>
        <div className="stat">
          <span>Last contact</span>
          <b>{facts?.last_contact_at ? `${daysSince(facts.last_contact_at)}d ago` : "—"}</b>
          <em>{facts?.last_contact_at ? (facts.last_contact_channel ? `by ${facts.last_contact_channel}` : "") : "no contact logged"}</em>
        </div>
      </div>

      <CustomerPanel accountId={a.id} temperature={a.temperature} followupDueAt={a.followup_due_at} followupNote={a.followup_note} snoozedUntil={a.snoozed_until} />

      <StatusPanel
        accountId={a.id}
        state={a.relationship_state}
        stateUntil={a.state_until}
        stateNote={a.state_note}
        stateReason={a.state_reason}
        lostReason={a.lost_reason}
        permits={{ email: a.permit_email, sms: a.permit_sms, phone: a.permit_phone } as Record<PermitChannel, PermitValue>}
        permitMeta={a.permit_meta ?? {}}
        tags={a.tags ?? []}
        tagOptions={(tagRows ?? []) as TagOption[]}
      />

      <VisitPanel
        accountId={a.id}
        propertyId={((props ?? [])[0]?.id as string | undefined) ?? null}
        estimateId={est.find((e) => e.status !== "declined" && e.status !== "expired")?.id ?? null}
        staff={staffAvail.map((s) => ({ id: s.staffId, name: s.name, takesVisits: s.takesVisits, visitMinutes: s.visitMinutes }))}
        visits={(visitRows ?? []) as VisitRow[]}
        today={melbourneDate(new Date())}
      />

      <p className="plabel" id="messages">Messages</p>
      <Messages accountId={a.id} messages={(messages ?? []) as MessageRow[]} hasEmail={Boolean(a.email)} hasPhone={Boolean(a.phone)} />

      <p className="plabel" id="estimates">Estimates</p>
      {est.length === 0 ? (
        <p className="empty" style={{ marginBottom: 16 }}>No estimates yet. <Link href={`/quote?account=${a.id}`} style={{ color: "var(--cyan)" }}>Start one →</Link></p>
      ) : (
        <div className="rlist" data-testid="estimates">
          {est.map((e) => {
            const jobs = woOf.get(e.id) ?? [];
            return (
              <Link key={e.id} className="rrow" href={`/quote?id=${e.id}`}>
                <span>
                  <span className="rt">{e.title || "Untitled estimate"}</span>
                  <span className="rsub">
                    {[e.sent_at ? `sent ${shortDate(e.sent_at)}` : `started ${shortDate(e.created_at)}`,
                      e.viewed_at ? `opened ${shortDate(e.viewed_at)}` : e.sent_at ? "never opened" : null,
                      e.accepted_at ? `accepted ${shortDate(e.accepted_at)}` : null,
                      e.status === "expired" && e.valid_until ? `lapsed ${shortDate(e.valid_until)}` : null,
                      jobs.length ? `${jobs.length} job${jobs.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="rright">
                  <span className={`pill ${STATUS_PILL[e.status] ?? "gy"}`}>{e.status}</span>
                  <span className="mono">{money(e.total_cents)}</span>
                  <span className="rgo">Open →</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <p className="plabel" id="jobs">Jobs</p>
      {(wos ?? []).length === 0 ? (
        <p className="empty" style={{ marginBottom: 16 }}>No job yet — one is created when an estimate is accepted.</p>
      ) : (
        <>
          <div className="rlist" data-testid="jobs">
            {((wos ?? []) as WoRow[]).map((w) => (
              <Link key={w.id} className="rrow" href={`/pc/wo/${w.id}`}>
                <span>
                  <span className="rt">{w.wo_ref || "Work order"}</span>
                  <span className="rsub">{[w.start_date ? `${shortDate(w.start_date)} → ${shortDate(w.end_date)}` : "not scheduled"].join(" · ")}</span>
                </span>
                <span className="rright">
                  <span className={`pill ${w.stage === "closed" ? "gr" : w.stage === "in_progress" ? "cy" : "gy"}`}>{WO_LABEL[w.stage ?? ""] ?? w.stage}</span>
                  <span className="rgo">Open →</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      <p className="plabel" id="invoices">Invoices</p>
      {invRows.length === 0 ? (
        <p className="empty" style={{ marginBottom: 16 }}>No invoices yet.</p>
      ) : (
        <>
          <div className="rlist" data-testid="invoices">
            {invRows.map((i) => {
              const f = invoiceFlags(i);
              return (
              <Link key={i.id} className={`rrow ${f.overdue ? "late" : ""}`} href={`/invoicing/inv/${i.id}`} data-testid={`invoice-${i.id}`}>
                <span>
                  <span className="rt">{i.number || "Draft invoice"}{i.kind ? ` · ${i.kind}` : ""}</span>
                  <span className="rsub">{[i.issued_on ? `issued ${shortDate(i.issued_on)}` : null, i.due_on ? `due ${shortDate(i.due_on)}` : null, f.balanceCents > 0 && f.balanceCents !== (i.total_inc_cents ?? 0) ? `${money(f.balanceCents)} still owing` : null].filter(Boolean).join(" · ") || "not issued"}</span>
                </span>
                <span className="rright">
                  {f.overdue && <span className="pill alert" data-testid="pill-overdue">Overdue{f.daysLate > 0 ? ` · ${f.daysLate}d` : ""}</span>}
                  {f.depositUnpaid && <span className="pill alert" data-testid="pill-deposit">Deposit unpaid</span>}
                  <span className={`pill ${i.status === "paid" ? "gr" : i.status === "void" || i.status === "written_off" ? "rd" : "cy"}`}>{i.status.replace("_", " ")}</span>
                  <span className="mono">{money(i.total_inc_cents)}</span>
                  <span className="rgo">Open →</span>
                </span>
              </Link>
              );
            })}
          </div>
        </>
      )}

      <p className="plabel">Properties</p>
      {(props ?? []).length === 0 ? (
        <p className="empty" style={{ marginBottom: 16 }}>No property on file — it is captured with the first estimate.</p>
      ) : (
        <div className="rlist" data-testid="properties">
          {((props ?? []) as Array<{ id: string; address: string | null; suburb: string | null; state: string | null; postcode: string | null }>).map((p) => (
            <div key={p.id} className="rrow">
              <span className="rt">{[p.address, p.suburb, p.state, p.postcode].filter(Boolean).join(" ")}</span>
              <span className="rright"><a className="rgo" href={`https://maps.google.com/?q=${encodeURIComponent([p.address, p.suburb, p.state, p.postcode].filter(Boolean).join(" "))}`} target="_blank" rel="noreferrer">Map ↗</a></span>
            </div>
          ))}
        </div>
      )}

      <p className="plabel">People on this account</p>
      <Contacts accountId={a.id} contacts={(contacts ?? []) as ContactRow[]} />

      <p className="plabel" id="history" style={{ marginTop: 22 }}>Everything, in order</p>
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
