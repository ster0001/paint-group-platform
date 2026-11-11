import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn, test } from "../helpers";

/**
 * Estimates tab & funnel, session 6 (brief §4.6, R3, R12, R16, ruling E‑L as
 * ruled 11 Nov 2026 — "close the gaps, then switch").
 *
 *  1. An ANONYMOUS customer opens a Paint Home estimate that has NO customer
 *     account. Before 20270312 that open never reached the log, so the new
 *     Activity would have shown nothing. Now staff see, on /quote:
 *       · the bar: Paint Home, Viewed 1×, the stage Estimate viewed on the strip;
 *       · the header: Paint Home's logo, never Paint Group's;
 *       · Activity: the open, with how long they stayed; and an emailed row
 *         from before the log in Older activity.
 *  2. The Activity filters: Wizard shows nothing for a staff-built estimate.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");

const SNAPSHOT = {
  version: 1, estRef: `EST-D${run}`,
  company: { name: "Paint Group Pty Ltd", addressLine1: "1 Example St", addressLine2: "Melbourne VIC", phone: "(03) 9000 0000", abn: "11 222 333 444", email: "hello@example.com", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: "Detail Tester", contactEmail: "", jobTitle: "Interior repaint", jobAddress: "6 Detail Street, Fairfield VIC 3078",
  gstRatePct: 10, depositPct: 10, lineItems: [], options: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 200000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 200000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
  paints: [],
};

test.describe("Estimate detail, session 6 — bar, brand, Activity from the log", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  let estId = "";
  const token = `detail${run}${randomBytes(8).toString("hex")}`;

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Detail ${run}`, status: "sent", source: "manual", level_of_finish: 3, share_token: token, brand: "painthome",
      sent_at: new Date(Date.now() - 3_600_000).toISOString(), total_cents: 220000,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} }, sent_snapshot: SNAPSHOT,
    }).select("id, account_id").single();
    if (est.error) throw new Error(est.error.message);
    estId = est.data.id as string;
    if (est.data.account_id) throw new Error("the fixture must have no account");
    // A row from before the CRM log: it has no event, so it belongs in Older activity.
    const legacy = await db!.from("estimate_events").insert({ estimate_id: estId, type: "email_sent", payload: {} });
    if (legacy.error) throw new Error(legacy.error.message);
  });
  test.afterAll(async () => {
    if (!db || !estId) return;
    await db.from("crm_events").delete().eq("estimate_id", estId);
    await db.from("estimate_events").delete().eq("estimate_id", estId);
    await db.from("estimate_views").delete().eq("estimate_id", estId);
    await db.from("estimates").delete().eq("id", estId);
  });

  test("an anonymous open of an accountless Paint Home estimate shows on the bar and in Activity", async ({ browser }) => {
    test.setTimeout(120_000);
    const custCtx = await browser.newContext();
    const cust = await custCtx.newPage();
    await cust.goto(`/e/${token}`);
    await expect(cust.locator("details.room").first()).toBeVisible();
    await expect.poll(async () => {
      const { count, error } = await db!.from("crm_events").select("id", { count: "exact", head: true }).eq("estimate_id", estId).eq("type", "estimate_viewed");
      if (error) throw new Error(error.message);
      return count ?? 0;
    }, { timeout: 15_000, message: "the open reaches the log with no account (20270312)" }).toBe(1);
    await custCtx.close();

    const staffCtx = await browser.newContext();
    const page = await staffCtx.newPage();
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    await page.goto(`/quote?id=${estId}`);
    const bar = page.getByTestId("estimate-funnel-bar");
    await expect(bar).toHaveAttribute("data-stage", "estimate_viewed", { timeout: 30_000 });
    await expect(bar.getByTestId("brand-pill")).toHaveAttribute("data-brand", "painthome");
    await expect(page.getByTestId("estimate-bar-viewed")).toHaveText("Viewed 1×");
    await expect(page.getByTestId("estimate-stage-strip").locator('[data-state="current"]')).toHaveAttribute("data-stage", "estimate_viewed");
    // R3: the header wears Paint Home's marks.
    const logo = page.locator('img[src*="/painthome/"]').first();
    await expect(logo).toBeVisible();
    await expect(page.locator('img[alt="Paint Group Pty Ltd"]')).toHaveCount(0);

    await page.getByTestId("tools-activity").click();
    const activity = page.getByTestId("estimate-activity");
    await expect(activity.locator('[data-testid="activity-row"][data-type="estimate_viewed"]')).toContainText("stayed");
    await expect(activity.locator('[data-testid="activity-row"][data-type="estimate_sent"]')).toHaveCount(1);
    await page.getByTestId("activity-older").locator("summary").click();
    await expect(page.getByTestId("activity-older")).toContainText("Emailed to customer");
    await page.getByTestId("activity-filter-wizard").click();
    await expect(activity.getByTestId("activity-row")).toHaveCount(0);
    await page.getByTestId("activity-filter-all").click();
    await expect(activity.getByTestId("activity-row").first()).toBeVisible();
    await staffCtx.close();
  });
});
