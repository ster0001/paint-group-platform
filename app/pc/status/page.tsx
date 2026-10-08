import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";
import type { Colour, Measures } from "@/lib/painterStatus/evaluate";

export const dynamic = "force-dynamic";

/**
 * Painter status, Step 5: a plain staff table of what the evaluator wrote.
 * No design yet — the Contractors view (Step 7) is the real screen; this
 * exists so the office can see the colour, the streak and the three measures
 * behind each one the day the evaluator goes live, and so the e2e has a
 * surface to read. Everything on it is a row of painter_status; nothing is
 * computed here.
 */
type StatusRow = {
  painter_id: string; colour: Colour; streak: number; best_streak: number; measures: Partial<Measures> & { stepsToGreen?: number };
  bonus_counter: number; line: string; computed_at: string;
  contractors: { company_name: string | null; employment_type: string | null; active: boolean; profiles: { name: string | null } | null } | null;
};
type ResultRow = { painter_id: string; result: "pending" | "clean" | "not_clean" };

const COLOUR_LABEL: Record<Colour, string> = { new: "New", green: "Green", yellow: "Yellow", orange: "Orange", red: "Red" };
const ORDER: Record<Colour, number> = { red: 0, orange: 1, yellow: 2, new: 3, green: 4 };
const when = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function PainterStatusPage() {
  const supabase = await createClient();
  const [status, results] = await Promise.all([
    supabase.from("painter_status").select("painter_id, colour, streak, best_streak, measures, bonus_counter, line, computed_at, contractors(company_name, employment_type, active, profiles(name))"),
    supabase.from("painter_job_results").select("painter_id, result"),
  ]);
  const failures: string[] = [];
  if (status.error) { reportError(status.error, { where: "pc.status.rows" }); failures.push("painter status"); }
  if (results.error) { reportError(results.error, { where: "pc.status.results" }); failures.push("job results"); }

  const counts = new Map<string, { pending: number; clean: number; notClean: number }>();
  for (const r of (results.data ?? []) as ResultRow[]) {
    const c = counts.get(r.painter_id) ?? { pending: 0, clean: 0, notClean: 0 };
    if (r.result === "pending") c.pending++; else if (r.result === "clean") c.clean++; else c.notClean++;
    counts.set(r.painter_id, c);
  }
  const rows = ((status.data ?? []) as unknown as StatusRow[])
    .filter((r) => r.contractors?.active !== false)
    .sort((a, b) => ORDER[a.colour] - ORDER[b.colour] || (a.contractors?.profiles?.name ?? "").localeCompare(b.contractors?.profiles?.name ?? ""));

  return (
    <section className="card" data-testid="painter-status">
      <h2 style={{ margin: "0 0 4px" }}>Painter status</h2>
      <p className="muted" style={{ margin: "0 0 12px" }}>
        What the evaluator wrote — recomputed every half hour from checks, update texts and call backs on signed-off jobs.
        A job counts seven days after sign-off. The Contractors view with the full design comes in a later step.
      </p>
      {failures.length > 0 && <p className="err" data-testid="painter-status-failed">Could not load {failures.join(" and ")}. Try again shortly.</p>}
      {rows.length === 0 && failures.length === 0 && <p className="muted">No painter has been evaluated yet. The daily sweep seeds every active painter as New.</p>}
      {rows.length > 0 && (
        <table className="table" style={{ width: "100%", fontSize: 14 }}>
          <thead>
            <tr><th>Painter</th><th>Status</th><th>Streak</th><th>Jobs</th><th>Checks</th><th>Updates</th><th>Call backs</th><th>Bonus</th><th>Why</th><th>Computed</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = counts.get(r.painter_id) ?? { pending: 0, clean: 0, notClean: 0 };
              const m = r.measures ?? {};
              const name = r.contractors?.profiles?.name ?? r.contractors?.company_name ?? "—";
              return (
                <tr key={r.painter_id} data-testid={`painter-status-row-${r.painter_id}`} data-colour={r.colour}>
                  <td>{name}{r.contractors?.employment_type === "employee" ? <span className="muted"> · employee</span> : null}</td>
                  <td><b>{COLOUR_LABEL[r.colour]}</b>{r.colour !== "green" && m.stepsToGreen ? <span className="muted"> · {m.stepsToGreen} to Green</span> : null}</td>
                  <td>{r.streak} <span className="muted">(best {r.best_streak})</span></td>
                  <td>{c.clean} clean · {c.notClean} not clean{c.pending ? ` · ${c.pending} pending` : ""}</td>
                  <td>{m.checks ? `${m.checks.passedFirstTime}/${m.checks.done} first time` : "—"}</td>
                  <td>{m.reminders ? `${m.reminders.answered}/${m.reminders.scored}${m.reminders.creditsApplied ? ` (+${m.reminders.creditsApplied} credit)` : ""}` : "—"}</td>
                  <td>{m.callbacks ? m.callbacks.scored : "—"}</td>
                  <td>{r.colour === "green" ? `${r.bonus_counter} of 4` : "—"}</td>
                  <td className="muted">{r.line}</td>
                  <td className="muted">{when.format(new Date(r.computed_at))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
