import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn, test } from "../helpers";

/**
 * Estimates tab & funnel, session 4 (brief §4.2–4.4, §5, rulings E‑J, E‑N):
 * Pipeline, Online now and Work queue on real rows.
 *
 *  1. An ANONYMOUS customer opens the estimate they were sent: on the Pipeline
 *     its card moves from Estimate sent to Estimate viewed, reading Viewed 1×.
 *     The card's menu marks the customer hot (crm_set_temperature).
 *  2. A live wizard session (heartbeat < 5 min) is under Online now.
 *  3. A done visit with nothing sent is on the Work queue.
 *  4. A login kept off Pipeline and Funnel (Settings → Staff logins) sees
 *     neither chip, and the URL serves All estimates — enforced on the server.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const NAME = `Views Tester ${run}`;
const LIVE = `Live Session ${run}`;
const password = "painttest123";
const pcEmail = `pg.e2e.pcviews.${run}@example.com`;

const SNAPSHOT = {
  version: 1, estRef: `EST-V${run}`,
  company: { name: "Paint Group Pty Ltd", addressLine1: "1 Example St", addressLine2: "Melbourne VIC", phone: "(03) 9000 0000", abn: "11 222 333 444", email: "hello@example.com", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: NAME, contactEmail: "", jobTitle: "Interior repaint", jobAddress: "4 Views Street, Fairfield VIC 3078",
  gstRatePct: 10, depositPct: 10, lineItems: [], options: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 200000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 200000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
  paints: [],
};

test.describe("Estimates views, session 4 — Pipeline, Online now, Work queue", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  let accountId = ""; let sentId = ""; let draftId = ""; let visitId = ""; let liveId = ""; let pcId = "";
  const token = `views${run}${randomBytes(8).toString("hex")}`;

  test.beforeAll(async () => {
    const acc = await db!.from("accounts").insert({ email: `pg.e2e.views.${run}@example.com`, name: NAME, phone: `0400 ${run.slice(0, 3)} 7${run.slice(3, 5)}` }).select("id").single();
    if (acc.error) throw new Error(acc.error.message);
    accountId = acc.data.id as string;
    const sent = await db!.from("estimates").insert({
      title: `Views sent ${run}`, status: "sent", source: "manual", level_of_finish: 3, share_token: token, account_id: accountId,
      sent_at: new Date().toISOString(), total_cents: 220000,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {}, contact: { first_name: "Views", last_name: `Tester ${run}` } },
      sent_snapshot: SNAPSHOT,
    }).select("id").single();
    if (sent.error) throw new Error(sent.error.message);
    sentId = sent.data.id as string;
    const draft = await db!.from("estimates").insert({
      title: `Views after visit ${run}`, status: "draft", source: "manual", level_of_finish: 3, account_id: accountId, builder_state: { blocks: [] },
    }).select("id").single();
    if (draft.error) throw new Error(draft.error.message);
    draftId = draft.data.id as string;
    const day = 86_400_000;
    const visit = await db!.from("visits").insert({
      account_id: accountId, estimate_id: draftId, status: "done", customer_name: NAME, address: "4 Views Street, Fairfield VIC 3078",
      starts_at: new Date(Date.now() - 3 * day).toISOString(), ends_at: new Date(Date.now() - 3 * day + 3_600_000).toISOString(),
      outcome_at: new Date(Date.now() - 3 * day + 3_600_000).toISOString(),
    }).select("id").single();
    if (visit.error) throw new Error(visit.error.message);
    visitId = visit.data.id as string;
    const live = await db!.from("wizard_drafts").insert({ name: LIVE, suburb: "Fairfield", job_type: "interior", last_seen_at: new Date().toISOString() }).select("id").single();
    if (live.error) throw new Error(live.error.message);
    liveId = live.data.id as string;
    // A PC login kept off Pipeline and Funnel (the pg.e2e.* marker: global-teardown removes it too).
    const made = await db!.auth.admin.createUser({ email: pcEmail, password, email_confirm: true });
    if (made.error) throw new Error(made.error.message);
    pcId = made.data.user!.id;
    const prof = await db!.from("profiles").upsert({ id: pcId, role: "staff", name: `PC ${run}`, is_owner: false,
      staff_access: { estimates_pipeline: false, estimates_funnel: false }, staff_roles: ["pc"] }, { onConflict: "id" });
    if (prof.error) throw new Error(prof.error.message);
  });
  test.afterAll(async () => {
    if (!db) return;
    if (liveId) await db.from("wizard_drafts").delete().eq("id", liveId);
    if (visitId) await db.from("visits").delete().eq("id", visitId);
    for (const id of [sentId, draftId].filter(Boolean)) {
      await db.from("estimate_views").delete().eq("estimate_id", id);
      await db.from("estimates").delete().eq("id", id);
    }
    if (accountId) await db.from("accounts").delete().eq("id", accountId);
    if (pcId) await db.auth.admin.deleteUser(pcId);
  });

  test("an anonymous customer's open moves the card to Estimate viewed; the menu marks them hot", async ({ browser }) => {
    test.setTimeout(120_000);
    const staffCtx = await browser.newContext();
    const page = await staffCtx.newPage();
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    await page.goto("/estimates?view=pipeline");
    const card = page.getByTestId(`pipeline-card-${sentId}`);
    await expect(page.getByTestId("lane-estimate_sent").getByTestId(`pipeline-card-${sentId}`)).toBeVisible({ timeout: 30_000 });

    const customerCtx = await browser.newContext();
    const customer = await customerCtx.newPage();
    await customer.goto(`/e/${token}`);
    await expect(customer.locator("details.room").first()).toBeVisible();
    await expect.poll(async () => {
      const { count, error } = await db!.from("crm_events").select("id", { count: "exact", head: true }).eq("estimate_id", sentId).eq("type", "estimate_viewed");
      if (error) throw new Error(error.message);
      return count ?? 0;
    }, { timeout: 15_000 }).toBe(1);
    await customerCtx.close();

    await page.reload();
    await expect(page.getByTestId("lane-estimate_viewed").getByTestId(`pipeline-card-${sentId}`)).toBeVisible();
    await expect(page.getByTestId(`pipeline-viewed-${sentId}`)).toHaveText("Viewed 1×");
    // The lanes add up to the total the header gives.
    const total = Number(await page.getByTestId("pipeline").getAttribute("data-total"));
    const counts = await page.locator('[data-testid^="lane-"]').evaluateAll((els) => els.reduce((s, e) => s + Number(e.getAttribute("data-count")), 0));
    expect(counts).toBe(total);
    // No drag handle on a card: nothing on the board is draggable.
    await expect(page.getByTestId("pipeline").locator('[draggable="true"]')).toHaveCount(0);

    await page.getByTestId(`pipeline-menu-${sentId}`).click();
    await page.getByTestId(`pipeline-menu-${sentId}-hot`).click();
    await expect(card).toHaveAttribute("data-temperature", "hot", { timeout: 15_000 });
    await staffCtx.close();
  });

  test("a live session is under Online now; a done visit is on the Work queue", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    await page.goto("/estimates?view=online");
    await expect(page.getByTestId("online-online").getByTestId(`online-row-${liveId}`)).toContainText(LIVE);

    await expect.poll(async () => {
      await page.goto("/estimates?view=queue");
      return page.getByText(`${NAME} — visit done, estimate not sent`).count();
    }, { timeout: 60_000, intervals: [2_000, 5_000, 10_000] }).toBeGreaterThan(0);
  });

  test("a login kept off Pipeline and Funnel sees neither, even by URL", async ({ page }) => {
    await signIn(page, { email: pcEmail, password }, /\/(home|estimates|crm|quote|pc|$)/);
    await page.goto("/estimates?view=pipeline");
    await expect(page.getByTestId("estimates-view-all")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("estimates-view-pipeline")).toHaveCount(0);
    await expect(page.getByTestId("estimates-view-funnel")).toHaveCount(0);
    await expect(page.getByTestId("pipeline")).toHaveCount(0);
    await expect(page.getByTestId("estimates-view-queue")).toBeVisible();
  });
});
