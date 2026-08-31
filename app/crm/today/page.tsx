import Link from "next/link";
import { getWorkQueue } from "../queue";
import { FILTER_GROUPS, GROUP_OF_KIND, type FilterGroup, type WorkItem } from "@/lib/crm/work-queue";
import DismissControl from "./DismissControl";

export const dynamic = "force-dynamic";

/**
 * Today (§4.2) — everything needing a human, from any source, one queue.
 * Messages, callbacks, expired snoozes, approvals and unpaid money all arrive
 * here; nothing needing a person lives anywhere else. The chips are filters
 * over the same evaluator, never separate queries.
 *
 * A hundred outstanding items is a real state on a bad week, so the list
 * paginates rather than degrading (§3.8).
 */

const PAGE_SIZE = 50;

const CHIP_LABEL: Record<FilterGroup, string> = {
  all: "All", messages: "Messages", followups: "Follow-ups", approvals: "Approvals", money: "Money",
};

const KIND_TAG: Record<WorkItem["kind"], string> = {
  message_unanswered: "Message", message_unmatched: "Unmatched", callback_requested: "Callback",
  followup_due: "Follow-up", snooze_expired: "Follow-up", visit_rebook: "Rebook",
  approval_pending: "Approve", variation_pending: "Variation", signoff_due: "Sign-off",
  broadcast_incomplete: "Broadcast", consent_missing: "Consent", invoice_action: "Invoice",
};

const GROUP_ICON: Record<Exclude<FilterGroup, "all">, string> = {
  messages: "✉", followups: "↻", approvals: "✦", money: "$",
};

const BUCKETS = [
  { key: "overdue", label: "Overdue", bad: true },
  { key: "today", label: "Due today", bad: false },
  { key: "waiting", label: "Waiting on them", bad: false },
] as const;

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "soon";
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs < 1) return "just now";
  if (hrs < 48) return `${hrs} hr${hrs === 1 ? "" : "s"}`;
  return `${Math.floor(hrs / 24)} days`;
}

export default async function TodayPage({ searchParams }: {
  searchParams: Promise<{ f?: string; page?: string }>;
}) {
  const params = await searchParams;
  const filter = (FILTER_GROUPS.includes(params.f as FilterGroup) ? params.f : "all") as FilterGroup;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const queue = await getWorkQueue();
  const filtered = filter === "all" ? queue.items : queue.items.filter((i) => GROUP_OF_KIND[i.kind] === filter);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const needsYou = queue.counts.byBucket.overdue + queue.counts.byBucket.today;

  const chipHref = (g: FilterGroup) => (g === "all" ? "/crm/today" : `/crm/today?f=${g}`);
  const chipCount = (g: FilterGroup) => (g === "all" ? queue.counts.total : queue.counts.byGroup[g]);

  return (
    <>
      <h2>{needsYou === 0 ? "Nothing needs you" : `${needsYou} thing${needsYou === 1 ? "" : "s"} need${needsYou === 1 ? "s" : ""} you`}</h2>
      <p className="sub">Messages, callbacks, follow-ups and approvals — one queue, whatever they came from.</p>

      <div className="chips" style={{ margin: "0 0 4px" }}>
        {FILTER_GROUPS.map((g) => (
          <Link key={g} className={`chip ${filter === g ? "on" : ""}`} href={chipHref(g)}>
            {CHIP_LABEL[g]}<span className="chipn mono">{chipCount(g)}</span>
          </Link>
        ))}
      </div>

      {shown.length === 0 && (
        // The empty state is the reward (§3.9): say so plainly and point at
        // what's coming rather than leaving a blank.
        <div className="qempty">
          <b>{filter === "all" ? "All clear." : `Nothing under ${CHIP_LABEL[filter]}.`}</b>
          <span>
            {queue.counts.byBucket.waiting > 0
              ? `${queue.counts.byBucket.waiting} thing${queue.counts.byBucket.waiting === 1 ? " is" : "s are"} waiting on customers — they'll surface here the moment they need a hand.`
              : "New messages, expired snoozes, approvals and unpaid invoices will land here on their own — nothing to set up."}
          </span>
          <Link href="/crm/diary" className="qemptylink">See what&rsquo;s on this week →</Link>
        </div>
      )}

      {BUCKETS.map((b) => {
        const items = shown.filter((i) => i.bucket === b.key);
        if (items.length === 0) return null;
        return (
          <section key={b.key}>
            <div className={`slab ${b.bad ? "bad" : ""}`}>{b.label} <span className="slabn mono">{items.length}</span><i /></div>
            {items.map((item) => {
              const group = GROUP_OF_KIND[item.kind];
              return (
                <div key={item.key} className={`qitem ${item.bucket === "overdue" ? "od" : item.bucket === "today" ? "due" : "ok"}`}>
                  <span className="qico" aria-hidden="true">{GROUP_ICON[group]}</span>
                  <span className="qmain">
                    <span className="qt"><span className="qsrc">{KIND_TAG[item.kind]}</span>{item.title}</span>
                    <span className="qb">{item.detail}</span>
                    <span className="qact">
                      <Link href={item.action.href} className="qgo">{item.action.label} →</Link>
                      <DismissControl itemKey={item.key} accountId={item.accountId} />
                    </span>
                  </span>
                  <span className={`qw mono ${item.bucket === "overdue" ? "bad" : ""}`}>{ago(item.since)}</span>
                </div>
              );
            })}
          </section>
        );
      })}

      {pages > 1 && (
        <div className="qpage">
          {page > 1 && <Link href={`/crm/today?${filter === "all" ? "" : `f=${filter}&`}page=${page - 1}`}>← Newer</Link>}
          <span className="mono">{page} / {pages}</span>
          {page < pages && <Link href={`/crm/today?${filter === "all" ? "" : `f=${filter}&`}page=${page + 1}`}>Older →</Link>}
        </div>
      )}

      {shown.length > 0 && (
        <div className="note">
          <b>One queue, not three.</b> An unanswered callback, an expired snooze, a campaign approval
          and an unpaid deposit all arrive here. Answer the underlying thing and the item disappears
          on its own — there is nothing to tick.
        </div>
      )}
    </>
  );
}
