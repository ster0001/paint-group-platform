import { expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, test } from "./helpers";

/**
 * Tom, 21 Oct 2026 — two things on the painter's job sheet:
 *
 *  1. "add the paint for each substrate in the work orders for the contractors
 *     — currently it is only something we see, not them": every surface on the
 *     sheet now carries its paint line — product · sheen · colour, with the
 *     swatch — and each row under Materials & colours says which substrates it
 *     goes on, the same pairing the office reads on the PC Materials card.
 *  2. "remove the estimated hours from the work order, so they can just see and
 *     tick off the list of tasks" — and, later the same day, "the
 *     subcontractors can still see the hours, it is just the painters they
 *     share it with that can't": the Estimated hours fact, the per-surface
 *     hours, the condition's extra-prep hours and the hours on a variation are
 *     gone from the CREW's copy (/crew/[token], the worker login) and nowhere
 *     else. The contractor's own link keeps every hour.
 *
 * Read as an ANONYMOUS painter: the contractor share link /w/[token] and the
 * crew link /crew/[token], the whole response scanned, RSC payload included.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");

const surface = (id: number, code: string, label: string, count: number, productName: string | null, color: string, colorHex: string) => ({
  id, code, internalLabel: label, clientLabel: label, coats: 2, count,
  hidden: false, media: [], measureL: null, measureH: null, qtyOverride: null,
  rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null,
  productName, color, colorHex, coverageOverride: null, volumeOverride: null,
  unitPriceOverride: null, crewNote: "", hideQty: false, showCoats: true, showPrice: false,
  useCustomRate: false, customRate: null, open: false,
});

/** A woDoc as the builder freezes it: every surface with its paint and its hours. */
const woDoc = {
  version: 1, woRef: "", status: "draft", jobTitle: `Paint lines ${run}`, jobAddress: "7 Sheen St, Clayton",
  contactFirstName: "Sheen", contactPhone: "", startDate: null, accessNotes: "", crewNotes: "",
  levelOfFinish: "Level 3", finishCode: "PG-3", contractorName: "", contractorPaymentCents: 0,
  condition: { code: "poor", label: "Poor", multiplier: 1.35, extraHours: 1.4 },
  materials: [
    { product: "Dulux Wash&Wear", finish: "Low Sheen", colourKey: "Dulux Wash&Wear||Natural White", photoUrl: "", litres: 6, estimatedLitres: 6.4, coverageMissing: false, colourName: "Natural White", colourHex: "#f2efe6", colourStatus: "confirmed" },
    { product: "Dulux Aquanamel", finish: "Semi Gloss", colourKey: "Dulux Aquanamel", photoUrl: "", litres: 2, estimatedLitres: 2.1, coverageMissing: false, colourName: "", colourHex: "", colourStatus: "tbc" },
  ],
  areas: [{
    id: "1", title: "Living room", side: "interior", finishCode: "PG-3", finishOverridden: false, photos: [],
    surfaces: [
      { key: "1:2", label: "Walls", code: "Walls", coats: 2, product: "Dulux Wash&Wear", finish: "Low Sheen", colourName: "Natural White", colourHex: "#f2efe6", colourKey: "Dulux Wash&Wear||Natural White", litres: 6.4, prep: "", hours: 4.25, paintingHours: 4.25, prepHours: 0, conditionHours: 1.1, status: "not_started" },
      { key: "1:3", label: "Doors", code: "Flat Door (1 Side)", coats: 2, product: "Dulux Aquanamel", finish: "Semi Gloss", colourName: "", colourHex: "", colourKey: "Dulux Aquanamel", litres: 2.1, prep: "Sand back", hours: 2, paintingHours: 1.5, prepHours: 0.5, conditionHours: 0.3, status: "not_started" },
      { key: "1:4", label: "Move furniture", code: "Allowance", coats: 0, product: "", prep: "", hours: 1, status: "not_started" },
    ],
  }],
  exclusions: [], company: { name: "Paint Group", phone: "", logoUrl: "" },
};

