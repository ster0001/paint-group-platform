/**
 * The regression harness (master plan Step 6 — the accuracy gate's machinery).
 *
 * For every manifest pair with a plan on disk: push the plan through the REAL
 * pipeline (upload -> model read), then score the reading against the ground
 * truth extracted from the PaintScout estimate.
 *
 * WHAT IS SCORED TODAY, honestly:
 *   - door and window counts (the customer PDF prints them: "Windows (11)")
 *   - room/dimension coverage (how much of the plan came back measurable)
 * ceiling/wall m² and hours need PaintScout's internal quantities, which exist
 * only for the workbook jobs (and those are exteriors — the reader is
 * interior-only until Step 6 builds the envelope). So this run is a BASELINE
 * REPORT, not a pass/fail gate; the gate hardens as the set fills in.
 *
 * Results land in regression-set/results-<runstamp>.json so successive runs
 * are comparable as the prompt and pipeline change.
 *
 *   E2E_STAFF_EMAIL=... E2E_STAFF_PASSWORD=... npx tsx scripts/run-regression.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";

const ROOT = path.join(import.meta.dirname ?? __dirname, "..");
const SET = path.join(ROOT, "regression-set");
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

const env = Object.fromEntries(
  readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

type ManifestJob = {
  id: string; address: string; plan: string | null; estimate: string | null;
  jobType: string; note?: string; workbook?: boolean;
};
type Truth = { estimateId: string | null; doorsTotal: number; windowsTotal: number; areas: unknown[]; totalCents: number | null; jobType: string };

async function main() {
  const email = process.env.E2E_STAFF_EMAIL;
  const password = process.env.E2E_STAFF_PASSWORD;
  if (!email || !password) { console.error("Set E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD."); process.exit(1); }

  const manifest = JSON.parse(readFileSync(path.join(SET, "manifest.json"), "utf8")) as { jobs: ManifestJob[] };
  const truths = JSON.parse(readFileSync(path.join(SET, "ground-truth.json"), "utf8")) as Truth[];
  const truthById = new Map(truths.map((t) => [t.estimateId, t]));

  // Sign in THROUGH THE REAL LOGIN FORM and reuse the browser's request
  // context — hand-rolling the Supabase SSR cookie is a losing game (it is
  // base64-encoded and chunked), and the first version of this runner proved
  // it by getting 401 on every upload.
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  await sb.auth.signInWithPassword({ email, password });

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: BASE });
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/estimates/, { timeout: 20_000 });

  const results: Array<Record<string, unknown>> = [];

  const only = process.env.JOB_IDS ? new Set(process.env.JOB_IDS.split(",")) : null;
  for (const job of manifest.jobs) {
    if ((job as { ignored?: boolean }).ignored) { results.push({ id: job.id, skipped: "ignored per manifest" }); continue; }
    if (only && !only.has(job.id)) continue;
    if (!job.plan) { results.push({ id: job.id, address: job.address, skipped: "no plan supplied" }); continue; }
    const planPath = path.join(SET, job.plan);
    if (!existsSync(planPath)) { results.push({ id: job.id, skipped: `plan file missing: ${job.plan}` }); continue; }
    if (planPath.endsWith(".avif")) { results.push({ id: job.id, address: job.address, skipped: "AVIF not yet supported — needs transcoding" }); continue; }

    const bytes = readFileSync(planPath);
    const mime = planPath.endsWith(".png") ? "image/png" : "image/jpeg";

    // ---- upload -------------------------------------------------------------
    const up = await page.request.post(`/api/extract/floorplan?kind=floorplan`, {
      multipart: { file: { name: path.basename(planPath), mimeType: mime, buffer: bytes } },
    });
    const upJson = await up.json();
    if (!up.ok()) { results.push({ id: job.id, address: job.address, error: `upload: ${upJson.error}` }); continue; }
    const runId = upJson.primaryRunId as string;

    // ---- read ---------------------------------------------------------------
    process.stdout.write(`${job.id} ${job.address.slice(0, 38).padEnd(40)} reading… `);
    const read = await page.request.post(`/api/extract/${runId}/read`, { timeout: 300_000 });
    const r = await read.json();
    if (!read.ok()) { console.log("FAILED"); results.push({ id: job.id, address: job.address, error: `read: ${r.error}` }); continue; }

    // The raw reading carries the door/window counts regardless of style.
    const { data: run } = await sb.from("extraction_runs").select("raw_output, cost_cents").eq("id", runId).single();
    const reading = run?.raw_output as { rooms: Array<{ doors: unknown[]; windows: unknown[]; normalised_type: string }> } | null;
    const interiorRooms = (reading?.rooms ?? []).filter((x) => !["exterior", "unknown"].includes(x.normalised_type));
    const doorsSeen = interiorRooms.reduce((n, x) => n + x.doors.length, 0);
    const windowsSeen = interiorRooms.reduce((n, x) => n + x.windows.length, 0);

    const truth = job.estimate ? truthById.get(job.id) : undefined;
    const row = {
      id: job.id,
      address: job.address,
      jobType: job.jobType,
      runId,
      rooms: r.rooms,
      dimensioned: r.dimensioned,
      undimensioned: r.undimensioned,
      areasDrafted: r.areas,
      doorsSeen,
      windowsSeen,
      truthDoors: truth?.doorsTotal ?? null,
      truthWindows: truth?.windowsTotal ?? null,
      truthTotalCents: truth?.totalCents ?? null,
      usable: r.usable,
      costCents: r.costCents,
    };
    results.push(row);
    console.log(
      `rooms=${String(r.rooms).padStart(2)} dim=${String(r.dimensioned).padStart(2)} ` +
      `doors ${String(doorsSeen).padStart(2)}${truth ? `/${truth.doorsTotal}` : ""} ` +
      `windows ${String(windowsSeen).padStart(2)}${truth ? `/${truth.windowsTotal}` : ""} ${r.costCents}c`,
    );
  }

  const stamp = process.env.RUN_STAMP ?? "latest";
  writeFileSync(path.join(SET, `results-${stamp}.json`), JSON.stringify(results, null, 2));
  console.log(`\n${results.length} jobs -> regression-set/results-${stamp}.json`);
  console.log("Interior door/window deltas are the comparable numbers today; m2 and hours gates need the PaintScout quantity extraction for these jobs.");
  await browser.close();
}

main();
