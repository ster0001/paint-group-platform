import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";

/**
 * Estimates tab & funnel, session 1 (docs/briefs/claude-code-brief-estimates-tab-funnel.md,
 * rulings E-A / E-B), as an ANONYMOUS customer:
 *
 *  1. The wizard on a phone: every event it writes carries the session on the
 *     log's own column (`crm_events.wizard_draft_id`), leaving a screen forward
 *     writes `wizard_step_completed` (Back does not), and coming back to the
 *     draft writes `wizard_session_resumed` — `wizard_drafts.visits` used to
 *     stay at 1 for everybody, because nothing told the server it was a return.
 *  2. The estimate page: a refresh is the same view, not a new one. A new tab
 *     is a new view.
 *
 * Reads go through the service key on purpose: this checks what was WRITTEN,
 * not what a role may read (crm_events is staff-only; no customer reads it).
 */
const db = serviceClient();

test.describe("Funnel events, session 1 — the wizard session on the log", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });

  const run = randomBytes(3).toString("hex");
  const suburb = `E2E Funnel ${run}`;
  let phRoot = "";

  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}`;
  });
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
  });

  const open = async (page: Page) => {
    const parts = new URLSearchParams({ street: "9 Funnel Street", suburb, state: "VIC", postcode: "3070", address: `9 Funnel Street, ${suburb} VIC 3070`, mode: "home", src: "homepage_hero", scope: "interior" });
    await page.goto(`${phRoot}/estimate?${parts.toString()}`);
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
  };
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });

  test("events carry the session; forward completes a step, Back does not; a return is counted", async ({ page }) => {
    test.setTimeout(120_000);
    let draftId = "";
    page.on("response", async (res) => {
      if (res.request().method() !== "POST" || !res.url().includes("/api/wizard/draft")) return;
      const j = await res.json().catch(() => null) as { id?: string } | null;
      if (j?.id) draftId = j.id;
    });

    await open(page);
    await at(page, "what");
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "beds");
    await page.getByTestId("wzm-back").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "beds");
    // the autosave (2.5s debounce) writes the draft; then come back to it
    await expect.poll(() => draftId, { timeout: 15_000 }).not.toBe("");
    await page.reload();
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId("wz-resume")).toContainText("Welcome back", { timeout: 20_000 });
    await at(page, "beds");

    type Row = { type: string; payload: Record<string, unknown>; wizard_draft_id: string | null };
    const rows = async (): Promise<Row[]> => {
      const { data, error } = await db!.from("crm_events").select("type, payload, wizard_draft_id").eq("wizard_draft_id", draftId);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    };
    await expect.poll(async () => (await rows()).some((r) => r.type === "wizard_session_resumed"), { timeout: 20_000, message: "a return writes wizard_session_resumed" }).toBe(true);

    const all = await rows();
    const viewed = all.filter((r) => r.type === "wizard_step_viewed").map((r) => r.payload.step);
    expect(viewed, "step views carry the session on the column").toEqual(expect.arrayContaining(["what", "property", "beds"]));
    const completed = all.filter((r) => r.type === "wizard_step_completed").map((r) => r.payload.step).sort();
    expect(completed, "what and property were left forward; beds was only left by Back").toEqual(["property", "what"]);
    const resumed = all.filter((r) => r.type === "wizard_session_resumed");
    expect(resumed.map((r) => r.payload.visit), "one return, the second visit").toEqual([2]);

    const { data: draft, error } = await db!.from("wizard_drafts").select("visits").eq("id", draftId).single();
    if (error) throw new Error(error.message);
    expect(draft.visits).toBe(2);
  });
});

test.describe("Funnel events, session 1 — one estimate view per visit", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  const run = randomBytes(3).toString("hex");
  const token = `funnelview${run}${randomBytes(8).toString("hex")}`;
  let estimateId = "";

  test.beforeAll(async () => {
    const r = await db!.from("estimates").insert({
      title: `Funnel views ${run}`, status: "sent", source: "manual", level_of_finish: 3, share_token: token,
      sent_at: new Date().toISOString(), total_cents: 220000,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
      sent_snapshot: {
        version: 1, estRef: `EST-F${run}`,
        company: { name: "Paint Group Pty Ltd", addressLine1: "1 Example St", addressLine2: "Melbourne VIC", phone: "(03) 9000 0000", abn: "11 222 333 444", email: "hello@example.com", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
        contactName: "Casey Viewer", contactEmail: "", jobTitle: "Interior repaint", jobAddress: "9 Funnel Street, Fairfield VIC 3078",
        gstRatePct: 10, depositPct: 10, lineItems: [], options: [], inclusions: [], exclusions: [], terms: "",
        discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 200000,
        proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
        areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 200000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
        paints: [],
      },
    }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    estimateId = r.data.id;
  });
  test.afterAll(async () => {
    if (!estimateId) return;
    await db!.from("estimate_views").delete().eq("estimate_id", estimateId);
    await db!.from("estimates").delete().eq("id", estimateId);
  });

  const views = async () => {
    const { count, error } = await db!.from("estimate_views").select("id", { count: "exact", head: true }).eq("estimate_id", estimateId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  test("a refresh is the same view; a new tab is a new one", async ({ page, context }) => {
    await page.goto(`/e/${token}`);
    await expect(page.locator("details.room").first()).toBeVisible();
    await expect.poll(views, { timeout: 15_000 }).toBe(1);

    await page.reload();
    await expect(page.locator("details.room").first()).toBeVisible();
    await page.waitForTimeout(3_000); // the first ping goes on mount; give a second row every chance to appear
    expect(await views(), "a refresh is not a second view").toBe(1);

    const second = await context.newPage();
    await second.goto(`/e/${token}`);
    await expect(second.locator("details.room").first()).toBeVisible();
    await expect.poll(views, { timeout: 15_000 }).toBe(2);
  });
});
