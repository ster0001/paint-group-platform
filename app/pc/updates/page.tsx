import { createClient } from "@/lib/supabase/server";
import UpdateCard from "./UpdateCard";

export const dynamic = "force-dynamic";

/**
 * The drafted-update review — the PC surface steps 4 deferred to the console.
 * Nothing on this page has reached a customer; nothing leaves it without a
 * person pressing send.
 */
export default async function UpdatesPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("wo_updates")
    .select("id, work_order_id, for_date, draft_text, final_text, status, photo_count, work_orders(wo_ref, wo_snapshot)")
    // Today's SENT updates stay on the page, greyed, rather than vanishing the
    // moment you press send: a card that disappears reads as "did that work?".
    // (It also made the e2e flaky — the card unmounted before it could confirm.)
    .or(`status.in.(drafted,approved),and(status.eq.sent,for_date.eq.${new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date())})`)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as {
    id: string; work_order_id: string; for_date: string; draft_text: string;
    final_text: string | null; status: string; photo_count: number;
    work_orders: { wo_ref: string; wo_snapshot: { jobTitle?: string } | null } | null;
  }[];

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
          {rows.map((row) => (
            <UpdateCard
              key={row.id}
              id={row.id}
              status={row.status}
              forDate={row.for_date}
              text={row.final_text ?? row.draft_text}
              photoCount={row.photo_count}
              woRef={row.work_orders?.wo_ref ?? ""}
              jobTitle={row.work_orders?.wo_snapshot?.jobTitle ?? ""}
            />
          ))}

          {rows.length === 0 && (
            <p className="empty" data-testid="updates-empty">
              Nothing drafted. Updates appear here after the day&rsquo;s ticks.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
