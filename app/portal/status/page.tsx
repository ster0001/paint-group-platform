import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContractor } from "@/lib/contractor/session";
import { createClient } from "@/lib/supabase/server";
import { loadMyStatus } from "@/lib/painterStatus/mine";
import { DEFAULT_STATUS_RULES } from "@/lib/painterStatus/evaluate";
import { COLOUR_NAME, colourKey, measureLines, perksFor, tipsFor, weakestMeasure } from "@/lib/painterStatus/copy";
import TrafficLight from "@/app/components/status/TrafficLight";
import JobDots from "./JobDots";

export const dynamic = "force-dynamic";

/**
 * My status (brief §7, R18, R19): the light and the reason line; steps to
 * Green or the streak; what you get; the three measures as plain counts; the
 * last 10 jobs as dots; tips from the weakest measure; how the colours work.
 * Everything is read from painter_status and painter_job_results — nothing
 * here scores anything. No row (not a lead, or status staff-only) = 404.
 * No bonus amount anywhere (R14).
 */
export default async function MyStatusPage() {
  const { contractor, employmentType } = await requireContractor();
  if (!contractor) notFound();
  const supabase = await createClient();
  const { status, jobs, error } = await loadMyStatus(supabase, contractor.id);
  if (!status) notFound();
  const lead = employmentType === "employee";
  const rules = DEFAULT_STATUS_RULES;
  const lit = Math.min(status.streak, rules.greenRun);
  const left = rules.greenRun - lit;
  const weakest = weakestMeasure(status.measures);
  const bonusLeft = Math.max(0, rules.bonusEvery - status.bonusCounter);

  return (
    <div className={`wrap st-${status.colour}`} data-testid="my-status" data-colour={status.colour}>
      <Link href="/portal" className="back">‹ Home</Link>
      <div className="card statushead">
        <TrafficLight colour={status.colour} big />
        <div className="plain grow">
          <div className="eyebrow">{lead ? "Your status · jobs you led" : "Your status"}</div>
          <div className="statusname big" data-testid="status-word">{COLOUR_NAME[status.colour]}</div>
          <p data-testid="status-line">{status.line}</p>
        </div>
      </div>
      {error && <p className="err">Could not load your jobs just now. The status above is current.</p>}

      {status.colour === "green" ? (
        <div className="card">
          <div className="row">
            <div className="grow"><div className="eyebrow">Clean jobs in a row</div><div className="bignum" data-testid="streak">{status.streak}</div></div>
            <div className="small muted" style={{ textAlign: "right" }}>Your best<br /><span className="num">{status.bestStreak}</span></div>
          </div>
          <hr />
          <div className="row">
            <div className="grow"><div className="eyebrow">Next bonus review</div>
              <p className="small">{bonusLeft === 0 ? "Paint Group is reviewing a bonus now." : `${bonusLeft} more clean ${bonusLeft === 1 ? "job" : "jobs"} of ${rules.smallJobHours} hours or more.`}</p></div>
            <span className="pill info" data-testid="bonus-counter">{Math.min(status.bonusCounter, rules.bonusEvery)} of {rules.bonusEvery}</span>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="plain">
            <div className="row"><div className="eyebrow grow">Steps to Green</div><div className="num small" data-testid="steps-to-green">{lit} of {rules.greenRun}</div></div>
            <div className="ststeps">{Array.from({ length: rules.greenRun }, (_, i) => <i key={i} className={i < lit ? "on" : ""} />)}</div>
            <p className="small muted">{left === 0 ? "Done." : `${left} more clean ${left === 1 ? "job" : "jobs"} in a row to reach Green.`}</p>
          </div>
          {status.colour !== "new" && <><hr /><p className="small muted">Your best run so far: <span className="num">{status.bestStreak}</span> clean jobs in a row.</p></>}
        </div>
      )}

      <div className="card" data-testid="perks">
        <div className="eyebrow">What you get on {COLOUR_NAME[status.colour]}</div>
        {perksFor(status.colour, lead).map((p) => (
          <div key={p.text} className={`perk ${p.state}`}><span className="ic">{p.state === "on" ? "✓" : p.state === "warn" ? "!" : "·"}</span><span>{p.text}</span></div>
        ))}
      </div>

      <div className="card">
        <div className="eyebrow">{status.colour === "new" ? "Your jobs so far" : `Your last ${rules.lookback} jobs`}</div>
        {measureLines(status.measures).map((m) => (
          <div key={m.key} className="measure" data-testid={`measure-${m.key}`}>
            <span className="dot" style={{ "--c": m.band ? `var(--l-${m.band})` : "var(--track)" } as React.CSSProperties} />
            <b>{m.title}</b><span className="small muted">{m.line}</span>
          </div>
        ))}
        <hr />
        <JobDots jobs={jobs} slots={status.colour === "new" ? rules.newJobs : rules.lookback} smallJobHours={rules.smallJobHours} />
      </div>

      <div className="card" data-testid="tips">
        <div className="eyebrow">What to do next</div>
        <ol className="clean">{tipsFor(status.colour, weakest, lead).map((t) => <li key={t}>{t}</li>)}</ol>
      </div>

      <details className="card">
        <summary>How the colours work</summary>
        <p className="small muted">A clean job has every reminder answered, every check passed first time, and no call back in the {rules.windowDays} days after sign-off.</p>
        <div className="colourkey">
          {colourKey(lead).map((k) => (
            <div key={k.colour} className="colourrow">
              <span className="dot" style={{ "--c": `var(--l-${k.colour === "new" ? "blue" : k.colour})` } as React.CSSProperties} />
              <div><b>{COLOUR_NAME[k.colour]}</b><p className="small">{k.rule}</p><p className="small muted">{k.gets}</p></div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
