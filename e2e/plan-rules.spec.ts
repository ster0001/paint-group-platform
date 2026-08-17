import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Tom's rules, checked against the real pipeline.
 *
 *   1. cornices are never standard
 *   2. bathrooms and ensuites get ceiling and door only
 *   3. a door or window of unknown type is not priced
 *   4. the ceiling height is required before anything is drafted
 */
const staff = credentials("STAFF");
const fixture = readFileSync("lib/extract/__fixtures__/two-page-plan.pdf");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const door = (style: string) => ({ type: "internal_hinged", style, style_confidence: style === "unknown" ? 0.1 : 0.9, width_m: 0.82, confidence: 0.9 });
const window_ = (style: string) => ({ size_class: "medium", style, style_confidence: style === "unknown" ? 0.1 : 0.9, confidence: 0.9 });
const room = (over: Record<string, unknown>) => ({
  name_on_plan: "Bedroom 1", normalised_type: "bedroom", storey: "Ground",
  length_m: 4.1, width_m: 3.7, dimension_source: "read", dimension_confidence: 0.9,
  area_m2_printed: null, irregular: false, cornice: "unknown",
  doors: [door("unknown")], windows: [window_("unknown")],
  openings_no_door: 0, wet_area: false, notes_read_from_plan: "", ...over,
});
const READING = {
  storeys: [{ label: "Ground", kind: "ground", stated_area_m2: null }],
  scale: { method: "labelled_dimensions", stated_total_area_m2: null, not_to_scale_disclaimer: false, confidence: 0.9 },
  ceiling_height_m: null, has_site_plan: false, unreadable_regions: [],
  rooms: [
    room({}),                                                          // unknown door + window + cornice
    room({ name_on_plan: "Bedroom 2", doors: [door("panel")], windows: [window_("double_hung_sash")], cornice: "present" }),
    room({ name_on_plan: "Ens", normalised_type: "bathroom", doors: [door("flat")], windows: [] }),
  ],
};

test.describe("the scanner rules", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(process.env.E2E_EXTRACT_READY !== "1", "needs migration 20260910000000");

  test("nothing uncertain gets priced, and the height is compulsory", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    await sb.auth.signInWithPassword({ email: staff!.email, password: staff!.password });

    const up = await page.request.post("/api/extract/floorplan?kind=floorplan", {
      multipart: { file: { name: "plan.pdf", mimeType: "application/pdf", buffer: fixture } },
    });
    const runId = (await up.json()).primaryRunId as string;
    await sb.from("extraction_runs").update({ raw_output: READING, status: "needs_review" }).eq("id", runId);

    // ---- rule 4: no height, no draft ---------------------------------------
    const noHeight = await page.request.post(`/api/extract/${runId}/apply`, { data: {} });
    expect(noHeight.status()).toBe(400);

    const applied = await page.request.post(`/api/extract/${runId}/apply`, { data: { ceilingHeightM: 2.7 } });
    expect(applied.status()).toBe(200);
    const result = await applied.json();
    const estimateId = result.estimateId as string;

    const { data: est } = await sb.from("estimates").select("builder_state").eq("id", estimateId).single();
    const blocks = (est!.builder_state as { blocks: Array<Record<string, never>> }).blocks as unknown as Array<{
      name: string; H: number; surfaces: Array<{ internalLabel: string; code: string; count: number }>;
    }>;

    const bed1 = blocks.find((b) => b.name === "Bedroom 1")!;
    const bed2 = blocks.find((b) => b.name === "Bedroom 2")!;
    const ens = blocks.find((b) => b.name === "Ens")!;

    // ---- rule 4: the confirmed height reached every room --------------------
    for (const b of blocks) expect(b.H).toBe(2.7);

    // ---- rule 3: unknown types are not priced ------------------------------
    const bed1Labels = bed1.surfaces.map((s) => s.internalLabel);
    expect(bed1Labels).toContain("Walls");
    expect(bed1Labels.some((l) => /door/i.test(l))).toBe(false);
    expect(bed1Labels.some((l) => /window/i.test(l))).toBe(false);
    // ...but they are reported as decisions, not lost
    const deferred = result.deferred as Array<{ room: string; what: string }>;
    expect(deferred.some((d) => d.room === "Bedroom 1" && d.what.includes("door"))).toBe(true);

    // ---- known types DO get priced, at the right rate code -----------------
    const bed2Codes = bed2.surfaces.map((s) => s.code);
    expect(bed2Codes).toContain("4-6 Panel Door and Frame (1 Side)");
    expect(bed2Codes).toContain("Double Hung Sash");

    // ---- rule 1: cornices only where a photo confirmed one -----------------
    expect(bed1.surfaces.some((s) => /cornice/i.test(s.code))).toBe(false);
    expect(bed2.surfaces.some((s) => /cornice/i.test(s.code))).toBe(true);

    // ---- rule 2: ensuite = ceiling and door only ---------------------------
    const ensLabels = ens.surfaces.map((s) => s.internalLabel);
    expect(ensLabels).toContain("Ceiling");
    expect(ensLabels.some((l) => /door/i.test(l))).toBe(true);
    expect(ensLabels).not.toContain("Walls");
    expect(ensLabels).not.toContain("Skirting Boards");

    await sb.from("estimates").delete().eq("id", estimateId);
  });
});
