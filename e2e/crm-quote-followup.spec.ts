import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 15 Sep: "ensure sent quote reminders go into the CRM to be followed
 * up — I can't see all of them in there." A quote sent and quiet past the
 * chase threshold (Settings → CRM, default 3 days unopened) is now a
 * Follow-up card on CRM Today. This drives the real screen: seed a customer
 * with a quote sent six days ago and nothing logged since, and find the card.
 */
test.describe("CRM Today — a sent quote gone quiet is a follow-up", () => {
  const staff = credentials("STAFF");
  const db = serviceClient();
  const run = Date.now();
  const NAME = `Quiet Quote ${run}`;
  let accountId = "";
  let estimateId = "";
  // Tom, 7 Oct 2026: a second customer with a reminder set and a quiet quote, who then ACCEPTS.
  const WON = `Won Customer ${run}`;
  let wonAccountId = "";
  let wonQuoteId = "";
  let wonAcceptedId = "";

  test.beforeAll(async () => {
    if (!db) return;
    const acc = await db.from("accounts").insert({ email: `quiet.quote.${run}@example.com`, name: NAME, phone: null }).select("id").single();
    if (acc.error) throw new Error(acc.error.message);
    accountId = acc.data.id as string;
    const est = await db.from("estimates").insert({
      title: `Quiet quote ${run}`, status: "sent", level_of_finish: 3, total_cents: 612_000,
      account_id: accountId, sent_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
      valid_until: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
      builder_state: { blocks: [] },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;

    const won = await db.from("accounts").insert({
      email: `won.customer.${run}@example.com`, name: WON, phone: null,
      followup_due_at: new Date(Date.now() - 86_400_000).toISOString(), followup_note: "Chase the quote",
    }).select("id").single();
    if (won.error) throw new Error(won.error.message);
    wonAccountId = won.data.id as string;
    const quiet = await db.from("estimates").insert({
      title: `Won quiet quote ${run}`, status: "sent", level_of_finish: 3, total_cents: 512_000,
      account_id: wonAccountId, sent_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
      valid_until: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
      builder_state: { blocks: [] },
    }).select("id").single();
    if (quiet.error) throw new Error(quiet.error.message);
    wonQuoteId = quiet.data.id as string;
    // The acceptance — the trigger (20270219) clears the reminder as the row lands.
    const acc2 = await db.from("estimates").insert({
      title: `Won accepted quote ${run}`, status: "accepted", level_of_finish: 3, total_cents: 530_000,
      account_id: wonAccountId, sent_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      accepted_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      valid_until: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
      builder_state: { blocks: [] },
    }).select("id").single();
    if (acc2.error) throw new Error(acc2.error.message);
    wonAcceptedId = acc2.data.id as string;
  });

  test.afterAll(async () => {
    if (!db) return;
    if (estimateId) await db.from("estimates").delete().eq("id", estimateId);
    if (accountId) await db.from("accounts").delete().eq("id", accountId);
    for (const id of [wonQuoteId, wonAcceptedId]) if (id) await db.from("estimates").delete().eq("id", id);
    if (wonAccountId) await db.from("accounts").delete().eq("id", wonAccountId);
  });

  test("the quiet quote is a Follow-up card on Today, with its value and one action", async ({ page }) => {
    test.skip(!staff, missingCreds("STAFF"));
    test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
    await signIn(page, staff!, /home|estimates|crm/);
    // The Follow-ups group; the test project carries hundreds of open items,
    // so walk its pages (50 a page) until the card shows up.
    let card = page.locator(".qitem", { hasText: NAME });
    let found = false;
    for (let p = 1; p <= 12 && !found; p++) {
      await page.goto(`/crm/today?who=all&f=followups&page=${p}`);
      await expect(page.getByTestId("who-chips")).toBeVisible({ timeout: 30_000 });
      card = page.locator(".qitem", { hasText: NAME }).first();
      found = (await card.count()) > 0;
      if (!found && (await page.locator(`a[href*="page=${p + 1}"]`).count()) === 0) break;
    }
    expect(found, "a sent quote quiet for 6 days must be on CRM Today").toBe(true);
    await expect(card).toContainText("quote sent, no reply");
    await expect(card).toContainText("$6,120");
    await expect(card).toContainText("never opened");
    await expect(card.getByTestId("item-action")).toHaveAttribute("href", `/crm/customers/${accountId}`);
  });

  test("a job accepted removes the customer's follow-ups: the reminder is cleared and the quiet quote raises no card (Tom, 7 Oct 2026)", async ({ page }) => {
    test.skip(!staff, missingCreds("STAFF"));
    test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
    // The stored reminder went with the acceptance — the database did it, not the screen.
    const { data: acc, error } = await db!.from("accounts").select("followup_due_at, followup_note, snoozed_until").eq("id", wonAccountId).single();
    expect(error).toBeNull();
    expect(acc).toEqual({ followup_due_at: null, followup_note: null, snoozed_until: null });

    await signIn(page, staff!, /home|estimates|crm/);
    for (let p = 1; p <= 12; p++) {
      await page.goto(`/crm/today?who=all&f=followups&page=${p}`);
      await expect(page.getByTestId("who-chips")).toBeVisible({ timeout: 30_000 });
      expect(await page.locator(".qitem", { hasText: WON }).count(), `page ${p}: an accepted customer must not be chased`).toBe(0);
      if ((await page.locator(`a[href*="page=${p + 1}"]`).count()) === 0) break;
    }
  });
});
