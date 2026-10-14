/**
 * Induction content → the induction_* tables and standards_strings
 * (induction brief Step 4; rulings I8, ⚑3).
 *
 *   npx tsx scripts/seed-induction.ts            # TEST project (.env.test.local)
 *   SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-induction.ts --prod
 *
 * Reads docs/induction/induction-v1.md — the English words, the only source —
 * and every docs/induction/translations/<code>.json beside en.json. Each file
 * is checked against en.json first (same keys, no blanks): one bad file stops
 * the run before anything is written. Loads Version <file.version> of the
 * full induction: the version row, 13 modules, one induction_blocks row per
 * line per language, and the finish standards strings per language for the
 * CURRENT standards version (standards_strings). Idempotent: upserts on the
 * natural keys, removes rows of this version the files no longer carry, and
 * READS BACK through the app's own reader, refusing to exit 0 unless the
 * English on the tables equals the file and every language is complete.
 * Live flags are not touched: a language goes live in Settings (⚑3).
 * Target rule: seed-scripts-target. Migration 20270267 must be applied first.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { blockRows, blockStringKey, inductionStrings, parseInduction } from "../lib/induction/source";
import { checkTranslation, type TranslationFile } from "../lib/induction/translations";
import { isLanguageCode, type LanguageCode } from "../lib/induction/languages";
import { readInduction } from "../lib/induction/read";
import { readStandards } from "../lib/standards/read";
import { standardsStrings, STANDARDS_PREFIX } from "../lib/standards/strings";
import { localizedStandards } from "../lib/standards/localize";
import { loadTestEnv, refuseProduction, parseEnvFile } from "./c1/env.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const SOURCE = "docs/induction/induction-v1.md";
const TRANSLATIONS = "docs/induction/translations";
const PROD = process.argv.includes("--prod");
let url: string | undefined, key: string | undefined;
if (PROD) {
  if (process.env.SEED_ALLOW_PRODUCTION !== "1") { console.error("REFUSED: --prod needs SEED_ALLOW_PRODUCTION=1 — Tom runs this himself."); process.exit(1); }
  const env = parseEnvFile(resolve(ROOT, ".env.local")) as Record<string, string>;
  url = env.NEXT_PUBLIC_SUPABASE_URL; key = env.SUPABASE_SERVICE_ROLE_KEY;
} else {
  loadTestEnv();
  url = process.env.NEXT_PUBLIC_SUPABASE_URL; key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  refuseProduction(url ?? "");
}
if (!url || !key) { console.error("Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the target."); process.exit(1); }
console.log(`target: ${url.match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? url} (${PROD ? "PRODUCTION" : "test"})`);

function die(step: string, error: { message: string; code?: string } | null): never {
  console.error(`${step} failed: ${error?.message ?? "unknown"}${error?.code === "42P01" ? " — is migration 20270267 applied?" : ""}`);
  process.exit(1);
}

// 0. the files, checked before anything is written
const file = parseInduction(readFileSync(resolve(ROOT, SOURCE), "utf8"));
const en = JSON.parse(readFileSync(resolve(ROOT, TRANSLATIONS, "en.json"), "utf8")) as TranslationFile;
const enStrings = inductionStrings(file);
for (const [k, v] of Object.entries(enStrings)) {
  if (en.strings[k] !== v) { console.error(`en.json is behind ${SOURCE} at ${k} — regenerate it: npx tsx scripts/induction-strings.ts > ${TRANSLATIONS}/en.json`); process.exit(1); }
}
const translations = new Map<LanguageCode, TranslationFile>();
for (const name of readdirSync(resolve(ROOT, TRANSLATIONS)).filter((n) => n.endsWith(".json") && n !== "en.json").sort()) {
  const t = JSON.parse(readFileSync(resolve(ROOT, TRANSLATIONS, name), "utf8")) as TranslationFile;
  const problems = checkTranslation(t, en);
  if (problems.length) { console.error(`${name}: ${problems.length} problem(s)\n  ${problems.slice(0, 10).join("\n  ")}`); process.exit(1); }
  if (!isLanguageCode(t.language) || name !== `${t.language}.json`) { console.error(`${name}: language "${t.language}" does not match the file name`); process.exit(1); }
  translations.set(t.language, t);
}
console.log(`${file.modules.length} modules · ${Object.keys(enStrings).length} English lines · languages: en, ${[...translations.keys()].join(", ") || "(none)"}`);

async function main() {
  const db = createClient(url as string, key as string, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1. the version
  const v = await db.from("induction_versions")
    .upsert({ version_kind: "full", version_no: file.version, title: "Paint Group Contractor Induction", published_at: file.approvedOn, is_material: true, source_file: SOURCE }, { onConflict: "version_kind,version_no" })
    .select("id").single();
  if (v.error) die("version", v.error);
  const versionId = (v.data as { id: string }).id;

  // 2. the modules
  const m = await db.from("induction_modules")
    .upsert(file.modules.map((x, i) => ({ version_id: versionId, module_key: x.key, sort: i, title: x.title, minutes: x.minutes, standards_sections: x.standardsSections })), { onConflict: "version_id,module_key" })
    .select("id, module_key");
  if (m.error) die("modules", m.error);
  const idByKey = new Map(((m.data ?? []) as { id: string; module_key: string }[]).map((x) => [x.module_key, x.id]));
  const staleModules = await db.from("induction_modules").delete().eq("version_id", versionId).not("module_key", "in", `(${file.modules.map((x) => x.key).join(",")})`);
  if (staleModules.error) die("modules (stale)", staleModules.error);

  // 3. the blocks — one row per line per language
  const rows = blockRows(file);
  const languages: [LanguageCode, Record<string, string>][] = [["en", enStrings], ...[...translations.entries()].map(([code, t]) => [code, t.strings] as [LanguageCode, Record<string, string>])];
  const blockInserts = languages.flatMap(([language, strings]) => rows.map((r) => ({
    module_id: idByKey.get(r.module_key)!, line_key: r.line_key, kind: r.kind, sort: r.sort, audiences: r.audiences, language, text: strings[blockStringKey(r)],
  })));
  for (let i = 0; i < blockInserts.length; i += 500) {
    const b = await db.from("induction_blocks").upsert(blockInserts.slice(i, i + 500), { onConflict: "module_id,line_key,language" });
    if (b.error) die("blocks", b.error);
  }
  for (const mod of file.modules) {
    const keep = rows.filter((r) => r.module_key === mod.key).map((r) => r.line_key);
    const stale = await db.from("induction_blocks").delete().eq("module_id", idByKey.get(mod.key)!).not("line_key", "in", `(${keep.join(",")})`);
    if (stale.error) die(`blocks (stale, ${mod.key})`, stale.error);
    const staleLang = await db.from("induction_blocks").delete().eq("module_id", idByKey.get(mod.key)!).not("language", "in", `(${languages.map((l) => l[0]).join(",")})`);
    if (staleLang.error) die(`blocks (stale language, ${mod.key})`, staleLang.error);
  }

  // 4. the standards strings, per language, for the current standards version
  const std = await readStandards(db);
  if (!std.standards) die("standards", { message: std.error });
  const sv = await db.from("standards_versions").select("id").eq("version_no", std.standards.version.no).single();
  if (sv.error) die("standards version", sv.error);
  const stdVersionId = (sv.data as { id: string }).id;
  const enStd = standardsStrings(std.standards);
  let stdRows = 0;
  for (const [language, t] of translations) {
    const inserts = Object.keys(enStd).map((k) => ({ version_id: stdVersionId, language, key: k, text: t.strings[`${STANDARDS_PREFIX}${k}`] }));
    for (let i = 0; i < inserts.length; i += 500) {
      const s = await db.from("standards_strings").upsert(inserts.slice(i, i + 500), { onConflict: "version_id,language,key" });
      if (s.error) die(`standards strings (${language})`, s.error);
    }
    stdRows += inserts.length;
  }
  const staleStd = await db.from("standards_strings").delete().eq("version_id", stdVersionId).not("language", "in", `(${[...translations.keys()].join(",") || "en"})`);
  if (staleStd.error) die("standards strings (stale)", staleStd.error);

  // 5. read back through the app's own readers
  const back = await readInduction(db, "en");
  if (!back.induction) die("read-back", { message: back.error });
  const backStrings: Record<string, string> = {};
  for (const mod of back.induction.modules) {
    backStrings[`${mod.key}.title`] = mod.title;
    for (const s of mod.statements) backStrings[`${mod.key}.${s.lineKey}`] = s.text;
    for (const w of mod.workerExtra) backStrings[`${mod.key}.${w.lineKey}`] = w.text;
    backStrings[`${mod.key}.tick`] = mod.tick.text;
  }
  for (const [k, text] of Object.entries(enStrings)) {
    if (backStrings[k] !== text) { console.error(`read-back DIFFERS from the file at ${k}\n  file : ${text}\n  table: ${backStrings[k] ?? "(missing)"}`); process.exit(1); }
  }
  if (Object.keys(backStrings).length !== Object.keys(enStrings).length) { console.error("read-back has extra lines the file does not"); process.exit(1); }
  for (const [language] of translations) {
    const t = await readInduction(db, language);
    if (!t.induction) die(`read-back ${language}`, { message: t.error });
    if (t.induction.missing.length) { console.error(`${language}: ${t.induction.missing.length} line(s) fall back to English: ${t.induction.missing.slice(0, 8).join(", ")}`); process.exit(1); }
    const loc = await localizedStandards(db, std.standards, stdVersionId, language);
    if (loc.error || loc.missing.length) { console.error(`${language}: standards strings incomplete (${loc.error ?? `${loc.missing.length} missing`})`); process.exit(1); }
  }

  console.log(`Induction Version ${file.version} · approved ${file.approvedOn} · ${file.modules.length} modules · ${blockInserts.length} block rows (${languages.length} languages) · ${stdRows} standards strings`);
  console.log("read-back equals the files, every language complete ✓");
}

main().catch((e) => { console.error(e); process.exit(1); });
