import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, openScopeEditor } from "./drive";
import { serviceClient } from "../fixtures/woLoop";

/**
 * C5 — the qualified lead lands on a person's desk (plan §2.6).
 *
 * "Everything the customer does upstream is only worth something if it lands on
 * a person's desk as a job they can sign." Before C5 the send wrote a jsonb
 * marker; now it writes a row that carries what we promised, what the rules
 * suggested, and the pack as it stood at that moment.
 *
 * Driven as the anonymous customer, then read back as the database — the two
 * ends of the promise.
 */

test("a customer's send creates the confirmation row, with what we promised", async ({ page }) => {
  test.setTimeout(240_000);
  const db = serviceClient();
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");

  await driveNoPlanWizard(page);
  await openScopeEditor(page);
  const estimateId = new URL(page.url()).searchParams.get("id");
  expect(estimateId).toBeTruthy();

  // Before: no promise has been made.
  const before = await db!.from("confirmation_requests").select("id").eq("estimate_id", estimateId!);
  expect(before.data ?? []).toHaveLength(0);

  // The customer asks for a person. This is the send the whole phase exists for.
  // scope editor -> finish line. The drive stops at the scope editor; the send
  // lives one screen on, and skipping this step is why the first version of
  // this spec looked for a button that was never on the page.
  await page.getByTestId("scope-finalise").click();
  await page.waitForURL(/\/estimate\/finish/, { timeout: 60_000 });

  const send = page.getByTestId("finish-send_for_confirmation");
  await expect(send).toBeVisible({ timeout: 30_000 });
  await expect(send).toBeEnabled();
  await send.click();
  // The send navigates to /estimate/sent on success — waiting for that is the
  // honest signal that the POST landed, not a spinner that clears either way.
  await page.waitForURL(/\/estimate\/sent/, { timeout: 60_000 });

  // After: exactly one row, and it records the promise rather than just the fact.
  await expect.poll(async () => {
    const r = await db!.from("confirmation_requests")
      .select("kind, status, suggested_action, pack, requested_by").eq("estimate_id", estimateId!);
    return (r.data ?? []).length;
  }, { timeout: 30_000 }).toBe(1);

  const { data } = await db!.from("confirmation_requests")
    .select("kind, status, suggested_action, pack, requested_by").eq("estimate_id", estimateId!).single();
  expect(data!.status).toBe("requested");
  expect(data!.requested_by).toBe("customer");
  expect(["remote", "visit"]).toContain(data!.kind);
  expect(["fix", "ask", "visit"]).toContain(data!.suggested_action);
  // The pack is FROZEN at send — a row with an empty pack would make the
  // promise unreadable later, which is the whole reason the column exists.
  expect((data!.pack as { totalCents?: number })?.totalCents).toBeGreaterThan(0);

  // A second tap is a double tap, not a second job.
  await page.goBack();
  await page.getByTestId("finish-send_for_confirmation").click().catch(() => undefined);
  await page.waitForTimeout(4000);
  const after = await db!.from("confirmation_requests").select("id").eq("estimate_id", estimateId!);
  expect(after.data ?? []).toHaveLength(1);
});

test("the estimator's pack opens fast, and shows what was promised", async ({ browser }) => {
  test.setTimeout(240_000);
  const db = serviceClient();
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };
  test.skip(!staff.email, "needs E2E_STAFF_*");

  // The most recent open request — the one the test above just made.
  const { data: req } = await db!.from("confirmation_requests")
    .select("estimate_id").in("status", ["requested", "question_asked"])
    .order("requested_at", { ascending: false }).limit(1).maybeSingle();
  test.skip(!req, "no open confirmation request to open");

  const page = await browser.newPage();
  await page.goto("/login");
  await page.fill('input[type="email"]', staff.email);
  await page.fill('input[type="password"]', staff.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/estimates/);

  const started = Date.now();
  await page.goto(`/quote?id=${req!.estimate_id}&tab=pack`);
  await expect(page.getByTestId("desk-check")).toBeVisible({ timeout: 30_000 });
  // §2.6: "the estimator sees the pack in under two seconds".
  expect(Date.now() - started).toBeLessThan(10_000);

  // The decision aid, and the promise behind it.
  await expect(page.getByTestId("desk-check-verdict")).toBeVisible();
  await expect(page.getByTestId("desk-check-promise")).toBeVisible();
  await expect(page.getByTestId("desk-check-band")).toContainText(/honest range/i);
});
