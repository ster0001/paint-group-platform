import { createClient } from "@/lib/supabase/server";
import UpdateCard from "./UpdateCard";
import ClearClosed from "./ClearClosed";
import { reportError } from "@/lib/monitoring/report";

export const dynamic = "force-dynamic";

/**
 * The drafted-update review — the PC surface steps 4 deferred to the console.
 * Nothing on this page has reached a customer; nothing leaves it without a
 * person pressing send.
 */
export default async function UpdatesPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("wo_updates")
    .select("id, work_order_id, for_date, draft_text, final_text, status, photo_count, source_tick_ids, work_orders(wo_ref, wo_snapshot, stage)")
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
    id: string; work_order_id: string; for_date: string; draft_text: string;
    final_text: string | null; status: string; photo_count: number; source_tick_ids: string[] | null;
    work_orders: { wo_ref: string; wo_snapshot: { jobTitle?: string } | null; stage: string | null } | null;
  }[];

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
        <h1>Updates waiting on you.</h1>
        <p className="lede">
          Written from today&rsquo;s ticks. Nothing reaches a customer until you
          approve it — edit anything that doesn&rsquo;t sound like us.
        </p>
      </div>

      <div className="sect">
        <div className="stack" data-testid="updates">
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
              Nothing drafted. Updates appear here after the day&rsquo;s ticks.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
