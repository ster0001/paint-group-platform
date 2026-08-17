import { createClient } from "@/lib/supabase/server";
import { loadBoard } from "@/lib/scheduling/board";
import { addDays, isDateString as isDate, localIso } from "@/lib/scheduling/dates";
import ScheduleBoard from "./ScheduleBoard";

export const dynamic = "force-dynamic";

// Staff scheduling timeline. Access is already gated by the (app) layout, which
// redirects anyone who isn't staff.
//
// The visible window lives in the URL so the DATA follows it. Without that,
// paging forward moved the columns but kept the originally-fetched blocks, and
// anything booked months out simply didn't appear.
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; days?: string }>;
}) {
  const sp = await searchParams;

  // Start a couple of days back so today isn't jammed against the left edge.
  const from = isDate(sp.from) ? sp.from : addDays(localIso(new Date()), -2);
  const RANGE = Math.min(112, Math.max(7, Number(sp.days) || 28));
  const to = addDays(from, RANGE);

  const board = await loadBoard(from, to);

  const supabase = await createClient();
  const { data: viewRow } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "scheduling_views")
    .maybeSingle();

  type SavedView = { id: string; name: string; tiers: string[]; contractorIds: string[]; onlyOfferable: boolean };
  const savedViews = Array.isArray(viewRow?.value) ? (viewRow!.value as SavedView[]) : [];

  return (
    <ScheduleBoard
      lanes={board.lanes}
      blocks={board.blocks}
      tray={board.tray}
      from={from}
      rangeDays={RANGE}
      savedViews={savedViews}
      approvals={board.approvals}
      errors={board.errors}
    />
  );
}
