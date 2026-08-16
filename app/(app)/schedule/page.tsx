import { createClient } from "@/lib/supabase/server";
import { loadBoard } from "@/lib/scheduling/board";
import ScheduleBoard from "./ScheduleBoard";

export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Staff scheduling timeline. Access is already gated by the (app) layout, which
// redirects anyone who isn't staff.
export default async function SchedulePage() {
  // Start a couple of days back so today isn't jammed against the left edge.
  const start = new Date();
  start.setDate(start.getDate() - 2);
  const from = iso(start);
  const RANGE = 28;
  const to = iso(new Date(start.getTime() + RANGE * 86_400_000));

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
    />
  );
}
