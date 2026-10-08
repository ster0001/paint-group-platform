import { MOMENT_LABEL, momentState, type MomentRow } from "@/lib/workorder/reminderMoments";

const dmy = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); };

/**
 * The job's reminder moments on the painter's phone (brief §7, the mockup's
 * "App updates on this job"): each moment with its state, in short words.
 * Rows come from wo_reminder_moments (the painter reads their own job's);
 * before the first sweep plans them there is nothing to show.
 */
export default function UpdateMoments({ moments }: { moments: MomentRow[] }) {
  if (moments.length === 0) return null;
  const now = new Date();
  return (
    <div className="card" data-testid="update-moments">
      <div className="tick-head"><b>App updates on this job</b><span className="tick-count">{moments.filter((m) => m.answeredAt).length} / {moments.filter((m) => !m.skippedReason).length}</span></div>
      {moments.map((m) => {
        const st = momentState(m, now);
        return (
          <div className="act" key={m.id} data-testid={`moment-${m.kind}`} data-state={st}>
            <i aria-hidden style={{ color: st === "answered" ? "var(--emerald)" : st === "due" ? "var(--amber)" : "var(--muted)" }}>
              {st === "answered" ? "✓" : st === "due" ? "●" : st === "missed" ? "✕" : "○"}
            </i>
            <span>{MOMENT_LABEL[m.kind]}<br /><span style={{ fontSize: 12, color: "var(--muted)" }}>{dmy(m.day)}</span></span>
            <span className="push">
              <span className={`chip ${st === "answered" ? "grn" : st === "due" ? "amb" : st === "missed" ? "cly" : "gry"}`}>
                {st === "answered" ? "Answered" : st === "due" ? "Due today" : st === "skipped" ? "No work that day" : st === "missed" ? "Missed" : "Coming up"}
              </span>
            </span>
          </div>
        );
      })}
      <p className="hint">Update the same day you get the text and it counts. Up to 3 texts on the day, and they stop once you update.</p>
    </div>
  );
}
