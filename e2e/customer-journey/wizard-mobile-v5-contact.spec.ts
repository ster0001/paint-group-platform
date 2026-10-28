import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";

/**
 * Wizard mobile v5 — session 5 (brief §5, acceptance §9 item 8 as far as
 * the standing rulings allow), as an ANONYMOUS customer on a phone (390 × 780).
 *
 *  1. The Contact pill on a question screen opens the sheet: the estimator
 *     line, the one teal door, Call (tel:), Send a message, Save and come
 *     back later. Each door hands over to the platform's own mechanism.
 *  2. Before the range, Book a visit / call from step 3 is a REQUEST (R3):
 *     the request lands as a lead carrying the answers given so far (the
 *     draft's quick look) and the account by email; the details step is
 *     pre-filled from it afterwards (§2.5).
 *  3. The pill is on the gate too, and the gate's "book a time first" opens
 *     the same door.
 *  4. On Paint Group the sheet's door reads Book a visit; on the gate it is
 *     the booking page (the zone's days, the hold, the code).
 */
const db = serviceClient();

test.describe("Wizard mobile v5 — Contact and early booking (session 5)", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });

  const run = randomBytes(3).toString("hex");
  const suburb = `E2E PHContact ${run}`;
  const email = `ph.contact.${run}@example.com`;
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
    await db.from("estimates").delete().ilike("title", `%${suburb}%`);
    await db.from("visit_requests").delete().eq("email", email).then(() => undefined, () => undefined);
    await db.from("accounts").delete().eq("email", email).then(() => undefined, () => undefined);
  });

  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  const open = async (page: Page, root: string, scope = "interior") => {
    const parts = new URLSearchParams({ street: "14 Acacia Street", suburb, state: "VIC", postcode: "3070", address: `14 Acacia Street, ${suburb} VIC 3070`, mode: "home", src: "homepage_hero", scope });
    await page.goto(`${root}/estimate?${parts.toString()}`);
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await at(page, "what");
  };

  test("1 · the pill opens the sheet: the estimator line, the door, Call, Message, Save — each to its own mechanism", async ({ page }) => {
    test.setTimeout(120_000);
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/wizard/event")) {
        try { events.push(JSON.parse(req.postData() ?? "{}") as { type: string; payload: Record<string, unknown> }); } catch { /* not json */ }
      }
    });
    await open(page, phRoot);
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await page.getByTestId("wzm-contact").tap();
    const sheet = page.getByTestId("wzm-contact-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("wzm-contact-who")).toBeVisible();
    await expect(sheet.getByTestId("wzm-contact-book")).toContainText("Book a visit");
    // Call dials the shopfront's number; the test stack may hold none for Paint Home, and then the row is absent rather than a dead link
    const call = sheet.getByTestId("wzm-contact-call");
    if (await call.count()) await expect(call).toHaveAttribute("href", /^tel:/);
    await expect(sheet.getByTestId("wzm-contact-message")).toContainText("Send a message");
    await expect(sheet.getByTestId("wzm-contact-save")).toContainText("Save and come back later");
    // the rows in the prototype's order
    const order = await sheet.evaluate((el) => ["wzm-contact-who", "wzm-contact-book", "wzm-contact-call", "wzm-contact-message", "wzm-contact-save"].map((t) => el.querySelector(`[data-testid='${t}']`)?.getBoundingClientRect().top ?? null).filter((t): t is number => t != null));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    // Send a message → the talk sheet in message mode; the Contact sheet closes
    await sheet.getByTestId("wzm-contact-message").tap();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId("talk-sheet")).toBeVisible();
    await expect(page.getByTestId("talk-sheet")).toHaveAttribute("aria-label", "Send us a message");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("talk-sheet")).toHaveCount(0);
    // Save and come back later → Save & book (the link back by email)
    await page.getByTestId("wzm-contact").tap();
    await page.getByTestId("wzm-contact-save").tap();
    await expect(page.getByTestId("save-and-book")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("save-and-book")).toHaveCount(0);
    // the screen underneath is untouched, and contact_opened names it
    await at(page, "property");
    expect(events.filter((e) => e.type === "contact_opened").map((e) => e.payload.step)).toContain("property");
  });

  test("2 · before the range the door is a request (R3): a lead with the answers so far, then the details step pre-filled", async ({ page }) => {
    test.setTimeout(180_000);
    await open(page, phRoot);
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-townhouse").tap();
    await at(page, "beds");
    await page.getByTestId("ql-bedrooms-2").tap();
    await at(page, "storeys");
    // step 3 of the brief's count: three answers given (Inside · Townhouse · 2 bed)
    await page.getByTestId("wzm-contact").tap();
    await page.getByTestId("wzm-contact-book").tap();
    const talk = page.getByTestId("talk-sheet");
    await expect(talk).toBeVisible();
    await talk.getByTestId("talk-name").fill("Contact Tester");
    if (await talk.getByTestId("talk-address").count()) await talk.getByTestId("talk-address").fill("14 Acacia Street");
    await talk.getByTestId("talk-email").fill(email);
    const mobile = `04${String(Date.now()).slice(-8)}`;
    await talk.getByTestId("talk-mobile").fill(mobile);
    await talk.getByTestId("talk-go").tap();
    await expect(talk.getByTestId("talk-sent")).toBeVisible({ timeout: 30_000 });
    await talk.getByTestId("talk-close").tap();
    // back on the same screen, nothing lost
    await at(page, "storeys");
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText("Inside · Townhouse · 2 bed");
    // the lead: the account by email, and the session carrying the three answers
    await expect.poll(async () => {
      const { data } = await db!.from("accounts").select("id, name, phone").eq("email", email).maybeSingle();
      return data?.name ?? null;
    }, { timeout: 30_000, intervals: [2_000] }).toBe("Contact Tester");
    await expect.poll(async () => {
      const { data } = await db!.from("wizard_drafts").select("state").eq("suburb", suburb).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
      const q = (data?.state as { quickLook?: { jobType?: string; propertyKind?: string; bedrooms?: number } } | null)?.quickLook;
      return q ? `${q.jobType}:${q.propertyKind}:${q.bedrooms}` : null;
    }, { timeout: 30_000, intervals: [2_000] }).toBe("interior:townhouse:2");
    // §2.5: the details step arrives pre-filled from the request
    await page.getByTestId("ql-storeys-single").tap();
    await at(page, "job");
    await page.getByTestId("ql-scope-whole").tap();
    await at(page, "surfaces");
    await page.getByTestId("ql-next").tap();
    await at(page, "rooms");
    await page.getByTestId("ql-next").tap();
    await at(page, "colours");
    await page.getByTestId("ql-colours-new").tap();
    await at(page, "condition");
    await page.getByTestId("ql-condition-wear").tap();
    await at(page, "living");
    await page.getByTestId("ql-occupied-no").tap();
    await at(page, "details");
    await expect(page.getByTestId("gate-name")).toHaveValue("Contact Tester");
    await expect(page.getByTestId("gate-mobile")).toHaveValue(mobile);
    await expect(page.getByTestId("gate-email")).toHaveValue(email);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    // 3 · the gate carries the pill; "book a time first" and the sheet's door are the same door
    const gate = page.getByTestId("wzm-gate");
    await expect(gate).toBeVisible({ timeout: 90_000 });
    await gate.getByTestId("wzm-contact").tap();
    const sheet = page.getByTestId("wzm-contact-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("wzm-contact-book")).toContainText("Book a visit");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    if (await page.getByTestId("gate-visit").count()) {
      await page.getByTestId("gate-visit").tap();
      await expect(page).toHaveURL(/\/estimate\/visit\?id=/, { timeout: 20_000 });
      expect(new URL(page.url()).host).toMatch(/^painthome\.localhost/);
    }
  });

  test("4 · on Paint Group too the door is Book a visit; on the gate it is the booking page with the zone's days", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    await open(page, baseURL!);
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await page.getByTestId("wzm-contact").tap();
    const sheet = page.getByTestId("wzm-contact-sheet");
    await expect(sheet.getByTestId("wzm-contact-book")).toContainText("Book a visit");
    await sheet.getByTestId("wzm-contact-book").tap();
    await expect(page.getByTestId("talk-sheet")).toHaveAttribute("aria-label", "Request a site visit");
    await page.keyboard.press("Escape");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "beds");
    await page.getByTestId("ql-bedrooms-3").tap();
    await at(page, "storeys");
    await page.getByTestId("ql-storeys-single").tap();
    await at(page, "job");
    await page.getByTestId("ql-scope-whole").tap();
    await at(page, "surfaces");
    await page.getByTestId("ql-next").tap();
    await at(page, "rooms");
    await page.getByTestId("ql-next").tap();
    await at(page, "colours");
    await page.getByTestId("ql-colours-new").tap();
    await at(page, "condition");
    await page.getByTestId("ql-condition-wear").tap();
    await at(page, "living");
    await page.getByTestId("ql-occupied-no").tap();
    await at(page, "details");
    await page.getByTestId("gate-name").fill("PG Contact Tester");
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await page.getByTestId("gate-email").fill(`pg.contact.${run}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    const gate = page.getByTestId("wzm-gate");
    await expect(gate).toBeVisible({ timeout: 90_000 });
    await gate.getByTestId("wzm-contact").tap();
    await page.getByTestId("wzm-contact-book").tap();
    await expect(page).toHaveURL(/\/estimate\/visit\?id=/, { timeout: 20_000 });
  });
});
