import { expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, test } from "./helpers";

/**
 * Tom, 15 Oct 2026 — three things on the contractor's job sheet:
 *
 *  1. "it isn't showing the number … of the doors, windows etc" — the count
 *     landed on 14 Oct but only for estimates saved AFTER the deploy. Now
 *     issue_work_order fills it from the estimate's own blocks (migration
 *     20270272), so a sheet issued from a stale woDoc still reads "Doors × 4".
 *  2. "there are also no measurements" — the area's L × W × H is filled the
 *     same way, and a measured surface frozen by the builder says "38.4 m²".
 *  3. "it doesn't show all of the photos" — the area strip was capped at 8.
 *
 * All read as an ANONYMOUS painter on /w/[token]. The active C1 rate card
 * carries "Walls" (M2) and "Flat Door (1 Side)" (Hours Per Item) on Interior.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");

const PX = (hex: string) => `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="%23${hex}"/></svg>`;
const photos = Array.from({ length: 11 }, (_, i) => PX((0x111111 * (i + 1)).toString(16).padStart(6, "0").slice(0, 6)));

const surface = (id: number, code: string, label: string, count: number) => ({
  id, code, internalLabel: label, clientLabel: label, coats: 2, count,
  hidden: false, media: [], measureL: null, measureH: null, qtyOverride: null,
  rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null,
  productName: null, color: "", colorHex: "", coverageOverride: null, volumeOverride: null,
  unitPriceOverride: null, crewNote: "", hideQty: false, showCoats: true, showPrice: false,
  useCustomRate: false, customRate: null, open: false,
});

/** A woDoc as the builder froze it BEFORE 14 Oct: no counts, no dims. */
const staleWoDoc = {
  version: 1, woRef: "", status: "draft", jobTitle: `Counts ${run}`, jobAddress: "4 Count St, Clayton",
  contactFirstName: "Count", contactPhone: "", startDate: null, accessNotes: "", crewNotes: "",
  levelOfFinish: "Level 3", finishCode: "PG-3", contractorName: "", contractorPaymentCents: 0,
  materials: [],
  areas: [{
    id: "1", title: "Living room", side: "interior", finishCode: "PG-3", finishOverridden: false, photos,
    surfaces: [
      { key: "1:2", label: "Walls", code: "Walls", coats: 2, product: "", prep: "", hours: 4, status: "not_started" },
      { key: "1:3", label: "Doors", code: "Flat Door (1 Side)", coats: 2, product: "", prep: "", hours: 2, status: "not_started" },
      { key: "1:4", label: "Front door", code: "Flat Door (1 Side)", coats: 2, product: "", prep: "", hours: 1, status: "not_started" },
    ],
  }],
  exclusions: [], company: { name: "Paint Group", phone: "", logoUrl: "" },
};

type Snap = { areas: Array<{ dims?: { l: number; w: number; h: number }; surfaces: Array<{ label: string; count?: number }> }> };

test.describe("Job sheet: how many, how big, every photo (15 Oct 2026)", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  let estimateId = "";
  let workOrderId = "";
  const shareToken = `wsh${run}${Date.now().toString(36)}abcdefgh`;

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Sheet counts ${run}`, status: "accepted", source: "manual", level_of_finish: 3,
      share_token: `est${run}${Date.now().toString(36)}abcdef`,
      builder_state: {
        blocks: [{
          id: 1, kind: "area", name: "Living room", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4,
          isOption: false, description: "", open: false, media: [],
          surfaces: [surface(2, "Walls", "Walls", 1), surface(3, "Flat Door (1 Side)", "Doors", 4), surface(4, "Flat Door (1 Side)", "Front door", 1)],
        }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {}, materialColours: {}, colourMatches: {},
        contact: { first_name: "Count", last_name: "Customer", email: "", phone: "" },
        jobAddress: { address: "4 Count St", city: "Clayton", state: "VIC", postal: "3168" },
        woDoc: staleWoDoc,
      },
    }).select("id").single();
    if (est.error) throw new Error(`estimate: ${est.error.message}`);
    estimateId = est.data.id as string;

    const wo = await db!.from("work_orders").insert({
      estimate_id: estimateId, wo_ref: `WO-E2E${run}`, share_token: shareToken,
    }).select("id").single();
    if (wo.error) throw new Error(`work order: ${wo.error.message}`);
    workOrderId = wo.data.id as string;
  });

  test.afterAll(async () => {
    if (workOrderId) await db!.from("work_orders").delete().eq("id", workOrderId);
    if (estimateId) await db!.from("estimates").delete().eq("id", estimateId);
  });

  test("issuing from a stale estimate fills counts and dimensions; the painter's sheet shows them and every photo", async ({ page }) => {
    // Staff issue the draft through the RPC, in their own session (the service
    // key carries no claims, so is_staff() would be false under it).
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error: authErr } = await sb.auth.signInWithPassword({ email: staff!.email, password: staff!.password });
    if (authErr) throw new Error(`staff sign-in: ${authErr.message}`);
    const { data: res, error } = await sb.rpc("issue_work_order", { p_work_order_id: workOrderId });
    await sb.auth.signOut().catch(() => {});
    expect(error).toBeNull();
    expect(res).toBe("ok:issued");

    const { data: row } = await db!.from("work_orders").select("wo_snapshot").eq("id", workOrderId).single();
    const snap = row?.wo_snapshot as Snap;
    expect(snap.areas[0].surfaces.map((s) => [s.label, s.count ?? null])).toEqual([["Walls", null], ["Doors", 4], ["Front door", 1]]);
    expect(snap.areas[0].dims).toEqual({ l: 4, w: 3, h: 2.4 });

    // The painter, signed out, by token.
    await page.goto(`/w/${shareToken}`);
    await expect(page.getByTestId("surf-count-1:3")).toHaveText("× 4");
    await expect(page.getByTestId("surf-count-1:4")).toHaveText("× 1");
    await expect(page.getByTestId("surf-count-1:2")).toHaveCount(0);
    await expect(page.getByTestId("area-dims-1")).toHaveText("4 × 3 × 2.4 m");
    await expect(page.getByTestId("area-photo")).toHaveCount(photos.length);
  });

  test("a measured surface frozen by the builder says its size on the sheet", async ({ page }) => {
    const { data: row } = await db!.from("work_orders").select("wo_snapshot").eq("id", workOrderId).single();
    const snap = row?.wo_snapshot as Snap & { areas: Array<{ surfaces: Array<Record<string, unknown>> }> };
    snap.areas[0].surfaces[0] = { ...snap.areas[0].surfaces[0], qty: 33.6, unit: "m²" };
    const { error } = await db!.from("work_orders").update({ wo_snapshot: snap }).eq("id", workOrderId);
    expect(error).toBeNull();
    await page.goto(`/w/${shareToken}`);
    await expect(page.getByTestId("surf-measure-1:2")).toHaveText("33.6 m² · ");
    await expect(page.getByTestId("surf-measure-1:3")).toHaveCount(0);
  });
});
