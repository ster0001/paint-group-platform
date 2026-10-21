import Link from "next/link";
import { contextBlocks, lanes } from "@/lib/movements/evaluate";
import { loadMovementsWeek } from "@/lib/movements/load";
import { isDateString, todayIso } from "@/lib/scheduling/dates";
import { createClient } from "@/lib/supabase/server";
import RunList from "./RunList";
import { toSerial } from "../world";
import "../movements.css";

export const dynamic = "force-dynamic";

/**
 * /pc/movements/run?day=YYYY-MM-DD&who=me — a staff member's own run for the day, the
 * phone list the run-plan text links to (brief §3.4 "Phone"). `who=me` is the signed-in
 * staff profile; a profile id is accepted too (the Day view's "Open the phone list").
 * Staff only — the console layout already redirects anyone else.
 */
export default async function RunPage({ searchParams }: { searchParams: Promise<{ day?: string; who?: string }> }) {
  const sp = await searchParams;
  const day = sp.day && isDateString(sp.day) ? sp.day : todayIso();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const who = !sp.who || sp.who === "me" ? user?.id ?? null : sp.who;
  const week = await loadMovementsWeek(day, day, supabase);
  const ctx = contextBlocks(week.world);
  const all = lanes(week.world);
  // A staff lane by profile id, or an employee's painter lane (ONE lane per person, ⚑5).
  const lane = all.find((l) => l.id === who) ?? all.find((l) => l.kind === "painter" && week.world.painters.find((p) => p.contractorId === l.id)?.profileId === who) ?? null;

  return (
    <div className="mvx run">
      <p className="crumb"><Link href={`/pc/movements?view=day&day=${day}${who ? `&who=${who}` : ""}`}>‹ Movements · Day</Link></p>
      {week.failures.length > 0 && <div className="err" role="alert">{week.failures.map((f) => <div key={f}>{f}</div>)}</div>}
      {lane
        ? <RunList world={toSerial(week.world)} ctx={ctx} lane={lane} day={day} />
        : <div className="card"><h3>No lane for you on {day}</h3><p className="note">You are not in Settings → Movements → board people, so nothing can be placed on your day. Ask the office to add you.</p></div>}
    </div>
  );
}
