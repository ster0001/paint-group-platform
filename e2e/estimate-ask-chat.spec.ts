import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Tom, 20 Sep 2026:
 *  1. "The Ask a question button isn't working on the estimate — pop up the
 *     live chat box." The hero button, the accept panel's Message us and the
 *     #chat link all open the same thread as a pop-up in the corner, over the
 *     page; a message sent from it lands on the estimate's thread.
 *  2. "Always keep the live chat box visible on the platform in the bottom
 *     corner, regardless of which page you are on." The staff dock's pill is
 *     there with nothing open, on every staff shell.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");

const SNAPSHOT = {
  version: 1,
  company: { name: "Paint Group Pty Ltd", addressLine1: "1 Example St", addressLine2: "Melbourne VIC", phone: "(03) 9000 0000", abn: "11 222 333 444", email: "hello@example.com", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: "Casey Asker", contactEmail: "", jobTitle: "Interior repaint", jobAddress: "5 Question Street, Fairfield VIC 3078",
  gstRatePct: 10, depositPct: 10,
  lineItems: [], options: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 200000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 200000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
  paints: [],
};

test.describe("Ask a question opens the chat pop-up; the staff dock never leaves the corner", () => {
  test.skip(!db, "needs the service key");
  let estimateId = "";
  const token = `askchat${run}${randomBytes(8).toString("hex")}`;

  test.beforeAll(async () => {
    const r = await db!.from("estimates").insert({
      title: `Ask chat ${run}`, status: "sent", source: "manual", level_of_finish: 3, share_token: token,
      sent_at: new Date().toISOString(), total_cents: 220000,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
      sent_snapshot: { ...SNAPSHOT, estRef: `EST-A${run}` },
    }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    estimateId = r.data.id;
  });
  test.afterAll(async () => {
    if (estimateId) {
      await db!.from("estimate_messages").delete().eq("estimate_id", estimateId);
      await db!.from("estimates").delete().eq("id", estimateId);
    }
  });

  test("hero 'Ask a question' pops the chat up over the page; a message lands on the thread; Message us and #chat open the same box", async ({ page }) => {
    await page.goto(`/e/${token}`);
    await expect(page.locator("details.room").first()).toBeVisible();
    await expect(page.getByTestId("chat-pop")).toHaveCount(0);

    await page.getByTestId("ask-a-question").click();
    const pop = page.getByTestId("chat-pop");
    await expect(pop).toBeVisible();
    await expect(pop).toContainText("Chat with us");
    // Fixed in the corner, not somewhere down the page: it is in view without scrolling.
    expect(await pop.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    const box = (await pop.boundingBox())!;
    const vh = await page.evaluate(() => window.innerHeight);
    expect(box.y + box.height).toBeLessThanOrEqual(vh);

    await pop.getByPlaceholder("Type your message…").fill(`Is the ceiling included? ${run}`);
    await pop.getByRole("button", { name: "Send message" }).click();
    await expect(pop.locator(".chatrow.mine .chatbody")).toContainText(`Is the ceiling included? ${run}`);
    const { data } = await db!.from("estimate_messages").select("direction, body").eq("estimate_id", estimateId);
    expect(data).toEqual([{ direction: "customer", body: `Is the ceiling included? ${run}` }]);

    // Close, then the accept panel's button opens the same box.
    await page.getByTestId("chat-pop-close").click();
    await expect(page.getByTestId("chat-pop")).toHaveCount(0);
    await page.locator("#accept").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: /Open chat|Message us/ }).click();
    await expect(page.getByTestId("chat-pop")).toBeVisible();
    await expect(page.getByTestId("chat-pop").locator(".chatrow.mine")).toHaveCount(1);

    // The #chat deep link (the SMS/email "reply here" link) opens it on load.
    await page.goto(`/e/${token}#chat`);
    await expect(page.getByTestId("chat-pop")).toBeVisible();
  });

  test("the old 'ask' form is gone — one chat, one place", async ({ page }) => {
    await page.goto(`/e/${token}`);
    await expect(page.locator("details.room").first()).toBeVisible();
    await page.getByTestId("ask-a-question").click();
    await expect(page.getByRole("button", { name: "Send question" })).toHaveCount(0);
    await expect(page.getByPlaceholder(/Anything you'd like to check/)).toHaveCount(0);
  });

  test("staff: the chat dock pill is in the corner on every staff shell, even with no chat open", async ({ page }) => {
    const staff = credentials("STAFF");
    test.skip(!staff, missingCreds("STAFF"));
    await signIn(page, staff!, /\/(estimates|crm|quote|home)/);
    for (const path of ["/estimates", "/crm", "/invoicing", "/pc", `/quote?id=${estimateId}`]) {
      await page.goto(path);
      const dock = page.getByTestId("staff-dock");
      await expect(dock, path).toBeVisible({ timeout: 30_000 });
      const box = (await dock.boundingBox())!;
      const vh = await page.evaluate(() => window.innerHeight);
      expect(box.y + box.height, path).toBeLessThanOrEqual(vh + 1);
      // Minimised or open, it is there: the pill, or the panel.
      await expect(dock.locator("[data-testid=dock-pill], .dk-panel").first(), path).toBeVisible();
    }
  });
});
