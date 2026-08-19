import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * A4's profiling harness — NOT a regression test of features, a measuring
 * device. It builds a synthetic 12-room estimate (≈96 surfaces) directly in
 * the database, opens it in the builder, and measures what a removal
 * actually costs: click→DOM-updated wall time, event-processing duration
 * (the INP-style number), and how many network requests each removal fires.
 * The estimate is deleted afterwards.
 *
 * Run:  npx playwright test e2e/perf-removals.spec.ts
 * Needs E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD and the NEXT_PUBLIC_SUPABASE_*
 * env of the target project.
 */

const staff = credentials("STAFF");

const SURFACE_DEFAULTS = {
  hidden: false, media: [], measureL: null, measureH: null,
  qtyOverride: null, rateOverride: null, paintingHrOverride: null,
  priceOverride: null, productName: null, color: "", colorHex: "",
  coverageOverride: null, volumeOverride: null, unitPriceOverride: null,
  crewNote: "", hideQty: false, showCoats: false, showPrice: false,
  useCustomRate: false, customRate: null, open: false,
  origin: "human_confirmed", confidence: 1, assumedFields: [] as string[],
};

function twelveRoomState() {
  let id = 1;
  const surface = (code: string, label: string, count = 1) => ({
    id: id++, code, internalLabel: label, clientLabel: label, coats: 2, count,
    prepHr: 0, ...SURFACE_DEFAULTS,
  });
  const blocks = Array.from({ length: 12 }, (_, i) => {
    const areaId = id++;
    return {
      id: areaId, kind: "area", name: `Room ${i + 1}`, type: "Interior", areaType: "room",
      roomType: "bedroom", storey: i < 6 ? "ground" : "first",
      L: 4.1, W: 3.6, H: 2.4, isOption: false, description: "", open: false, media: [],
      origin: "human_confirmed", confidence: 1, assumedFields: [],
      surfaces: [
        surface("Walls", "Walls"),
        surface("Ceilings", "Ceilings"),
        surface("Standard Cornices", "Cornices"),
        surface("Skirting Boards", "Skirting"),
        surface("Flat Door and Frame (1 Side)", "Flat door & frame", 2),
        surface("Awning / Casement Window", "Awning window", 2),
        surface("Architrave (1 Side)", "Architraves", 2),
        surface("4-6 Panel Door and Frame (1 Side)", "Panel door & frame", 1),
      ],
    };
  });
  return { blocks, modSel: { "Level of Finish": "LOF-2" } };
}

test("measure builder removal cost on a 12-room estimate", async ({ page }) => {
  test.skip(!staff, missingCreds("STAFF"));
  test.setTimeout(120_000);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  test.skip(!url || !anon, "set NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY");

  const supabase = createClient(url!, anon!);
  const auth = await supabase.auth.signInWithPassword({ email: staff!.email, password: staff!.password });
  expect(auth.error).toBeNull();

  const { data: row, error } = await supabase
    .from("estimates")
    .insert({ title: "A4 perf probe (auto-deletes)", status: "draft", builder_state: twelveRoomState() })
    .select("id")
    .single();
  expect(error).toBeNull();
  const estimateId = row!.id as string;

  // Event-timing observer: captures real click processing durations (INP).
  await page.addInitScript(() => {
    (window as unknown as { __clicks: number[] }).__clicks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const ev = e as PerformanceEventTiming;
        if (ev.name === "click") (window as unknown as { __clicks: number[] }).__clicks.push(ev.duration);
      }
    }).observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
  });

  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  try {
    await signIn(page, staff!, /estimates/);
    await page.goto(`/quote?id=${estimateId}`);
    await expect(page.getByText("Room 1").first()).toBeVisible({ timeout: 20_000 });

    // Open the first room card (drill-in view holds the surface rows).
    await page.getByText("Room 1").first().click();
    const removeButtons = page.getByTitle("Remove surface");
    await expect(removeButtons.first()).toBeVisible({ timeout: 10_000 });

    // ---- measure: five surface removals, wall time each -------------------
    const wallTimes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = await removeButtons.count();
      const reqBefore = requests.length;
      const t0 = Date.now();
      await removeButtons.first().click();
      await expect(removeButtons).toHaveCount(before - 1, { timeout: 10_000 });
      wallTimes.push(Date.now() - t0);
      // requests fired by this removal:
      const fired = requests.slice(reqBefore).filter((u) => !u.includes("_next/") && !u.includes("hot-reload"));
      console.log(`removal ${i + 1}: ${wallTimes[i]}ms wall, ${fired.length} network requests`, fired);
    }

    const clicks = await page.evaluate(() => (window as unknown as { __clicks: number[] }).__clicks);
    console.log("surface-removal wall times (ms):", wallTimes);
    console.log("click event processing durations (ms):", clicks);

    // ---- measure: whole-area removal from the overview --------------------
    await page.getByRole("button", { name: "Done" }).first().click().catch(() => null);
    const areaRemove = page.getByTitle("Remove").first();
    if (await areaRemove.count()) {
      const t0 = Date.now();
      await areaRemove.click();
      await expect(page.getByText("Room 1")).toHaveCount(0, { timeout: 10_000 });
      console.log(`area removal: ${Date.now() - t0}ms wall`);
    }
  } finally {
    await supabase.from("estimates").delete().eq("id", estimateId);
  }
});
