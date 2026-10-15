import Link from "next/link";
import { redirect } from "next/navigation";
import { requireContractor } from "@/lib/contractor/session";
import { myLanguage } from "@/lib/induction/language";
import { loadInduction } from "@/lib/induction/load";
import { htmlLang, languageOf } from "@/lib/induction/languages";
import { modulesFor } from "@/lib/induction/read";
import { loadMyInduction } from "@/lib/induction/progress";
import { CHECK_TASKS, nextModule, painterInductionLine } from "@/lib/induction/status";

export const dynamic = "force-dynamic";

/**
 * The induction, module by module (brief §5): the modules of THIS login's
 * kind — full for a new painter, the refresher for an existing one (ruling
 * I13), the worker version for a worker login (⚑17) — each with its tick
 * state, the next one to do, and the completion screen once every tick is in.
 * With no language chosen it opens on the language screen. The step names,
 * the chrome and the demo job stay English; the titles and lines are in the
 * chosen language.
 */
export default async function InductionPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  await requireContractor();
  const { done } = await searchParams;
  const language = await myLanguage();
  if (!language) redirect("/portal/induction/language?next=/portal/induction");
  const [{ induction, error }, mine] = await Promise.all([loadInduction(), loadMyInduction()]);
  const lang = languageOf(language);
  if (!induction || !mine.status) {
    return (
      <div className="wrap" data-testid="induction">
        <h1>Induction</h1>
        <div className="err" role="alert" data-testid="induction-unavailable">{error ?? mine.error} Ring the office if this keeps happening.</div>
      </div>
    );
  }
  const status = mine.status;
  const modules = modulesFor(induction, status.kind);
  const ticked = new Set(status.modules.filter((m) => m.ticked).map((m) => m.key));
  const next = nextModule(status);
  const kindWord = status.kind === "worker" ? "Worker induction" : status.kind === "refresher" ? "Induction refresher" : "Contractor induction";

  // The completion screen: every module ticked (and the practical check, where there is one).
  if (status.complete && (done === "1" || !next)) {
    const tasks = CHECK_TASKS[status.kind];
    return (
      <div className="wrap signoff" data-testid="induction-done" data-language={language}>
        <span className="slab">All done</span>
        <h1>{kindWord} complete</h1>
        <div className="card">
          <div className="perk on"><span className="ic">✓</span><span>{status.total} of {status.total} modules ticked, in {lang.name}</span></div>
          <div className="perk on"><span className="ic">✓</span><span>{status.completedAt ? new Date(status.completedAt).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Melbourne" }) : "Today"} · Version {status.versionNo ?? induction.version.no}</span></div>
          <div className="perk on"><span className="ic">✓</span><span>A copy of everything you ticked is being saved in your documents{status.kind === "worker" ? "" : " and emailed to you"}</span></div>
          {tasks.length > 0 && (
            <div className={`perk ${status.checkPassed ? "on" : ""}`} data-testid="induction-check-line">
              <span className="ic">{status.checkPassed ? "✓" : "·"}</span>
              <span>{status.checkPassed ? "Practical check passed" : `Practical check with your facilitator: ${tasks.map((t) => t.label.toLowerCase()).join(", ")}`}</span>
            </div>
          )}
        </div>
        {status.kind === "full" && (
          <p className="hint" data-testid="induction-gate-line">Job offers start when the practical check is passed and your public liability insurance is on file.</p>
        )}
        {status.kind === "worker" && (
          <p className="hint" data-testid="induction-gate-line">{status.inductedAt ? "Your contractor can now put you on a job." : "Once the practical check is passed, your contractor can put you on a job."}</p>
        )}
        <Link href="/portal" className="btn cy" data-testid="induction-home">Go to my jobs</Link>
      </div>
    );
  }

  return (
    <div className="wrap" data-testid="induction" data-language={language} data-kind={status.kind}>
      <span className="slab">{kindWord} · Version {induction.version.no}</span>
      <h1>Your induction</h1>
      <p className="hint" style={{ padding: 0 }}>
        Reading in <b lang={htmlLang(language)}>{lang.nativeName}</b> ({lang.name}).{" "}
        <Link href="/portal/induction/language?next=/portal/induction" data-testid="induction-change-language">Change language</Link>
      </p>
      <div className="card">
        <div className="tick-head"><b>{status.ticked} of {status.total} ticked</b><span className="tick-count" data-testid="induction-progress">{painterInductionLine(status)}</span></div>
        <div className="signoff-progress" aria-label={`${status.ticked} of ${status.total} modules ticked`} style={{ gridTemplateColumns: `repeat(${Math.max(1, status.total)}, 1fr)`, marginTop: 8 }}>
          {modules.map((m) => <i key={m.key} className={ticked.has(m.key) ? "on" : ""} />)}
        </div>
        {status.kind === "refresher" && status.graceUntil && !status.complete && (
          <p className="hint" style={{ padding: 0, marginTop: 8, color: "var(--amber)" }} data-testid="induction-grace">{painterInductionLine(status)}</p>
        )}
        <div style={{ marginTop: 8 }}>
          {modules.map((m) => {
            const done = ticked.has(m.key);
            const isNext = m.key === next;
            return (
              <Link key={m.key} href={`/portal/induction/${m.key}`} className="act" data-testid={`induction-module-${m.key}`} data-ticked={done}
                style={isNext ? { borderColor: "var(--cyan)" } : undefined}>
                <i aria-hidden style={{ fontStyle: "normal", fontFamily: "var(--mono)", fontSize: 11, color: done ? "var(--emerald)" : undefined }}>{done ? "✓" : m.no === 0 ? "0" : m.no}</i>
                <span lang={htmlLang(language)} dir={induction.dir}>{m.title}</span>
                <span className="push"><span className={`chip ${done ? "grn" : isNext ? "cy" : "gry"}`}>{done ? "Ticked" : isNext ? "Next" : `${m.minutes} min`}</span></span>
              </Link>
            );
          })}
        </div>
        {next && <Link href={`/portal/induction/${next}`} className="btn cy" style={{ marginTop: 10 }} data-testid="induction-start">{status.ticked === 0 ? "Start" : "Continue"}</Link>}
      </div>
    </div>
  );
}
