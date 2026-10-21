import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireContractor } from "@/lib/contractor/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { myLanguage } from "@/lib/induction/language";
import { loadInduction } from "@/lib/induction/load";
import { htmlLang, languageOf } from "@/lib/induction/languages";
import { linesFor, modulesFor } from "@/lib/induction/read";
import { loadMyInduction, myDemoWorkOrderId } from "@/lib/induction/progress";
import { SIGN_SECTIONS } from "@/lib/standards/acks";
import { loadMyStandards } from "@/lib/standards/status";
import { loadDemoChecklist } from "@/lib/demo/checklistLoad";
import { DEMO_STEPS } from "@/lib/demo/checklist";
import TickStep from "../TickStep";

export const dynamic = "force-dynamic";

/**
 * One module: the Read-and-confirm lines in the painter's language, the "On
 * your phone" steps with their LIVE state from the practice job (brief §4.2),
 * then the tick (Step 5). Module 5 is the six standards sections — a
 * contractor ticks them on the sign-off (one writer); a worker login ticks
 * each section here. A ticked module shows its tick and the way on. The
 * `lang` and `dir` attributes sit on the translated text, never on the page.
 */
export default async function InductionModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { capabilities, contractor } = await requireContractor();
  const { module: key } = await params;
  if (!/^m\d{2}$/.test(key)) notFound();
  const language = await myLanguage();
  if (!language) redirect(`/portal/induction/language?next=/portal/induction/${key}`);
  const [{ induction, error }, mine] = await Promise.all([loadInduction(), loadMyInduction()]);
  if (!induction || !mine.status) {
    return <div className="wrap"><h1>Induction</h1><div className="err" role="alert">{error ?? mine.error}</div></div>;
  }
  const status = mine.status;
  const siblings = modulesFor(induction, status.kind);
  const pos = siblings.findIndex((x) => x.key === key);
  if (pos === -1) notFound();
  const m = siblings[pos];
  const lines = linesFor(m, status.kind);
  const lang = htmlLang(language);
  const dir = induction.dir;
  const prev = siblings[pos - 1];
  const next = siblings[pos + 1];
  const state = status.modules.find((x) => x.key === key);
  const already = state?.ticked ?? false;
  const fallback = [...lines, m.tick].filter((l) => !l.translated).length;
  const nextHref = next ? `/portal/induction/${next.key}` : "/portal/induction?done=1";

  // "On your phone": the demo checklist steps of this module, live from the practice job.
  const supabase = await createClient();
  const service = createServiceClient();
  const demoId = await myDemoWorkOrderId(supabase, capabilities.isWorker);
  const checklist = demoId && service ? await loadDemoChecklist(service, demoId) : null;
  const steps = (checklist ?? DEMO_STEPS.map((s) => ({ ...s, done: false, detail: "" }))).filter((s) => s.module === m.no);

  // Module 5: the six standards sections and their tick state.
  let sections: { key: string; title: string; ticked: boolean }[] = [];
  if (m.standardsSections.length) {
    if (capabilities.isWorker) {
      const done = new Set(state?.sections ?? []);
      sections = SIGN_SECTIONS.filter((s) => m.standardsSections.includes(s.key)).map((s) => ({ key: s.key, title: s.title, ticked: done.has(s.key) }));
    } else {
      const my = contractor ? (await loadMyStandards(supabase, contractor.id)).my : null;
      sections = SIGN_SECTIONS.filter((s) => m.standardsSections.includes(s.key)).map((s) => ({ key: s.key, title: s.title, ticked: my?.acked.has(s.key) ?? false }));
    }
  }
  const nextSection = sections.find((s) => !s.ticked) ?? null;

  return (
    <div className="wrap std" data-testid="induction-module" data-module={key} data-language={language} data-ticked={already}>
      <div className="std-row">
        <span className="std-eyebrow grow">Module {pos + 1} of {siblings.length}</span>
        <Link href="/portal/induction" className="std-link" data-testid="induction-back">‹ All modules</Link>
      </div>
      <div className="signoff-progress" aria-label={`${status.ticked} of ${status.total} modules ticked`} style={{ gridTemplateColumns: `repeat(${Math.max(1, siblings.length)}, 1fr)` }}>
        {siblings.map((x) => <i key={x.key} className={status.modules.find((y) => y.key === x.key)?.ticked || x.key === key ? "on" : ""} />)}
      </div>
      <h1 lang={lang} dir={dir} data-testid="induction-module-title">{m.title}</h1>
      <p className="hint" style={{ padding: 0 }}>Read and confirm · {m.minutes} min</p>
      {state?.changeNote && (
        <div className="card amberish" data-testid="induction-change-note">
          <span className="chip amb">What changed</span>
          <p style={{ marginTop: 8 }}>{state.changeNote}</p>
        </div>
      )}
      {fallback > 0 && (
        <p className="hint" role="status" style={{ padding: 0, color: "var(--amber)" }} data-testid="induction-fallback">
          {fallback} line{fallback === 1 ? "" : "s"} shown in English until the {languageOf(language).name} wording is ready.
        </p>
      )}
      <div className="card" data-testid="induction-lines">
        {/* Tom, 21 Oct 2026: one bullet per line, with air between them, so each point reads on its own. */}
        <ul className="ind-lines" lang={lang} dir={dir}>
          {lines.map((l) => (
            <li key={l.lineKey} data-testid={`induction-line-${l.lineKey}`} data-translated={l.translated}>{l.text}</li>
          ))}
        </ul>
      </div>

      {steps.length > 0 && (
        <div className="card" data-testid="induction-phone-steps">
          <h3>On your phone</h3>
          <p className="hint" style={{ padding: 0 }}>{demoId ? "Live from your practice job, 12 Demo Street." : "Your practice job is not set up yet — start it from the Jobs tab."}</p>
          <ul className="clean" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 6 }}>
            {steps.map((s) => (
              <li key={s.key} data-testid={`induction-phone-${s.key}`} data-done={s.done} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13.5 }}>
                <span style={{ color: s.done ? "var(--emerald)" : "var(--muted)" }}>{s.done ? "✓" : "·"}</span>
                <span>{s.label}{s.detail ? <span className="hint" style={{ padding: 0, marginLeft: 6 }}>{s.detail}</span> : null}</span>
              </li>
            ))}
          </ul>
          {demoId && <Link href={`/portal/jobs/${demoId}`} className="btn gh" style={{ marginTop: 10 }} data-testid="induction-open-demo">Open 12 Demo Street</Link>}
        </div>
      )}

      {sections.length > 0 && (
        <div className="card" data-testid="induction-standards-links">
          <h3>The six sections, in your language</h3>
          <p className="hint" style={{ padding: 0 }}>
            {capabilities.isWorker ? "Read each section under Help, then tick it here." : "Module 5 is the finish standards sign-off itself. Open each section, read it, and tick it there."}
          </p>
          <div style={{ marginTop: 8 }}>
            {sections.map((s) => (
              <Link key={s.key} href={capabilities.isWorker ? `/portal/help/standards/s/${s.key}` : `/portal/standards/confirm?s=${s.key}`} className="act"
                data-testid={`induction-standards-${s.key}`} data-ticked={s.ticked}>
                <i aria-hidden style={{ fontStyle: "normal", color: s.ticked ? "var(--emerald)" : undefined }}>{s.ticked ? "✓" : "📘"}</i>
                <span>{s.title}</span>
                <span className="push"><span className={`chip ${s.ticked ? "grn" : "gry"}`}>{s.ticked ? "Ticked" : "Read"}</span></span>
              </Link>
            ))}
          </div>
          {capabilities.isWorker && nextSection && (
            <TickStep key={nextSection.key} module="m05" section={nextSection.key} lang={lang} dir={dir}
              statement={`${nextSection.title} — I have read and understand this`} last={!next && sections.filter((s) => !s.ticked).length === 1}
              nextHref={sections.filter((s) => !s.ticked).length > 1 ? `/portal/induction/${key}` : nextHref} doneHref="/portal/induction?done=1" />
          )}
        </div>
      )}

      {already || (sections.length > 0 && !capabilities.isWorker && !nextSection) ? (
        <div className="signoff-foot" data-testid="induction-already">
          <div className="std-note" lang={lang} dir={dir} data-testid="induction-tick-statement"><b>✓</b> {m.tick.text}</div>
          <p className="hint" style={{ padding: 0 }}>Ticked.</p>
          <Link href={nextHref} className="btn cy" data-testid="induction-next">{next ? "Next module" : "Finish"}</Link>
        </div>
      ) : sections.length > 0 ? (
        !capabilities.isWorker && (
          <div className="signoff-foot" data-testid="induction-standards-pending">
            <p className="hint" style={{ padding: 0 }}>{sections.filter((s) => s.ticked).length} of 6 sections ticked. The module is ticked when all six are.</p>
            {nextSection && <Link href={`/portal/standards/confirm?s=${nextSection.key}`} className="btn cy" data-testid="induction-next">Read and tick the next section</Link>}
          </div>
        )
      ) : (
        <TickStep key={key} module={key} statement={m.tick.text} lang={lang} dir={dir} last={!next} nextHref={nextHref} doneHref="/portal/induction?done=1" />
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
        {prev ? <Link href={`/portal/induction/${prev.key}`} className="btn gh" data-testid="induction-prev">‹ Back</Link> : <span />}
        {next && already ? <Link href={`/portal/induction/${next.key}`} className="btn gh" data-testid="induction-skip">Skip ahead ›</Link> : <span />}
      </div>
    </div>
  );
}
