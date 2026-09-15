/**
 * Backfill the Preparation line into every already-sent estimate snapshot.
 *
 * Why: until 15 Sep 2026 the per-job sundries allowance (Settings "Sundries per
 * job — interior/exterior") sat inside sent_snapshot.baseSubtotalCents but was
 * never listed, so the customer's visible items didn't add up to the subtotal
 * (Bill Flintoft, 27 Allenby Avenue). The customer page now shows a
 * "Preparation" line first. New sends write it; this script writes it into the
 * snapshots that were sent before the line existed.
 *
 * What it does, per estimate with a sent_snapshot:
 *   residual = baseSubtotalCents − Σ areas.priceCents − Σ lineItems.priceCents
 *   if residual > 0 and no `preparation` yet → set sent_snapshot.preparation
 *   (id "preparation", title, wording, priceCents = residual).
 * No money changes: baseSubtotalCents, totals, invoices and work orders are untouched.
 *
 * Usage (dry run by default — prints what it WOULD write):
 *   npx tsx scripts/backfill-preparation-line.ts --target test
 *   npx tsx scripts/backfill-preparation-line.ts --target prod --env /path/to/prod/.env.local --apply
 *
 * --target is REQUIRED and must match the project in the env file:
 *   test → .env.test.local (or SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY)
 *   prod → .env.local, or the file named by --env (a worktree's own .env.local may be the test project)
 * The script refuses to run if the URL's project ref doesn't match the target.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "fs";
import { PREPARATION_DESCRIPTION, PREPARATION_ID, PREPARATION_TITLE, type CustomerSnapshot } from "../lib/customer/snapshot";

const PROJECT_REFS = { prod: "llmrvgdequpmzzuaxdhq", test: "qarfyjrz" } as const;

function parseEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const target = args[args.indexOf("--target") + 1] as "test" | "prod" | undefined;
  const apply = args.includes("--apply");
  if (!args.includes("--target") || (target !== "test" && target !== "prod")) {
    console.error("Usage: --target test|prod [--apply]");
    process.exit(2);
  }
  const envFile = args.includes("--env") ? args[args.indexOf("--env") + 1] : "";
  if (args.includes("--env") && (!envFile || !existsSync(envFile))) { console.error(`--env: file not found: ${envFile}`); process.exit(2); }
  const env = {
    ...parseEnv(".env.local"),
    ...(target === "test" ? parseEnv(".env.test.local") : {}),
    ...process.env,
    ...(envFile ? parseEnv(envFile) : {}), // an explicit file wins over everything
  } as Record<string, string>;
  const url = target === "test" ? (env.SUPABASE_TEST_URL ?? env.NEXT_PUBLIC_SUPABASE_URL) : env.NEXT_PUBLIC_SUPABASE_URL;
  const key = target === "test" ? (env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY) : env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase URL / service key for target", target); process.exit(2); }
  if (!url.includes(PROJECT_REFS[target])) {
    console.error(`Refusing: --target ${target} but the URL is ${url} (expected project ${PROJECT_REFS[target]}…)`);
    process.exit(2);
  }
  console.log(`target=${target} url=${url} mode=${apply ? "APPLY" : "dry run"}`);

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.from("estimates").select("id, title, status, sent_snapshot").not("sent_snapshot", "is", null).limit(5000);
  if (error) throw error;

  let written = 0, skipped = 0;
  for (const e of data ?? []) {
    const snap = e.sent_snapshot as CustomerSnapshot;
    if (!snap || !Array.isArray(snap.areas)) { skipped++; continue; }
    if (snap.preparation !== undefined) { skipped++; continue; } // already carries the line
    const shown = snap.areas.reduce((n, a) => n + (a.priceCents || 0), 0) + (snap.lineItems ?? []).reduce((n, l) => n + (l.priceCents || 0), 0);
    const residual = (snap.baseSubtotalCents || 0) - shown;
    const preparation = residual > 0
      ? { id: PREPARATION_ID, title: PREPARATION_TITLE, descriptionHtml: `<p>${PREPARATION_DESCRIPTION}</p>`, priceCents: residual }
      : null;
    console.log(`${e.status.padEnd(9)} ${String(e.title).padEnd(40)} residual $${(residual / 100).toFixed(2).padStart(8)} → ${preparation ? "Preparation line" : "no line (parts already add up)"}`);
    if (!apply) continue;
    const { error: uErr } = await sb.from("estimates").update({ sent_snapshot: { ...snap, preparation } }).eq("id", e.id);
    if (uErr) throw uErr;
    written++;
  }
  console.log(`\n${data?.length ?? 0} snapshots; ${apply ? `${written} updated` : "0 written (dry run — add --apply)"}; ${skipped} skipped (already have the line or no areas).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
