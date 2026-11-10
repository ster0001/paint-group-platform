import { expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn, test } from "./helpers";

/**
 * Tom, 10 Nov 2026 — 5 Milton Street Carnegie: "the offered hours have changed
 * from 37 hours to 27 hours". They never changed: the estimate's hourly line
 * "Deck around Pool" (10 h) was in the painter's PAY but never on the work
 * order, so the job sheet, the tick list and the offer said 27.1 h.
 *
 * Staff save the estimate in the builder; the CUSTOMER opens it in their own
 * anonymous session, sees the line priced as before, and accepts; the frozen
 * work order carries the line as its own area with its hours and wording, and
 * the painter's sheet adds it to the Estimated hours. A line with no hours
 * stays off the sheet, as before.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const token = `wolh${run}${randomBytes(10).toString("hex")}`;
const anon = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

const DECK = `Deck around Pool ${run}`;
const FEE = `Parking ${run}`;

type Doc = { areas: { id: string; title: string; surfaces: { key: string; label: string; hours: number | null; prep: string }[] }[] };
const docHours = (d: Doc) => Math.round(d.areas.flatMap((a) => a.surfaces).reduce((n, s) => n + (s.hours ?? 0), 0) * 100) / 100;

test.describe("line items with hours reach the work order", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  let estimateId = "";

  test.beforeAll(async () => {
    const line = { kind: "line", type: "Interior", rate: 85, qty: 1, unitPrice: 0, cost: 0, clientNote: "", crewNote: "", hidden: false, isOption: false, subcontractorExpense: false, media: [], open: false, detailsOpen: false, materials: [] };
    const est = await db!.from("estimates").insert({
      title: `Line hours ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: token,
      builder_state: {
        blocks: [
          { id: 1, kind: "area", name: "Bed 1", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4, isOption: false, description: "", open: false, media: [],
            surfaces: [{ id: 11, code: "WALL", coats: 2, count: 0, prepHr: 1, internalLabel: "Walls", clientLabel: "Walls" }] },
          { ...line, id: 807, name: DECK, mode: "hourly", hours: 10, custom: 0, woHours: 0,
            description: "Pressure wash deck&nbsp;<div>Apply oxalic acid and thoroughly clean deck</div><div>Apply 1 x coat of Cutek Extreme CD 50</div>" },
          { ...line, id: 808, name: FEE, mode: "custom", hours: 0, custom: 120, woHours: 0, description: "Permit parking" },
        ],
        modSel: { "Level of Finish": "FIN-3" }, materials: {},
        contact: { first_name: "Milton", last_name: `Line${run}`, company: "", email: "", phone: "", address: "", city: "", state: "", postal: "" },
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id;
  });

  test.afterAll(async () => {
    if (!db || !estimateId) return;
    await db.from("invoices").delete().eq("estimate_id", estimateId);
    await db.from("wo_working_scopes").delete().eq("estimate_id", estimateId);
    await db.from("work_orders").delete().eq("estimate_id", estimateId);
    await db.from("follow_ups").delete().eq("estimate_id", estimateId);
    await db.from("estimate_events").delete().eq("estimate_id", estimateId);
    await db.from("estimates").delete().eq("id", estimateId);
  });

  test("staff save: the builder's job sheet carries the hourly line as its own area", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(DECK).first()).toBeVisible();
    await page.getByTestId("builder-save").click();

    let doc: Doc | null = null;
    await expect.poll(async () => {
      const { data, error } = await db!.from("estimates").select("builder_state").eq("id", estimateId).single();
      if (error) throw new Error(error.message);
      doc = (data?.builder_state as { woDoc?: Doc } | null)?.woDoc ?? null;
      return doc?.areas.some((a) => a.id === "line-807") ?? false;
    }, { timeout: 15_000 }).toBe(true);

    const deck = doc!.areas.find((a) => a.id === "line-807")!;
    expect(deck.title).toBe(DECK);
    expect(deck.surfaces).toHaveLength(1);
    expect(deck.surfaces[0]).toMatchObject({ key: "line-807:work", label: DECK, hours: 10 });
    expect(deck.surfaces[0].prep).toBe("Pressure wash deck\nApply oxalic acid and thoroughly clean deck\nApply 1 x coat of Cutek Extreme CD 50");
    // The price-only line has no hours, so it is not crew work on the sheet.
    expect(doc!.areas.some((a) => a.id === "line-808")).toBe(false);
    // Contractor-safe: no customer price rides the line's area.
    expect(JSON.stringify(deck)).not.toMatch(/850|"rate"|priceCents/);
  });

  test("customer accepts in their own session; the frozen sheet, the job sheet page and the hours agree", async ({ page }) => {
    await db!.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", estimateId);

    // The customer's page is unchanged: the deck is a priced line, as before.
    await page.goto(`/e/${token}`);
    await expect(page.getByText(DECK).first()).toBeVisible();

    const accepted = await anon().rpc("accept_estimate", { p_token: token, p_name: "Milton Line", p_options: [], p_total_cents: 0, p_deposit_cents: 0 });
    expect(accepted.error).toBeNull();
    expect(accepted.data).toBe("accepted");

    const { data: wo, error } = await db!.from("work_orders").select("share_token, wo_snapshot").eq("estimate_id", estimateId).single();
    if (error) throw new Error(error.message);
    const snap = wo!.wo_snapshot as Doc;
    const rooms = snap.areas.filter((a) => !a.id.startsWith("line-"));
    expect(snap.areas.map((a) => a.id)).toContain("line-807");
    expect(docHours(snap)).toBe(Math.round((docHours({ areas: rooms }) + 10) * 100) / 100);

    // The painter's sheet: the deck is in the scope with its wording, and in the hours.
    await page.goto(`/w/${wo!.share_token}`);
    await expect(page.getByTestId("wo-estimated-hours")).toBeVisible();
    const shown = (await page.getByTestId("wo-estimated-hours").locator(".v").textContent()) ?? "";
    expect(Number(shown.replace(/[^0-9.]/g, ""))).toBeCloseTo(docHours(snap), 1);
    const deckArea = page.locator(".area", { has: page.locator(".area-title", { hasText: DECK }) });
    await expect(deckArea).toBeVisible();
    await expect(deckArea).toContainText("Apply oxalic acid and thoroughly clean deck");
    await expect(deckArea).not.toContainText(/0 coats/i);
    await expect(page.locator(".area-title", { hasText: FEE })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("job-sheet.png"), fullPage: true });
  });
});
