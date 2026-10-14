import Link from "next/link";
import { redirect } from "next/navigation";
import { requireContractor } from "@/lib/contractor/session";
import { myLanguage } from "@/lib/induction/language";
import { loadInduction } from "@/lib/induction/load";
import { htmlLang, languageOf } from "@/lib/induction/languages";
import { moduleForWorker } from "@/lib/induction/read";

export const dynamic = "force-dynamic";

/**
 * The induction, module by module (brief §5; Step 4 = the content in the
 * painter's language; Step 5 adds the ticks, the practical check and the
 * completion). With no language chosen it opens on the language screen.
 * A worker sees the worker version: only the modules with worker lines
 * (ruling ⚑17). The step names, the chrome and the demo job stay English;
 * the module titles and the lines are in the chosen language.
 */
export default async function InductionPage() {
  const { capabilities } = await requireContractor();
  const language = await myLanguage();
  if (!language) redirect("/portal/induction/language?next=/portal/induction");
  const { induction, error } = await loadInduction();
  const lang = languageOf(language);
  if (!induction) {
    return (
      <div className="wrap" data-testid="induction">
        <h1>Induction</h1>
        <div className="err" role="alert" data-testid="induction-unavailable">{error} Ring the office if this keeps happening.</div>
      </div>
    );
  }
  const modules = capabilities.isWorker ? induction.modules.filter(moduleForWorker) : induction.modules;
  return (
    <div className="wrap" data-testid="induction" data-language={language}>
      <span className="slab">{capabilities.isWorker ? "Worker induction" : "Contractor induction"} · Version {induction.version.no}</span>
      <h1>Your induction</h1>
      <p className="hint" style={{ padding: 0 }}>
        Reading in <b lang={htmlLang(language)}>{lang.nativeName}</b> ({lang.name}).{" "}
        <Link href="/portal/induction/language?next=/portal/induction" data-testid="induction-change-language">Change language</Link>
      </p>
      <div className="card">
        <h3>{modules.length} modules</h3>
        <p className="hint" style={{ padding: 0 }}>Each module is a few lines to read and confirm in your language. The facilitator runs the slides and the practice job with you on the day.</p>
        <div style={{ marginTop: 8 }}>
          {modules.map((m) => (
            <Link key={m.key} href={`/portal/induction/${m.key}`} className="act" data-testid={`induction-module-${m.key}`}>
              <i aria-hidden style={{ fontStyle: "normal", fontFamily: "var(--mono)", fontSize: 11 }}>{m.no}</i>
              <span lang={htmlLang(language)} dir={induction.dir}>{m.title}</span>
              <span className="push"><span className="chip gry">{m.minutes} min</span></span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
