import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";
import { defaultWizardState } from "../lib/wizard/state";

/**
 * Phase 6 (estimator journey v2 §5, ⚑7) — remote confirmation.
 *
 * The customer's path to "finalise my price" already existed and is covered by
 * the ladder specs; what is new is what happens AFTERWARDS, which before this
 * was nothing at all — the prep pack was written and no person was ever told.
 *
 * So this seeds an estimate that has asked for a desk check, and drives the
 * estimator's side: the pack renders everything they need, and ⚑7 decides
 * whether it recommends fixing the price or booking a visit.
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(4).toString("hex");

const room = (id: number, name: string, surfaces: Array<Record<string, unknown>>, extra = {}) => ({
  id, kind: "area", name, type: "Interior", areaType: "room", roomType: "bedroom",
  L: 4, W: 3, H: 2.4, isOption: false, description: "", open: false, media: [],
  origin: "customer_stated", confidence: 0.9, assumedFields: [], extractionSourceId: null,
  surfaces, ...extra,
});
const surf = (id: number, code: string, extra = {}) => ({
  id, code, internalLabel: code, clientLabel: code, count: 1, coats: 2,
  prepHr: 0, crewNote: "", origin: "customer_stated", confidence: 0.9, assumedFields: [], ...extra,
});

async function seed(over: { total: number; blocks: unknown[]; deferred?: unknown[] }) {
  const state = defaultWizardState();
  // wizardStateSchema refuses a state that neither uploaded a plan nor took
  // the quick basics — the same gate the real wizard enforces, so the seed has
  // to look like a real no-plan run or the page correctly refuses it.
  state.noPlan = true;
  state.basics = { bedrooms: 3, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: false };
  state.details.siteAccess = { cleared: "no", stairwell: "yes", parking: "drive", pets: "yes" };
  const est = await db!.from("estimates").insert({
    title: `Desk check ${run}`, status: "draft", source: "manual",
    total_cents: over.total,
    builder_state: {
      blocks: over.blocks,
      aiDeferred: over.deferred ?? [],
      modSel: {}, materials: {},
      wizard: { state, builtAt: new Date().toISOString(), builtBy: "e2e" },
      prepPack: { kind: "desk_check", at: new Date().toISOString(), flags: [], removedSubstrates: [] },
    },
  }).select("id").single();
  if (est.error) throw new Error(est.error.message);
  return est.data.id as string;
}

test.describe("remote confirmation (v2 phase 6)", () => {
  test.skip(!db || !staff, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  const made: string[] = [];
  test.afterAll(async () => {
    for (const id of made) await db!.from("estimates").delete().eq("id", id);
  });

  test("an eligible job shows the whole pack and suggests fixing the price", async ({ page }) => {
    test.setTimeout(120_000);
    const id = await seed({
      total: 480_000,
      blocks: [
        room(1, "Living", [
          surf(2, "Walls"),
          surf(3, "Ceilings"),
          surf(4, "plaster_cracks", { internalLabel: "Repair — Crack", prepHr: 0.25, assumedFields: ["prep"] }),
        ]),
        room(5, "Bed 1", [surf(6, "Walls")]),
      ],
    });
    made.push(id);

    await signIn(page, staff!, /estimates|today|quote/);
    await page.goto(`/quote/desk-check?id=${id}`);
    // The route sits under app/quote, so it inherits that segment's
    // "Loading estimate…" state, and this page is a server component that
    // loads the scope rules, the rate card and the documents before it
    // renders. goto() returns while that is still streaming.
    await expect(page.getByTestId("desk-check")).toBeVisible({ timeout: 60_000 });

    // 1 — ⚑7's verdict, first, because it decides everything below it.
    await expect(page.getByTestId("desk-check-verdict")).toContainText(/fixed without a visit/i);
    // The figure comes from pricing the tree LIVE, so assert that there is one
    // rather than which one — the rate card decides that, and should.
    await expect(page.getByTestId("desk-check-verdict")).toContainText(/\$[\d,]+/);

    // 2 — the tree they confirmed.
    await expect(page.getByTestId("desk-check-rooms")).toContainText("Living");
    await expect(page.getByTestId("desk-check-rooms")).toContainText("Bed 1");

    // 3 — what they said is wrong, with the hours we allowed.
    await expect(page.getByTestId("desk-check-spots")).toContainText("Crack");
    await expect(page.getByTestId("desk-check-spots")).toContainText("0.25h allowed");

    // 4 — what we assumed on their behalf.
    await expect(page.getByTestId("desk-check-systems")).toContainText(/Walls/);
    await expect(page.getByTestId("desk-check-systems")).toContainText(/coats of low-sheen/i);

    // 5 — what will make it slower.
    await expect(page.getByTestId("desk-check-access")).toContainText(/furniture stays/i);
    await expect(page.getByTestId("desk-check-access")).toContainText(/stairwell/i);
    // A driveway costs nothing and must not be in the pack.
    await expect(page.getByTestId("desk-check-access")).not.toContainText(/driveway/i);

    // Nothing open → fix it.
    await expect(page.getByTestId("desk-check-open")).toHaveCount(0);
    await expect(page.getByTestId("outcome-fix")).toHaveAttribute("data-recommended", "1");
    // …and the other two are still offered. A recommendation that could not be
    // overridden would be self-serve wearing a person's name.
    await expect(page.getByTestId("outcome-ask")).toBeVisible();
    await expect(page.getByTestId("outcome-visit")).toBeVisible();
  });

  test("something still open makes it a question, not a fixed price", async ({ page }) => {
    test.setTimeout(120_000);
    const id = await seed({
      total: 480_000,
      blocks: [room(1, "Living", [surf(2, "Walls")])],
      deferred: [{ room: "Living", areaId: 1, what: "door style", count: 1, needs: "flat or panel?" }],
    });
    made.push(id);

    await signIn(page, staff!, /estimates|today|quote/);
    await page.goto(`/quote/desk-check?id=${id}`);
    await expect(page.getByTestId("desk-check")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("desk-check-open")).toContainText("door style");
    await expect(page.getByTestId("outcome-ask")).toHaveAttribute("data-recommended", "1");
  });

  test("⚑7 closes the door over the cap, and says so", async ({ page }) => {
    test.setTimeout(120_000);
    /**
     * The page prices the tree LIVE — a stored total could only disagree with
     * what the estimator is looking at. So a job over the cap has to be a job
     * that really is over the cap: enough rooms that the live price passes
     * $12,000, rather than a number written into the row.
     */
    const many = Array.from({ length: 30 }, (_, i) =>
      room(i * 10 + 1, `Room ${i + 1}`, [surf(i * 10 + 2, "Walls"), surf(i * 10 + 3, "Ceilings")]));
    const id = await seed({ total: 2_500_000, blocks: many });
    made.push(id);

    await signIn(page, staff!, /estimates|today|quote/);
    await page.goto(`/quote/desk-check?id=${id}`);
    await expect(page.getByTestId("desk-check")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("desk-check-verdict")).toContainText(/needs a visit/i);
    await expect(page.getByTestId("desk-check-verdict")).toContainText("$12,000");
    await expect(page.getByTestId("outcome-visit")).toHaveAttribute("data-recommended", "1");
  });
});
