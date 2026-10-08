import Link from "next/link";
import { reportError } from "@/lib/monitoring/report";
import { createClient } from "@/lib/supabase/server";
import { loadConsole } from "@/lib/workorder/consoleData";
import { buildQueue, headline, pulseTiles, sparkline, variationsForApproval } from "@/lib/workorder/console";
import DismissCard from "./DismissCard";
import ReofferDialog from "./ReofferDialog";
import BonusHandover from "./BonusHandover";
import QueueDismiss from "./QueueDismiss";
import CollectionDone from "./CollectionDone";
import CheckinDone from "./CheckinDone";
import StandardsRemind from "./StandardsRemind";
import WorkItemNote from "./WorkItemNote";
import { loadWorkItemNotes } from "@/lib/workorder/pcNotes";
import { buildPcWorkItems } from "@/lib/crm/work-queue";
import PhotoGrid from "@/app/components/wo/PhotoGrid";
import { signPhotos, type WOPhoto, type WOPhotoRow } from "@/lib/workorder/photos";
import RejectVariation from "./RejectVariation";

export const dynamic = "force-dynamic";

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");

const ICON: Record<string, string> = {
  reoffer: "⚑", call: "◌", price: "◐", open: "◔", ring: "◷",
  review: "✎", nudge: "◑", extension: "◓", collect: "⌂", qa: "✓", deduct: "−",
};

const age = (hours: number) =>
  hours < 1 ? "now" : hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;

