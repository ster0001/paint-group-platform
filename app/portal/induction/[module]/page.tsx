import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireContractor } from "@/lib/contractor/session";
import { myLanguage } from "@/lib/induction/language";
import { loadInduction } from "@/lib/induction/load";
import { htmlLang, languageOf } from "@/lib/induction/languages";
import { moduleForWorker, workerLines } from "@/lib/induction/read";
import { SIGN_SECTIONS } from "@/lib/standards/acks";

export const dynamic = "force-dynamic";

/**
 * One module: the Read-and-confirm lines in the painter's language, then the
 * tick statement (the tick itself lands in Step 5). Module 5 is the six
 * standards sections — its lines link to the sign-off, which reads the
 * standards in the same language. A worker sees their lines only (⚑17).
 * The `lang` and `dir` attributes sit on the translated text, never on the
 * page: the chrome stays English and left-to-right.
 */
export default async function InductionModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { capabilities } = await requireContractor();
  const { module: key } = await params;
  if (!/^m\d{2}$/.test(key)) notFound();
  const language = await myLanguage();
  if (!language) redirect(`/portal/induction/language?next=/portal/induction/${key}`);
  const { induction, error } = await loadInduction();
  if (!induction) {
    return <div className="wrap"><h1>Induction</h1><div className="err" role="alert">{error}</div></div>;
  }
  const m = induction.modules.find((x) => x.key === key);
  if (!m || (capabilities.isWorker && !moduleForWorker(m))) notFound();
  const lines = capabilities.isWorker ? workerLines(m) : m.statements;
  const lang = htmlLang(language);
  const dir = induction.dir;
  const index = induction.modules.findIndex((x) => x.key === key);
  const siblings = capabilities.isWorker ? induction.modules.filter(moduleForWorker) : induction.modules;
  const pos = siblings.findIndex((x) => x.key === key);
  const prev = siblings[pos - 1];
  const next = siblings[pos + 1];
  const fallback = [...lines, m.tick].filter((l) => !l.translated).length;

  return (
    <div className="wrap std" data-testid="induction-module" data-module={key} data-language={language}>
      <div className="std-row">
        <span className="std-eyebrow grow">Module {m.no} of {induction.modules.length}</span>
        <Link href="/portal/induction" className="std-link" data-testid="induction-back">‹ All modules</Link>
      </div>
      <h1 lang={lang} dir={dir} data-testid="induction-module-title">{m.title}</h1>
      <p className="hint" style={{ padding: 0 }}>Read and confirm · {m.minutes} min</p>
      {fallback > 0 && (
        <p className="hint" role="status" style={{ padding: 0, color: "var(--amber)" }} data-testid="induction-fallback">
          {fallback} line{fallback === 1 ? "" : "s"} shown in English until the {languageOf(language).name} wording is ready.
        </p>
      )}
      <div className="card" data-testid="induction-lines">
        <ol className="std-clean" lang={lang} dir={dir} style={{ margin: 0 }}>
          {lines.map((l) => (
            <li key={l.lineKey} data-testid={`induction-line-${l.lineKey}`} data-translated={l.translated} style={{ fontSize: 15, lineHeight: 1.5 }}>{l.text}</li>
          ))}
        </ol>
      </div>
      {m.standardsSections.length > 0 && (
        <div className="card" data-testid="induction-standards-links">
          <h3>The six sections, in your language</h3>
          <p className="hint" style={{ padding: 0 }}>Module {m.no} is the finish standards sign-off itself. Open each section, read it, and tick it there.</p>
          <div style={{ marginTop: 8 }}>
            {SIGN_SECTIONS.filter((s) => m.standardsSections.includes(s.key)).map((s) => (
              <Link key={s.key} href={`/portal/standards/confirm?s=${s.key}`} className="act" data-testid={`induction-standards-${s.key}`}>
                <i aria-hidden>📘</i><span>{s.title}</span><span className="push">›</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="std-note" lang={lang} dir={dir} data-testid="induction-tick-statement">
        <b>✓</b> {m.tick.text}
      </div>
      <p className="hint" style={{ padding: 0 }}>The tick is recorded in the induction session with your facilitator.</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
        {prev ? <Link href={`/portal/induction/${prev.key}`} className="btn gh" data-testid="induction-prev">‹ Module {prev.no}</Link> : <span />}
        {next ? <Link href={`/portal/induction/${next.key}`} className="btn cy" data-testid="induction-next">Module {next.no} ›</Link> : <Link href="/portal/induction" className="btn cy">All modules</Link>}
      </div>
      <span style={{ display: "none" }} data-testid="induction-module-index">{index}</span>
    </div>
  );
}
