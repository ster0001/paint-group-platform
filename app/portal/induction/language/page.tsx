import { requireContractor } from "@/lib/contractor/session";
import { createClient } from "@/lib/supabase/server";
import { myLanguage, offeredLanguagesWith } from "@/lib/induction/language";
import LanguagePicker from "../LanguagePicker";

export const dynamic = "force-dynamic";

/**
 * "Choose your language" — the first screen of the induction (Module 1;
 * ruling I8). What the painter reads and ticks to confirm is in this
 * language, including the standards; the app, the slides and the demo job
 * stay English. Only languages staff have switched on are offered (⚑3).
 * Reachable again later from Home, the induction and the profile: the
 * record keeps the language they confirmed in (Step 5).
 */
export default async function InductionLanguagePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireContractor();
  const { next } = await searchParams;
  const supabase = await createClient();
  const [{ languages, error }, current] = await Promise.all([offeredLanguagesWith(supabase), myLanguage()]);
  const to = next && next.startsWith("/portal") ? next : "/portal/induction";
  return (
    <div className="wrap" data-testid="induction-language">
      <span className="slab">Induction · step 1</span>
      <h1>Choose your language</h1>
      <p className="hint" style={{ padding: 0 }}>What you read and tick to confirm is in your language, including the finish standards. The app and the practice job stay in English, with short words and pictures.</p>
      {error && <p className="hint" role="status" style={{ color: "var(--amber)", padding: 0 }}>Only English could be offered just now ({error}).</p>}
      <div className="card">
        <LanguagePicker languages={languages} current={current} next={to} />
      </div>
      {languages.length === 1 && <p className="hint" style={{ padding: 0 }}>Other languages appear here once Paint Group has tested them.</p>}
    </div>
  );
}