test.describe("Job sheet: paint on every substrate, no estimated hours (21 Oct 2026)", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  let estimateId = "";
  let workOrderId = "";
  const shareToken = `wsp${run}${Date.now().toString(36)}abcdefgh`;
  const crewToken = `wcp${run}${Date.now().toString(36)}abcdefgh`;

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Paint lines ${run}`, status: "accepted", source: "manual", level_of_finish: 3,
      share_token: `est${run}${Date.now().toString(36)}abcdef`,
      builder_state: {
        blocks: [{
          id: 1, kind: "area", name: "Living room", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4,
          isOption: false, description: "", open: false, media: [],
          surfaces: [
            surface(2, "Walls", "Walls", 1, "Dulux Wash&Wear", "Natural White", "#f2efe6"),
            surface(3, "Flat Door (1 Side)", "Doors", 4, "Dulux Aquanamel", "", ""),
          ],
        }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {}, materialColours: {}, colourMatches: {},
        contact: { first_name: "Sheen", last_name: "Customer", email: "", phone: "" },
        jobAddress: { address: "7 Sheen St", city: "Clayton", state: "VIC", postal: "3168" },
        woDoc,
      },
    }).select("id").single();
    if (est.error) throw new Error(`estimate: ${est.error.message}`);
    estimateId = est.data.id as string;

    const wo = await db!.from("work_orders").insert({
      estimate_id: estimateId, wo_ref: `WO-E2E${run}`, share_token: shareToken, crew_token: crewToken,
    }).select("id").single();
    if (wo.error) throw new Error(`work order: ${wo.error.message}`);
    workOrderId = wo.data.id as string;

    // Staff issue the draft through the RPC, in their own session (the service
    // key carries no claims, so is_staff() would be false under it).
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error: authErr } = await sb.auth.signInWithPassword({ email: staff!.email, password: staff!.password });
    if (authErr) throw new Error(`staff sign-in: ${authErr.message}`);
    const { data: res, error } = await sb.rpc("issue_work_order", { p_work_order_id: workOrderId });
    await sb.auth.signOut().catch(() => {});
    if (error || res !== "ok:issued") throw new Error(`issue_work_order: ${error?.message ?? String(res)}`);
  });

  test.afterAll(async () => {
    if (workOrderId) await db!.from("work_orders").delete().eq("id", workOrderId);
    if (estimateId) await db!.from("estimates").delete().eq("id", estimateId);
  });

  test("every substrate says its paint, and the materials list says where each paint goes", async ({ page }) => {
    await page.goto(`/w/${shareToken}`);
    await expect(page.locator("h1")).toContainText(`Paint lines ${run}`);

    // Product · sheen · colour on the surface itself, swatch included.
    const walls = page.getByTestId("surf-paint-1:2");
    await expect(walls).toContainText("Dulux Wash&Wear · Low Sheen · Natural White");
    await expect(walls.locator(".swatch")).toHaveCount(1);
    // A colour not yet chosen says so, rather than printing nothing.
    await expect(page.getByTestId("surf-paint-1:3")).toContainText("Dulux Aquanamel · Semi Gloss · Colour to be confirmed");
    // An allowance line has no paint, and no paint line.
    await expect(page.getByTestId("surf-paint-1:4")).toHaveCount(0);

    // The other way round: each paint row names the substrates it goes on.
    await expect(page.getByTestId("mat-substrates-Dulux Wash&Wear||Natural White")).toContainText("Living room · Walls · 2 coats");
    await expect(page.getByTestId("mat-substrates-Dulux Aquanamel")).toContainText("Living room · Doors · 2 coats");
  });

  test("the subcontractor's own link keeps every hour", async ({ page }) => {
    await page.goto(`/w/${shareToken}`);
    await expect(page.getByTestId("wo-estimated-hours")).toContainText("7.3 h");
    await expect(page.locator(".surf-hours")).toHaveCount(3);
    await expect(page.getByTestId("surf-prep-1:3")).toContainText("h prep");
    await expect(page.getByTestId("wo-condition")).toContainText("+1.4 h");
  });

  test("the crew's copy carries no estimated hours — not at the top, not per surface, not on the condition — and still the paint", async ({ page }) => {
    const response = await page.goto(`/crew/${crewToken}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toContainText(`Paint lines ${run}`);

    await expect(page.getByTestId("wo-estimated-hours")).toHaveCount(0);
    await expect(page.locator(".surf-hours")).toHaveCount(0);
    await expect(page.getByTestId("surf-prep-1:3")).toHaveCount(0);
    await expect(page.getByTestId("wo-condition")).toHaveCount(0);
    // The tick list is still the whole scope, and the paint is on it.
    await expect(page.getByTestId("surf-state-1:2")).toBeVisible();
    await expect(page.getByTestId("surf-state-1:3")).toBeVisible();
    await expect(page.getByTestId("surf-state-1:4")).toBeVisible();
    await expect(page.getByTestId("surf-paint-1:2")).toContainText("Dulux Wash&Wear · Low Sheen · Natural White");
    await expect(page.getByTestId("mat-substrates-Dulux Wash&Wear||Natural White")).toContainText("Living room · Walls · 2 coats");

    // The words themselves — rendered markup, not just test ids.
    const html = (await response?.text()) ?? "";
    expect(html).not.toMatch(/Estimated hours/i);
    expect(html).not.toMatch(/h prep/);
    expect(html).not.toMatch(/extra prep allowed for/i);
  });
});
