import { createClient } from "@/lib/supabase/server";
import UpdateCard from "./UpdateCard";
import ClearClosed from "./ClearClosed";
import { reportError } from "@/lib/monitoring/report";
import { realOnly } from "@/lib/demo/scope";
import AutoSendSwitch from "./AutoSendSwitch";
import { loadCustomerUpdatesSettings } from "@/lib/workorder/customerUpdates";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * The drafted-update review — the PC surface steps 4 deferred to the console.
 * Nothing on this page has reached a customer; nothing leaves it without a
 * person pressing send.
 */
export default async function UpdatesPage() {
  const supabase = await createClient();

  const { data, error } = await realOnly(supabase
    .from("wo_updates")
    .select("id, work_order_id, for_date, created_at, kind, draft_text, final_text, status, photo_count, source_tick_ids, work_orders(wo_ref, wo_snapshot, stage, estimates(accepted_name, builder_state))"))
    // Today's SENT updates stay on the page, greyed, rather than vanishing the
    // moment you press send: a card that disappears reads as "did that work?".
    // (It also made the e2e flaky — the card unmounted before it could confirm.)
    .or(`status.in.(drafted,approved),and(status.eq.sent,for_date.eq.${new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date())})`)
    .order("created_at", { ascending: true });

  // A rejected read must say so, never draw "Nothing drafted" over a full list.
  if (error) reportError(error, { where: "pc.updates.list" });
  const rows = (error ? [] : data ?? []) as unknown as {
    id: string; work_order_id: string; for_date: string; created_at: string; kind: string; draft_text: string;
    final_text: string | null; status: string; photo_count: number; source_tick_ids: string[] | null;
    work_orders: {
      wo_ref: string; wo_snapshot: { jobTitle?: string; jobAddress?: string; contactFirstName?: string } | null; stage: string | null;
      estimates: { accepted_name: string | null; builder_state: { contact?: { name?: string } } | null } | null;
    } | null;
  }[];

  // The queue's two settings (work order UX Step 2): who it is from, and whether drafts go on their own.
  const service = createServiceClient();
  const settings = service ? await loadCustomerUpdatesSettings(service) : null;
  const sender = settings?.senderFirstName ?? "the office";
  const recipientOf = (r: (typeof rows)[number]): string => {
    const name = r.work_orders?.estimates?.builder_state?.contact?.name ?? r.work_orders?.estimates?.accepted_name ?? r.work_orders?.wo_snapshot?.contactFirstName ?? "";
    return name.trim() || "the customer";
  };
  const waiting = rows.filter((r) => r.status !== "sent").length;

  // Tom, 14 Oct 2026: WHEN the painter last ticked an area for this draft, so
  // the office knows how fresh the words are before sending them. Read from
  // the draft's own source ticks (the events it was written from), one query
  // for the whole page; the newest tick per draft is the time shown.
  const tickIds = [...new Set(rows.flatMap((r) => r.source_tick_ids ?? []))];
  const tickedAt = new Map<string, string>();
  let ticksFailed: string | null = null;
  if (tickIds.length > 0) {
    const { data: ticks, error: ticksError } = await supabase
      .from("wo_events").select("id, created_at").in("id", tickIds);
    if (ticksError) { reportError(ticksError, { where: "pc.updates.ticks" }); ticksFailed = ticksError.message; }
    for (const t of (ticks ?? []) as { id: string; created_at: string }[]) tickedAt.set(t.id, t.created_at);
  }
  const lastTickFor = (r: { source_tick_ids: string[] | null }): string | null => {
    let latest: string | null = null;
    for (const id of r.source_tick_ids ?? []) {
      const at = tickedAt.get(id);
      if (at && (!latest || at > latest)) latest = at;
    }
    return latest;
  };
  // Tom, 29 Sep: drafts on jobs that have since completed — too late to send.
  const onClosedJobs = rows.filter((r) => r.status !== "sent" && r.work_orders?.stage === "closed").length;

  return (
    <>
      <div>
        <h1>Customer updates.</h1>
        <p className="lede">
          Every message the system writes for a customer lands here &mdash; surface
          milestones from the painter&rsquo;s ticks and the end-of-day summary.
          Send it to their timeline, change the words first, or drop it.
        </p>
      </div>

      <div className="sect">
        <div className="stack" data-testid="updates">
          {settings && <AutoSendSwitch on={settings.autoSend} sender={sender} />}
          <p className="kicker" data-testid="updates-waiting">Waiting to send · {waiting}</p>
          {error && (
            <p className="empty" data-testid="updates-error">Couldn&rsquo;t load the updates just now — {error.message}</p>
          )}
          {ticksFailed && (
            <p className="empty" data-testid="updates-ticks-error">Couldn&rsquo;t read when the painter last ticked — {ticksFailed}</p>
          )}
          <ClearClosed count={onClosedJobs} />
          {rows.map((row) => (
            <UpdateCard
              key={row.id}
              id={row.id}
              status={row.status}
              forDate={row.for_date}
              createdAt={row.created_at}
              kind={row.kind}
              recipient={recipientOf(row)}
              sender={sender}
              jobAddress={row.work_orders?.wo_snapshot?.jobAddress ?? ""}
              text={row.final_text ?? row.draft_text}
              photoCount={row.photo_count}
              lastTickAt={lastTickFor(row)}
              woRef={row.work_orders?.wo_ref ?? ""}
              jobTitle={row.work_orders?.wo_snapshot?.jobTitle ?? ""}
              jobStage={row.work_orders?.stage ?? null}
            />
          ))}

          {rows.length === 0 && !error && (
            <p className="empty" data-testid="updates-empty">
              Nothing waiting. Updates appear here as the painter ticks the job off.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
