/**
 * Import the Brain seed as DRAFTS (assistant S6 / D14).
 *
 *   npx tsx scripts/import-brain.ts                 # production (.env.local)
 *   npx tsx scripts/import-brain.ts --env .env.test.local
 *
 * Idempotent on (tenant, slug). Re-running updates question/audience/needs_
 * content and — ONLY for entries still in draft — the answer text; an
 * approved entry's answer is Tom's and is never overwritten by the seed.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseBrainSeed, tokeniseSeedAnswer } from "../lib/brain/parse";

const envFile = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env.local";
const env = Object.fromEntries(
  readFileSync(new URL(`../${envFile}`, import.meta.url), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const md = readFileSync(new URL("../docs/brain/brain-v1.md", import.meta.url), "utf8");
  const entries = parseBrainSeed(md);
  const { data: existing, error } = await sb.from("brain_entries").select("id, slug, status");
  if (error) { console.error(error.message); process.exit(1); }
  const bySlug = new Map((existing ?? []).map((r) => [r.slug as string, r as { id: string; status: string }]));
  let inserted = 0, updated = 0, kept = 0;
  for (const e of entries) {
    const answer = tokeniseSeedAnswer(e.slug, e.answerMd);
    const row = bySlug.get(e.slug);
    if (!row) {
      const { error: ie } = await sb.from("brain_entries").insert({ slug: e.slug, topic: e.topic, question: e.question, answer_md: answer, audience: e.audience, status: "draft", needs_content: e.needsContent });
      if (ie) { console.error(`${e.slug}: ${ie.message}`); process.exit(1); }
      inserted++;
    } else if (row.status === "draft") {
      const { error: ue } = await sb.from("brain_entries").update({ topic: e.topic, question: e.question, answer_md: answer, audience: e.audience, needs_content: e.needsContent }).eq("id", row.id);
      if (ue) { console.error(`${e.slug}: ${ue.message}`); process.exit(1); }
      updated++;
    } else {
      // Approved = Tom's words. Only the flags follow the seed.
      await sb.from("brain_entries").update({ audience: e.audience }).eq("id", row.id);
      kept++;
    }
  }
  console.log(`${entries.length} entries in the seed · ${inserted} inserted · ${updated} draft(s) refreshed · ${kept} approved kept`);
  console.log(`needs_content (never served): ${entries.filter((e) => e.needsContent).map((e) => e.slug).join(", ")}`);
}
main();
