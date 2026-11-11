import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn, test } from "../helpers";

/**
 * Estimates tab & funnel, session 3 (brief §4 / §4.1, rulings R11, R12, R13,
 * E‑I): the /estimates shell and the All estimates additions.
 *
 *  1. An ANONYMOUS customer opens the estimate they were sent, in two separate
 *     visits. Staff read "Viewed 2×" on its row (R12: on every row, never
 *     collapsed into a pill state).
 *  2. A wizard session that came back twice (visits = 3) shows "Came back ×2".
 *  3. The six chips sit above the list in the brief's order, All estimates is
 *     the default and pressed, and the nine tabs are still inside it (E‑I).
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const TAG = `shell${run}`;
const CHIPS = ["all", "pipeline", "online", "queue", "funnel", "automations"];

const SNAPSHOT = {
  version: 1, estRef: `EST-H${run}`,
  company: { name: "Paint Group Pty Ltd", addressLine1: "1 Example St", addressLine2: "Melbourne VIC", phone: "(03) 9000 0000", abn: "11 222 333 444", email: "hello@example.com", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: "Shell Tester", contactEmail: "", jobTitle: "Interior repaint", jobAddress: "9 Shell Street, Fairfield VIC 3078",
  gstRatePct: 10, depositPct: 10, lineItems: [], options: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 200000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 200000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
  paints: [],
};

test.describe("Estimates shell, session 3 — chips, view count, came back", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  let sentId = ""; let wizId = ""; let draftId = "";
  const token = `shell${run}${randomBytes(8).toString("hex")}`;

  test.beforeAll(async () => {
    const sent = await db!.from("estimates").insert({
      title: `Shell sent ${TAG}`, status: "sent", source: "manual", level_of_finish: 3, share_token: token,
      sent_at: new Date().toISOString(), total_cents: 220000,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} }, sent_snapshot: SNAPSHOT,
    }).select("id").single();
    if (sent.error) throw new Error(sent.error.message);
    sentId = sent.data.id as string;
    const wiz = await db!.from("estimates").insert({
      title: `Shell wizard ${TAG}`, status: "draft", source: "customer_intake", level_of_finish: 3, builder_state: { blocks: [] },
    }).select("id").single();
    if (wiz.error) throw new Error(wiz.error.message);
    wizId = wiz.data.id as string;
    const d = await db!.from("wizard_drafts").insert({ estimate_id: wizId, visits: 3, name: `Shell Tester ${run}`, converted_at: new Date().toISOString() }).select("id").single();
    if (d.error) throw new Error(d.error.message);
    draftId = d.data.id as string;
  });
  test.afterAll(async () => {
    if (!db) return;
    if (draftId) await db.from("wizard_drafts").delete().eq("id", draftId);
    for (const id of [sentId, wizId].filter(Boolean)) {
      await db.from("estimate_views").delete().eq("estimate_id", id);
      await db.from("estimates").delete().eq("id", id);
    }
  });

  test("an anonymous customer's two visits read Viewed 2× on the staff row", async ({ browser }) => {
    for (let visit = 1; visit <= 2; visit++) {
      const ctx = await browser.newContext();
      const customer = await ctx.newPage();
      await customer.goto(`/e/${token}`);
      await expect(customer.locator("details.room").first()).toBeVisible();
      await expect.poll(async () => {
        const { count, error } = await db!.from("estimate_views").select("id", { count: "exact", head: true }).eq("estimate_id", sentId);
        if (error) throw new Error(error.message);
        return count ?? 0;
      }, { timeout: 15_000 }).toBe(visit);
      await ctx.close();
    }

    const staffCtx = await browser.newContext();
    const page = await staffCtx.newPage();
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    await page.goto(`/estimates?q=${TAG}`);
    await expect(page.getByTestId(`estimate-viewed-${sentId}`)).toHaveText("Viewed 2×");
    await expect(page.getByTestId(`estimate-viewed-${wizId}`)).toHaveCount(0);
    await staffCtx.close();
  });

  test("a session that came back twice reads Came back ×2", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    await page.goto(`/estimates?q=${TAG}`);
    await expect(page.getByTestId(`estimate-came-back-${wizId}`)).toHaveText("Came back ×2");
    await expect(page.getByTestId(`estimate-came-back-${sentId}`)).toHaveCount(0);
  });

  test("six chips in the brief's order, All estimates pressed, the nine tabs inside it", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    await page.goto("/estimates");
    const chips = page.getByTestId("estimates-views").locator("[data-view]");
    await expect.poll(() => chips.evaluateAll((els) => els.map((e) => e.getAttribute("data-view")))).toEqual(CHIPS);
    await expect(page.getByTestId("estimates-view-all")).toHaveAttribute("aria-current", "page");
    for (const tab of ["waiting", "all", "draft", "sent", "viewed", "accepted", "declined", "expired", "wizard"]) {
      await expect(page.getByTestId(`estimates-tab-${tab}`)).toBeVisible();
    }
    // A view still to be built (Funnel, session 5) says so, and keeps the chips; the tabs are All estimates' own.
    await page.getByTestId("estimates-view-funnel").click();
    await expect(page).toHaveURL(/view=funnel/);
    await expect(page.getByTestId("estimates-view-funnel")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("estimates-view-soon")).toBeVisible();
    await expect(page.getByTestId("estimates-tab-all")).toHaveCount(0);
    // Campaigns › Automations opens Campaigns until its sub-tab exists (§4.7).
    await expect(page.getByTestId("estimates-view-automations")).toHaveAttribute("href", "/crm/campaigns");
  });
});