export default async function DashboardPage() {
  const supabase = await createClient();
  const { input, signedOffThisWeek, ticksByDay, expiringDocs } = await loadConsole(supabase);

  const queue = buildQueue(input);
  // Tom, 6 Oct 2026: the customer check-ins and after-job calls are worked
  // from here, not the CRM. Same evaluator and dismissals as Today — a
  // different screen over the one queue, not a second queue.
  const checkins = await buildPcWorkItems(supabase, input.now);
  // Tom, 8 Oct 2026: a short note on each reminder, kept against its key.
  const itemNotes = await loadWorkItemNotes(supabase, [
    ...checkins.items.map((i) => i.key), ...queue.map((c) => c.key),
  ]);
  const noteFor = (key: string) => <WorkItemNote itemKey={key} initial={itemNotes.notes.get(key) ?? ""} />;
  const dueWord = (item: { bucket: string; dueAt: string | null }) =>
    item.bucket === "overdue" ? "overdue" : item.bucket === "today" ? "by 5 pm today" : "waiting";

  // Who a lapsed job can go to: compliant contractors only. send_offer enforces
  // it too, but offering someone who will be refused is a wasted tap.
  // A week out, computed once rather than during render.
  const defaultReofferStart = new Date(input.now.getTime() + 7 * 86_400_000)
    .toISOString().slice(0, 10);

  const [{ data: offerable }, { data: statusRows, error: statusErr }] = await Promise.all([
    supabase.from("contractors").select("id, company_name").eq("offerable", true).eq("active", true),
    supabase.from("painter_status").select("painter_id, colour, offers_cleared_at"),
  ]);
  // Painter status Step 7 (⚑7, ⚑8): Green first, then Yellow and New, then Orange; a Red
  // with no clearance is left out — send_offer would refuse them.
  if (statusErr) reportError(statusErr, { where: "pc.reoffer.status", bestEffort: true }); // targets then carry no colour; send_offer still refuses a Red
  const statusOf = new Map(((statusRows ?? []) as { painter_id: string; colour: string; offers_cleared_at: string | null }[]).map((r) => [r.painter_id, r]));
  const rank: Record<string, number> = { green: 0, yellow: 1, new: 1, orange: 2, red: 3 };
  const targets = ((offerable ?? []) as { id: string; company_name: string }[])
    .filter((c) => !(statusOf.get(c.id)?.colour === "red" && !statusOf.get(c.id)?.offers_cleared_at))
    .map((c) => ({ id: c.id, name: c.company_name || "Unnamed contractor", colour: statusOf.get(c.id)?.colour ?? null }))
    .sort((a, b) => (a.colour ? rank[a.colour] ?? 1 : 1) - (b.colour ? rank[b.colour] ?? 1 : 1) || a.name.localeCompare(b.name));
  // What came back from site, newest first, across every job. Staff RLS scopes
  // the read; the bucket is private, so the URLs are signed here and live an
  // hour. Capped at 24 — this is a glance at the day, not an archive.
  const { data: recentPhotoRows } = await supabase
    .from("wo_photos")
    .select("id, work_order_id, kind, area, caption, storage_path, created_at, variation_id, work_orders(wo_ref, wo_snapshot)")
    .order("created_at", { ascending: false })
    .limit(24);

  type PhotoJoin = WOPhotoRow & { work_orders: { wo_ref: string; wo_snapshot: { jobTitle?: string } | null } | null };
  const photoRows = (recentPhotoRows ?? []) as unknown as PhotoJoin[];
  const jobLabel = new Map(photoRows.map((r) => [
    r.work_order_id ?? "",
    r.work_orders?.wo_snapshot?.jobTitle || r.work_orders?.wo_ref || "Job",
  ]));
  const recentPhotos = await signPhotos(supabase, photoRows);

  // Grouped by job in the order the newest photo arrived, so the site that just
  // sent something is the site at the top.
  const photosByJob: { workOrderId: string; label: string; photos: WOPhoto[] }[] = [];
  for (const photo of recentPhotos) {
    const existing = photosByJob.find((g) => g.workOrderId === photo.workOrderId);
    if (existing) existing.photos.push(photo);
    else photosByJob.push({
      workOrderId: photo.workOrderId,
      label: jobLabel.get(photo.workOrderId) ?? "Job",
      photos: [photo],
    });
  }

  const tiles = pulseTiles(input, queue, signedOffThisWeek);
  const head = headline(tiles);
  // Tom, 17 Sep: every open variation, across every job, in one place.
  const approvals = variationsForApproval(input);
  const onYou = approvals.filter((v) => v.waitingOn === "office").length;
  const line = sparkline(ticksByDay, input.now);

  const max = Math.max(1, ...line);
  const points = line
    .map((v, i) => `${2 + i * 9},${26 - (v / max) * 20}`)
    .join(" ");

  return (
    <>
      <div>
        <h1>{head.top}<br />{head.bottom}</h1>
        <p className="lede">
          Everything below is read from the work-order model — no typed statuses,
          no stale boards.
        </p>
      </div>

      {(expiringDocs ?? []).length > 0 && (
        <div style={{
          border: "1px solid rgba(224,168,60,.5)", background: "rgba(224,168,60,.08)",
          borderRadius: 14, padding: "12px 16px", margin: "14px 0", fontSize: 14,
        }}>
          {(expiringDocs ?? []).map((d) => (
            <div key={d.id} style={{ color: "var(--amber, #E0A83C)" }}>
              ⚑ {d.title} {d.daysLeft < 0
                ? `EXPIRED ${-d.daysLeft} day${d.daysLeft === -1 ? "" : "s"} ago`
                : `expires in ${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"}`} — customers can
              see this certificate. Replace it in Settings → Documents.
            </div>
          ))}
        </div>
      )}

      <div className="pulse">
        <div className="tile">
          <span className="k">On the books</span>
          <span className="v" data-testid="tile-books">{money(tiles.onTheBooksCents)}</span>
          <span className="s">inc GST · {tiles.openJobs} open job{tiles.openJobs === 1 ? "" : "s"}</span>
        </div>
        <div className="tile crit">
          <span className="k">Critical</span>
          <span className="v" data-testid="tile-critical">{tiles.critical}</span>
          <span className="s">SLA breach · silent site</span>
        </div>
        <div className="tile warn">
          <span className="k">Waiting on you</span>
          <span className="v" data-testid="tile-waiting">{tiles.waiting}</span>
          <span className="s">price · colours · nudge · drafts</span>
        </div>
        <div className="tile good">
          <span className="k">Signed off this week</span>
          <span className="v" data-testid="tile-signed">{tiles.signedOffThisWeek}</span>
          <span className="s">from the event log</span>
        </div>
      </div>

      <div className="sect" data-testid="variations-for-approval">
        <div className="sect-h">
          <h2>Variations for approval</h2>
          <span data-testid="variations-for-approval-count">
            {approvals.length === 0
              ? "none open"
              : `${approvals.length} open · ${onYou} waiting on you`}
          </span>
        </div>
        <div className="stack">
          {approvals.map((v) => (
            <div className={`al ${v.waitingOn === "office" ? "al-warn" : "al-info"}`} key={v.id}
              data-testid={`variation-approval-${v.id}`}>
              <span className="rail" />
              <span className="ic">{v.waitingOn === "office" ? "◐" : v.waitingOn === "customer" ? "◑" : "◔"}</span>
              <div className="bd">
                <div className="hd">
                  <strong>{v.category}{v.credit ? " · credit" : ""}{v.priceCents != null ? ` · ${money(v.priceCents)}` : ""}</strong>
                  <span className="ref">{v.ref}</span>
                </div>
                <p>{v.waitingLabel}{v.comment ? ` — ${v.comment}` : ""}</p>
                {/* Tom, 8 Oct 2026: a request still with the office can be turned down, with a reply to the painter. */}
                {v.waitingOn === "office" && <RejectVariation variationId={v.id} />}
              </div>
              <span className="tm">{age(v.ageHours)}</span>
              <Link className={`btn ${v.waitingOn === "office" ? "primary" : ""}`} href={v.href}
                data-testid={`variation-approval-open-${v.id}`}>
                {v.waitingOn === "office" ? "Price it" : "Open"}
              </Link>
            </div>
          ))}
          {approvals.length === 0 && (
            <p className="empty" data-testid="variations-for-approval-empty">
              No variations waiting. A painter&rsquo;s raise, or one you write down, appears here until everyone has said yes.
            </p>
          )}
        </div>
      </div>

      <div className="sect">
        <div className="sect-h">
          <h2>Needs you now</h2><span>ranked · worst first</span>
          <svg className="spark" width="120" height="30" viewBox="0 0 120 30" role="img"
            aria-label="Ticks logged per day, last 14 days">
            <polyline points={points} fill="none" stroke="#3BD8E9" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
          </svg>
        </div>

        <div className="stack" data-testid="queue">
          {itemNotes.failure && (
            <p className="empty" data-testid="notes-failure" style={{ color: "var(--amber)" }}>{itemNotes.failure}</p>
          )}
          {checkins.failure && (
            <p className="empty" data-testid="checkins-failure" style={{ color: "var(--amber)" }}>{checkins.failure}</p>
          )}
          {checkins.items.map((item) => item.kind === "walkthrough_flagged" || item.kind === "callback_unbooked" || item.kind === "callback_visit_soon" || item.kind === "callback_fixed" ? (
            // Call backs Step 3 (brief §8): one card per trigger, one primary action.
            <div className={`al ${item.bucket === "overdue" ? "al-crit" : item.kind === "callback_visit_soon" ? "al-info" : "al-warn"}`} key={item.key}
              data-testid={`callback-card-${item.key}`} data-kind={item.kind}>
              <span className="rail" />
              <span className="ic">{item.kind === "walkthrough_flagged" ? "⚑" : "↩"}</span>
              <div className="bd">
                <div className="hd">
                  <strong>{item.title}</strong>
                  <span className="ref">{item.kind === "walkthrough_flagged" ? "Walk-through" : "Call back"} · {dueWord(item)}</span>
                </div>
                <p>{item.detail}</p>
                {noteFor(item.key)}
              </div>
              <span className="tm">{age((input.now.getTime() - new Date(item.since).getTime()) / 3_600_000)}</span>
              <Link className="btn primary" href={item.action.href} data-testid={`callback-card-open-${item.key}`}>{item.action.label}</Link>
              {item.kind === "walkthrough_flagged" && <CheckinDone itemKey={item.key} accountId={null} />}
            </div>
          ) : item.kind === "painter_red" || item.kind === "painter_orange" || item.kind === "bonus_due" || item.kind === "bonus_changed" || item.kind === "payment_hold" ? (
            // Painter status Step 7 (brief §8): one card per trigger, one primary action.
            <div className={`al ${item.kind === "painter_red" || item.kind === "painter_orange" ? "al-crit" : item.kind === "bonus_due" ? "al-info" : "al-warn"}`} key={item.key}
              data-testid={`status-card-${item.key}`} data-kind={item.kind}>
              <span className="rail" />
              <span className="ic">{item.kind.startsWith("painter_") ? "●" : item.kind.startsWith("bonus_") ? "★" : "⏸"}</span>
              <div className="bd">
                <div className="hd">
                  <strong>{item.title}</strong>
                  <span className="ref">{item.kind.startsWith("painter_") ? "Painter" : item.kind.startsWith("bonus_") ? "Bonus" : "Payment hold"} · {dueWord(item)}</span>
                </div>
                <p>{item.detail}</p>
              </div>
              <span className="tm">{age((input.now.getTime() - new Date(item.since).getTime()) / 3_600_000)}</span>
              {item.kind === "bonus_due"
                ? <BonusHandover bonusId={item.key.split(":").pop() ?? ""} painterId={item.subjectRef.id} itemKey={item.key} href={item.action.href} />
                : <Link className="btn primary" href={item.action.href} data-testid={`status-card-open-${item.key}`}>{item.action.label}</Link>}
              {item.kind === "painter_orange" && <QueueDismiss itemKey={item.key} label="Rang them" reason="Rang the painter about their Orange status (PC Command)" />}
              {item.kind === "bonus_changed" && <QueueDismiss itemKey={item.key} label="Reviewed" reason="Reviewed the changed qualifying job (PC Command)" />}
            </div>
          ) : item.kind === "standards_unsigned" ? (
            // Standards Step 2 (brief §8): a painter past the grace period who has
            // not confirmed. One action — the reminder text; it clears itself
            // when they confirm.
            <div className="al al-warn" key={item.key} data-testid={`standards-${item.key}`}>
              <span className="rail" />
              <span className="ic">✎</span>
              <div className="bd">
                <div className="hd">
                  <strong>{item.title}</strong>
                  <span className="ref">Standards · {dueWord(item)}</span>
                </div>
                <p>{item.detail}</p>
                {noteFor(item.key)}
              </div>
              <span className="tm">{age((input.now.getTime() - new Date(item.since).getTime()) / 3_600_000)}</span>
              <Link className="btn" href={item.action.href} data-testid={`standards-open-${item.key}`}>Open painter</Link>
              <StandardsRemind contractorId={item.subjectRef.id} itemKey={item.key} />
            </div>
          ) : (
            <div className={`al ${item.bucket === "overdue" ? "al-crit" : "al-warn"}`} key={item.key}
              data-testid={`checkin-${item.key}`}>
              <span className="rail" />
              <span className="ic">◷</span>
              <div className="bd">
                <div className="hd">
                  <strong>{item.title}</strong>
                  <span className="ref">{item.kind === "job_checkin" ? "Check-in" : "Follow-up"} · {dueWord(item)}</span>
                </div>
                <p>{item.detail}</p>
                {noteFor(item.key)}
              </div>
              <span className="tm">{age((input.now.getTime() - new Date(item.since).getTime()) / 3_600_000)}</span>
              <Link className="btn" href={item.action.href} data-testid={`checkin-open-${item.key}`}>Open the job</Link>
              <CheckinDone itemKey={item.key} accountId={item.accountId} />
            </div>
          ))}
          {queue.map((card) => (
            <div className={`al al-${card.severity === "critical" ? "crit" : card.severity === "warning" ? "warn" : "info"}`}
              key={card.key} data-testid={`card-${card.key}`}>
              <span className="rail" />
              <span className="ic">{ICON[card.action.kind] ?? "•"}</span>
              <div className="bd">
                <div className="hd">
                  <strong>{card.title}</strong>
                  <span className="ref">{card.ref}</span>
                </div>
                <p>{card.detail}</p>
                {noteFor(card.key)}
              </div>
              <span className="tm">{age(card.ageHours)}</span>
              <DismissCard workOrderId={card.workOrderId} cardKey={card.key} />
              {card.action.kind === "reoffer" && card.offerId ? (
                <span data-testid={`action-${card.key}`}>
                  <ReofferDialog
                    offerId={card.offerId}
                    jobTitle={card.ref}
                    lapsedName={card.detail.split(" has had it")[0]}
                    contractors={targets}
                    defaultStart={defaultReofferStart}
                  />
                </span>
              ) : card.action.kind === "collect" ? (
                <CollectionDone itemId={card.key.slice("collect:".length)} cardKey={card.key}
                  href={card.action.href ?? `/pc/wo/${card.workOrderId}`} />
              ) : (
                <Link className={`btn ${card.severity === "critical" ? "primary" : ""}`}
                  href={card.action.href ?? `/pc/wo/${card.workOrderId}`}
                  data-testid={`action-${card.key}`}>
                  {card.action.label}
                </Link>
              )}
            </div>
          ))}

          {queue.length === 0 && checkins.items.length === 0 && (
            <p className="empty" data-testid="queue-empty">
              Nothing needs you. Every job is where it should be.
            </p>
          )}
        </div>
      </div>

      {/* LATEST FROM SITE — the painters' own photos, including the ones
          attached to variations. They were being uploaded and read by nobody. */}
      <div className="sect" data-testid="latest-photos">
        <div className="sect-h">
          <h2>Latest from site</h2><span>newest first · tap to open</span>
        </div>

        {photosByJob.length === 0 ? (
          <p className="empty">
            No photos yet. They arrive as the crews tick off elevations, raise
            variations and finish up.
          </p>
        ) : (
          <div className="stack">
            {photosByJob.slice(0, 5).map((g) => (
              <div className="card" key={g.workOrderId}>
                <div className="photostrip-h">
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{g.label}</h3>
                  <Link href={`/pc/wo/${g.workOrderId}`}>Open job →</Link>
                </div>
                <PhotoGrid photos={g.photos.slice(0, 8)} tight />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
