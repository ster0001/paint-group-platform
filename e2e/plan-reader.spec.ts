import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * The plan reader, end to end, WITHOUT a model call.
 *
 * The model is one stage of five. Everything around it — upload, page routing,
 * validation, scope mapping, the draft tree, and writing it into the builder —
 * is deterministic, and this drives all of it by planting a reading on the run
 * row exactly as the model would have written it.
 *
 * So the pipeline is proven now, and adding the API key switches on the one
 * stage that is missing rather than the whole thing being untested.
 */
const staff = credentials("STAFF");
const fixture = readFileSync("lib/extract/__fixtures__/two-page-plan.pdf");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

/** What the model returns for a small, ordinary three-room plan. */
const READING = {
  storeys: [{ label: "Ground", kind: "ground", stated_area_m2: null }],
  scale: { method: "labelled_dimensions", stated_total_area_m2: null, not_to_scale_disclaimer: false, confidence: 0.92 },
  ceiling_height_m: null,
  has_site_plan: false,
  unreadable_regions: [],
  rooms: [
    {
      name_on_plan: "Main Bedroom", normalised_type: "bedroom", storey: "Ground",
      length_m: 4.1, width_m: 3.7, dimension_source: "read", dimension_confidence: 0.93,
      area_m2_printed: null, irregular: false,
      doors: [{ type: "internal_hinged", width_m: 0.82, confidence: 0.9 }],
      windows: [{ size_class: "medium", confidence: 0.85 }],
      openings_no_door: 0, wet_area: false, notes_read_from_plan: "",
    },
    {
      name_on_plan: "Bedroom 2", normalised_type: "bedroom", storey: "Ground",
      length_m: 3.2, width_m: 4.1, dimension_source: "read", dimension_confidence: 0.9,
      area_m2_printed: null, irregular: false,
      doors: [{ type: "internal_hinged", width_m: 0.82, confidence: 0.88 }],
      windows: [{ size_class: "medium", confidence: 0.8 }],
      openings_no_door: 0, wet_area: false, notes_read_from_plan: "",
    },
    {
      // The case that matters: labelled, not dimensioned. Marketing plans do
      // this to every wet area, and they still get painted.
      name_on_plan: "Bath", normalised_type: "bathroom", storey: "Ground",
      length_m: null, width_m: null, dimension_source: "not_dimensioned", dimension_confidence: 0.2,
      area_m2_printed: null, irregular: false,
      doors: [{ type: "internal_hinged", width_m: 0.72, confidence: 0.8 }],
      windows: [], openings_no_door: 0, wet_area: true, notes_read_from_plan: "",
    },
  ],
};

async function staffDb() {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  await sb.auth.signInWithPassword({ email: staff!.email, password: staff!.password });
  return sb;
}

test.describe("plan reader pipeline", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(process.env.E2E_EXTRACT_READY !== "1", "needs migration 20260910000000 applied");

  test("a reading becomes a priceable estimate in the builder", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);

    // ---- 1. upload: the real route, real storage, real run rows ------------
    const up = await page.request.post("/api/extract/floorplan?kind=floorplan", {
      multipart: { file: { name: "plan.pdf", mimeType: "application/pdf", buffer: fixture } },
    });
    expect(up.status()).toBe(200);
    const runId = (await up.json()).primaryRunId as string;

    // ---- 2. plant the reading the model would have produced ----------------
    const sb = await staffDb();
    const planted = await sb.from("extraction_runs")
      .update({ raw_output: READING, status: "needs_review", model: "planted-for-test" })
      .eq("id", runId);
    expect(planted.error).toBeNull();

    // ---- 3. apply: scope mapping + draft + write into the builder ----------
    const applied = await page.request.post(`/api/extract/${runId}/apply`, {
      data: { title: "E2E — drafted from a floorplan" },
    });
    expect(applied.status()).toBe(200);
    const result = await applied.json();

    // Three rooms in, three areas out — including the one with no dimensions.
    expect(result.areas).toBe(3);
    expect(result.surfaces).toBeGreaterThan(6);
    expect(result.assumedValues).toBeGreaterThan(0);
    const estimateId = result.estimateId as string;

    // ---- 4. what actually landed in the builder ----------------------------
    const { data: est } = await sb.from("estimates").select("id, title, source, builder_state").eq("id", estimateId).single();
    expect(est).not.toBeNull();
    expect(est!.source).toBe("ai_floorplan");

    const blocks = (est!.builder_state as { blocks: Array<Record<string, unknown>> }).blocks;
    expect(blocks).toHaveLength(3);

    const bed = blocks.find((b) => b.name === "Main Bedroom")! as Record<string, unknown> & {
      surfaces: Array<Record<string, unknown>>;
    };
    // The geometry the pricing engine will derive quantities from.
    expect(bed.L).toBe(4.1);
    expect(bed.W).toBe(3.7);
    expect(bed.H).toBe(2.4);
    expect(bed.kind).toBe("area");
    expect(bed.areaType).toBe("room");

    // NO quantities, hours or prices are written — that is lib/pricing's job.
    for (const s of bed.surfaces) {
      expect(s.qtyOverride).toBeNull();
      expect(s.priceOverride).toBeNull();
      expect(s.paintingHrOverride).toBeNull();
    }
    // Real rate-card codes, so the builder can price it without translation.
    const codes = bed.surfaces.map((s) => s.code);
    expect(codes).toContain("Walls");
    expect(codes).toContain("Ceilings");

    // The undimensioned bathroom exists at zero, flagged, rather than invented.
    const bath = blocks.find((b) => b.name === "Bath")! as Record<string, unknown>;
    expect(bath.L).toBe(0);
    expect(bath.origin).toBe("ai_assumed");
    expect(bath.assumedFields).toContain("L");

    // ---- 5. the builder opens it -------------------------------------------
    await page.goto(`/quote?id=${estimateId}`);
    await expect(page.locator("body")).toContainText("Main Bedroom", { timeout: 20_000 });
    await expect(page.locator("body")).toContainText("Bath");

    // ---- 6. applying twice is refused --------------------------------------
    const again = await page.request.post(`/api/extract/${runId}/apply`, { data: {} });
    expect(again.status()).toBe(409);

    // ---- cleanup ------------------------------------------------------------
    await sb.from("estimates").delete().eq("id", estimateId);
  });
});
