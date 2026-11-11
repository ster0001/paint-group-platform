import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn, test } from "../helpers";

/**
 * Estimates tab & funnel, session 2 (docs/briefs/claude-code-brief-estimates-tab-funnel.md,
 * rulings E-G / E-H): the estimate stage on real rows.
 *
 *  1. An ANONYMOUS customer opens the estimate they were sent; staff open the
 *     dev route and read "Estimate viewed" (before the open it reads "Estimate
 *     sent") — `estimateStageFor` over what the customer's open wrote.
 *  2. A visit marked done with nothing sent since reads "Visit / call done" on
 *     the route, and is on CRM Today as "visit done, estimate not sent".
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const EMAIL = `pg.e2e.stage.${run}@example.com`;
const NAME = `Stage Tester ${run}`;

const SNAPSHOT = {
  version: 1, estRef: `EST-S${run}`,
  company: { name: "Paint Group Pty Ltd", addressLine1: "1 Example St", addressLine2: "Melbourne VIC", phone: "(03) 9000 0000", abn: "11 222 333 444", email: "hello@example.com", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: NAME, contactEmail: "", jobTitle: "Interior repaint", jobAddress: "7 Stage Street, Fairfield VIC 3078",
  gstRatePct: 10, depositPct: 10, lineItems: [], options: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 200000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 200000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
  paints: [],
};

test.describe("Estimate stage, session 2 — the stage on real rows", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  let accountId = ""; let sentId = ""; let draftId = ""; let visitId = "";
  const token = `stage${run}${randomBytes(8).toString("hex")}`;

  test.beforeAll(async () => {
    const acc = await db!.from("accounts").insert({ email: EMAIL, name: NAME, phone: `0400 ${run.slice(0, 3)} 8${run.slice(3, 5)}` }).select("id").single();
    if (acc.error) throw new Error(acc.error.message);
    accountId = acc.data.id as string;
    const sent = await db!.from("estimates").insert({
      title: `Stage sent ${run}`, status: "sent", source: "manual", level_of_finish: 3, share_token: token, account_id: accountId,
      sent_at: new Date().toISOString(), total_cents: 220000,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} }, sent_snapshot: SNAPSHOT,
    }).select("id").single();
    if (sent.error) throw new Error(sent.error.message);
    sentId = sent.data.id as string;
    const draft = await db!.from("estimates").insert({
      title: `Stage after visit ${run}`, status: "draft", source: "manual", level_of_finish: 3, account_id: accountId, total_cents: 640000,
      builder_state: { blocks: [] },
    }).select("id").single();
    if (draft.error) throw new Error(draft.error.message);
    draftId = draft.data.id as string;
    const day = 86_400_000;
    const visit = await db!.from("visits").insert({
      account_id: accountId, estimate_id: draftId, status: "done", customer_name: NAME, address: "7 Stage Street, Fairfield VIC 3078",
      starts_at: new Date(Date.now() - 3 * day).toISOString(), ends_at: new Date(Date.now() - 3 * day + 3_600_000).toISOString(),
      outcome_at: new Date(Date.now() - 3 * day + 3_600_000).toISOString(),
    }).select("id").single();
    if (visit.error) throw new Error(visit.error.message);
    visitId = visit.data.id as string;
    // The visit's done moment on the log, the way the diary writes it.
    const ev = await db!.rpc("crm_log_event", {
      p_type: "visit_completed", p_account_id: accountId, p_estimate_id: draftId, p_source: "staff",
      p_occurred_at: new Date(Date.now() - 3 * day + 3_600_000).toISOString(), p_payload: { visitId }, p_dedupe_key: `e2e-stage-visit:${visitId}`,
    });
    if (ev.error) throw new Error(ev.error.message);
  });
  test.afterAll(async () => {
    if (!db) return;
    if (visitId) await db.from("visits").delete().eq("id", visitId);
    for (const id of [sentId, draftId].filter(Boolean)) {
      await db.from("estimate_views").delete().eq("estimate_id", id);
      await db.from("estimates").delete().eq("id", id);
    }
    if (accountId) await db.from("accounts").delete().eq("id", accountId);
  });

  test("an anonymous customer's open moves the estimate from Estimate sent to Estimate viewed", async ({ browser }) => {
    const staffCtx = await browser.newContext();
    const staffPage = await staffCtx.newPage();
    await signIn(staffPage, staff!, /\/(home|estimates)/);
    await staffPage.goto(`/estimates/stage/${sentId}`);
    await expect(staffPage.getByTestId("estimate-stage")).toHaveAttribute("data-stage", "estimate_sent");

    const customerCtx = await browser.newContext();
    const customer = await customerCtx.newPage();
    await customer.goto(`/e/${token}`);
    await expect(customer.locator("details.room").first()).toBeVisible();
    await expect.poll(async () => {
      const { count, error } = await db!.from("crm_events").select("id", { count: "exact", head: true }).eq("estimate_id", sentId).eq("type", "estimate_viewed");
      if (error) throw new Error(error.message);
      return count ?? 0;
    }, { timeout: 15_000 }).toBe(1);

    await staffPage.reload();
    await expect(staffPage.getByTestId("estimate-stage")).toHaveAttribute("data-stage", "estimate_viewed");
    await expect(staffPage.getByTestId("estimate-stage-because")).toContainText("Opened 1×");
    await customerCtx.close(); await staffCtx.close();
  });

  test("a done visit with nothing sent reads Visit / call done, and is on Today as an estimate to send", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/estimates/stage/${draftId}`);
    await expect(page.getByTestId("estimate-stage")).toHaveAttribute("data-stage", "visit_done");

    await expect.poll(async () => {
      await page.goto("/crm/today?f=followups");
      return page.getByText(`${NAME} — visit done, estimate not sent`).count();
    }, { timeout: 60_000, intervals: [2_000, 5_000, 10_000] }).toBeGreaterThan(0);
  });
});
