import Link from "next/link";
import { getWorkQueue } from "../queue";
import { createClient } from "@/lib/supabase/server";
import { rememberBadge } from "@/lib/crm/badgeCache";
import { FILTER_GROUPS, GROUP_OF_KIND, groupByAccount, scopeItems, type FilterGroup, type WorkItem } from "@/lib/crm/work-queue";
import DismissControl from "./DismissControl";
import LogSheet from "../LogSheet";
import DroppedThisWeek from "./DroppedThisWeek";

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
  followup_due: "Follow-up", snooze_expired: "Follow-up", estimate_lapsed: "Quote lapsed", delay_ended: "Delay ended", visit_rebook: "Rebook",
  approval_pending: "Approve", variation_pending: "Variation", signoff_due: "Sign-off",
  broadcast_incomplete: "Broadcast", consent_missing: "Consent", invoice_action: "Invoice",
  change_request: "Change",
  handoff_requested: "Live chat",
  wizard_ready: "Ready", wizard_help: "Needs help", wizard_priced: "Priced",
  photo_review: "Photos",
  desk_check: "Desk check",
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
  searchParams: Promise<{ f?: string; page?: string; who?: string }>;
}) {
  const params = await searchParams;
  const filter = (FILTER_GROUPS.includes(params.f as FilterGroup) ? params.f : "all") as FilterGroup;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  // P7 (decision 6.5): "mine" by default — my customers and anyone unowned; "all" is the team's queue.
  const who: "mine" | "all" = params.who === "all" ? "all" : "mine";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const queue = await getWorkQueue();
  if (user) rememberBadge(user.id, queue.counts.byBucket.overdue + queue.counts.byBucket.today);
  const scoped = scopeItems(queue.items, who, user?.id ?? null);
  const filtered = filter === "all" ? scoped : scoped.filter((i) => GROUP_OF_KIND[i.kind] === filter);
  // P7: a customer's items sit under one card WITHIN a bucket (an overdue
  // follow-up and a due-today callback are two cards — the urgency differs).
  const grouped = BUCKETS.flatMap((b) => groupByAccount(filtered.filter((i) => i.bucket === b.key)));
  const pages = Math.max(1, Math.ceil(grouped.length / PAGE_SIZE));
  const shownGroups = grouped.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const restOf = new Map(shownGroups.map((g) => [g.lead.key, g.rest]));
  const shown = shownGroups.map((g) => g.lead);
  // Tom, 7 Sep (item 15): the number on the card, tap to call, log in place.
  const accountIds = [...new Set(shown.map((i) => i.accountId).filter((x): x is string => Boolean(x)))];
  const { data: phoneRows } = accountIds.length
    ? await supabase.from("accounts").select("id, phone").in("id", accountIds.slice(0, 200))
    : { data: [] as Array<{ id: string; phone: string | null }> };
  const phoneOf = new Map(((phoneRows ?? []) as Array<{ id: string; phone: string | null }>).map((r) => [r.id, r.phone]));
  const telHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, "")}`;
  const needsYou = scoped.filter((i) => i.bucket !== "waiting").length;

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { f: filter === "all" ? undefined : filter, who: who === "mine" ? undefined : who, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const q = p.toString();
    return `/crm/today${q ? `?${q}` : ""}`;
  };
  const chipHref = (g: FilterGroup) => qs({ f: g === "all" ? undefined : g, page: undefined });
  const chipCount = (g: FilterGroup) => (g === "all" ? scoped.length : scoped.filter((i) => GROUP_OF_KIND[i.kind] === g).length);
  const waiting = scoped.filter((i) => i.bucket === "waiting").length;

  return (
    <>
      <h2>{needsYou === 0 ? "Nothing needs you" : `${needsYou} thing${needsYou === 1 ? "" : "s"} need${needsYou === 1 ? "s" : ""} you`}</h2>
      <p className="sub">Messages, callbacks, follow-ups and approvals — one queue, whatever they came from. Each card says what happened and what to do; the blue button does it.</p>

      <div className="chips" style={{ margin: "0 0 8px" }} data-testid="who-chips">
        <Link className={`chip ${who === "mine" ? "on" : ""}`} href={qs({ who: undefined, page: undefined })} data-testid="who-mine">Mine</Link>
        <Link className={`chip ${who === "all" ? "on" : ""}`} href={qs({ who: "all", page: undefined })} data-testid="who-all">Everyone</Link>
        <span className="bhint" style={{ alignSelf: "center", margin: 0 }}>{who === "mine" ? "Your customers, and anyone nobody owns." : "The whole team's queue."}</span>
      </div>
      <div className="chips" style={{ margin: "0 0 4px" }}>
        {FILTER_GROUPS.map((g) => (
          <Link key={g} className={`chip ${filter === g ? "on" : ""}`} href={chipHref(g)}>
            {CHIP_LABEL[g]}<span className="chipn mono">{chipCount(g)}</span>
          </Link>
        ))}
      </div>
      {queue.counts.truncated.length > 0 && (
        <p className="partial" data-testid="truncated">
          Some sources have more than this screen reads at once ({queue.counts.truncated.join(", ")}) — the oldest are shown first; clear them and the rest surface.
        </p>
      )}

      {shown.length === 0 && (
        // The empty state is the reward (§3.9): say so plainly and point at
        // what's coming rather than leaving a blank.
        <div className="qempty">
          <b>{filter === "all" ? "All clear." : `Nothing under ${CHIP_LABEL[filter]}.`}</b>
          <span>
            {waiting > 0
              ? `${waiting} thing${waiting === 1 ? " is" : "s are"} waiting on customers — they'll surface here the moment they need a hand.`
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
              // P7: the rest of this customer's items ride under the lead card.
              const rest = restOf.get(item.key) ?? [];
              return (
                <div key={item.key} className={`qitem ${item.bucket === "overdue" ? "od" : item.bucket === "today" ? "due" : "ok"}`}>
                  <span className="qico" aria-hidden="true">{GROUP_ICON[group]}</span>
                  <span className="qmain">
                    <span className="qt"><span className="qsrc">{KIND_TAG[item.kind]}</span>{item.title}</span>
                    <span className="qb">{item.detail}</span>
                    {rest.map((r) => (
                      <span className="qb qalso" key={r.key} data-testid="also">
                        <span className="qsrc">{KIND_TAG[r.kind]}</span>{r.title}
                        <Link href={r.action.href} className="qgo" style={{ marginLeft: 8 }}>{r.action.label} →</Link>
                        <DismissControl itemKey={r.key} accountId={r.accountId} />
                      </span>
                    ))}
                    <span className="qact">
                      <Link href={item.action.href} className="qgo qprimary" data-testid="item-action">{item.action.label} →</Link>
                      {item.accountId && phoneOf.get(item.accountId) && (
                        <a href={telHref(phoneOf.get(item.accountId)!)} className="qtel mono" data-testid="item-phone">☎ {phoneOf.get(item.accountId)}</a>
                      )}
                      {item.accountId && <LogSheet accountId={item.accountId} />}
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
          {page > 1 && <Link href={qs({ page: String(page - 1) })}>← Newer</Link>}
          <span className="mono">{page} / {pages}</span>
          {page < pages && <Link href={qs({ page: String(page + 1) })}>Older →</Link>}
        </div>
      )}

      <DroppedThisWeek />

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
