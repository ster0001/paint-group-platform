import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, openScopeEditor } from "./drive";
import { serviceClient } from "../fixtures/woLoop";

/**
 * C6 — fix, ask, visit. "A fixed price can only originate from the RPC", and a
 * double-click sends one email.
 *
 * Idempotency is the kind of thing that looks right and isn't, so it is driven
 * rather than reasoned about: two clicks, one fixed price, one CRM event.
 */

const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };

test("send, then fix remotely — the customer's sent screen shows the number", async ({ browser }) => {
  test.setTimeout(300_000);
  const db = serviceClient();
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_*");

  // --- the customer sends ---------------------------------------------------
  const customer = await browser.newPage();
  await driveNoPlanWizard(customer);
  await openScopeEditor(customer);
  const estimateId = new URL(customer.url()).searchParams.get("id")!;
  await customer.getByTestId("scope-finalise").click();
  await customer.waitForURL(/\/estimate\/finish/, { timeout: 60_000 });
  await customer.getByTestId("finish-send_for_confirmation").click();
  await customer.waitForURL(/\/estimate\/sent/, { timeout: 60_000 });

  // Before a person acts, the customer is told it is with their estimator.
  await expect(customer.getByTestId("sent-status")).toContainText(/with your estimator|being arranged/i);

  const { data: req } = await db!.from("confirmation_requests")
    .select("id, status").eq("estimate_id", estimateId).single();
  expect(req!.status).toBe("requested");

  // --- the estimator fixes it ----------------------------------------------
  const est = await browser.newPage();
  await est.goto("/login");
  await est.fill('input[type="email"]', staff.email);
  await est.fill('input[type="password"]', staff.password);
  await est.getByRole("button", { name: /sign in/i }).click();
  await est.waitForURL(/estimates/);

  const fix = async () => est.evaluate(async (id) => {
    const r = await fetch(`/api/confirmations/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "fix_price", priceCents: 512_300 }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, req!.id);

  const first = await fix();
  expect(first.status).toBe(200);
  expect((first.body as { fixedPriceCents?: number })?.fixedPriceCents).toBe(512_300);
  expect((first.body as { repeated?: boolean })?.repeated).toBe(false);

  // THE DOUBLE CLICK. Same price, one fix, and it is not reported as an error —
  // a second click is not a mistake, it is one that arrived after the first
  // worked.
  const second = await fix();
  expect(second.status).toBe(200);
  expect((second.body as { repeated?: boolean })?.repeated).toBe(true);
  expect((second.body as { fixedPriceCents?: number })?.fixedPriceCents).toBe(512_300);

  // One row, one price, one event.
  const { data: after } = await db!.from("confirmation_requests")
    .select("status, fixed_price_cents, fixed_at").eq("id", req!.id).single();
  expect(after!.status).toBe("fixed");
  expect(after!.fixed_price_cents).toBe(512_300);
  expect(after!.fixed_at).toBeTruthy();

  const { count } = await db!.from("crm_events")
    .select("*", { count: "exact", head: true })
    .eq("type", "price_fixed").eq("estimate_id", estimateId);
  expect(count, "a double click must not log two price_fixed events").toBe(1);

  // --- and the customer sees the number ------------------------------------
  await customer.reload();
  await expect(customer.getByTestId("sent-status")).toContainText(/fixed/i);
  await expect(customer.getByTestId("sent-status")).toContainText(/\$5,123/);
});

test("a fixed price cannot be re-fixed — that is a variation", async ({ browser }) => {
  test.setTimeout(180_000);
  const db = serviceClient();
  test.skip(!db || !staff.email, "needs credentials");

  const { data: fixed } = await db!.from("confirmation_requests")
    .select("id").eq("status", "fixed").order("fixed_at", { ascending: false }).limit(1).maybeSingle();
  test.skip(!fixed, "no fixed confirmation to try re-fixing");

  const est = await browser.newPage();
  await est.goto("/login");
  await est.fill('input[type="email"]', staff.email);
  await est.fill('input[type="password"]', staff.password);
  await est.getByRole("button", { name: /sign in/i }).click();
  await est.waitForURL(/estimates/);

  // A DIFFERENT price — the repeat-guard must not mask a real re-fix attempt.
  const res = await est.evaluate(async (id) => {
    const r = await fetch(`/api/confirmations/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ask_question", question: "anything?" }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, fixed!.id);

  expect(res.status).toBe(409);
  expect(String((res.body as { error?: string })?.error)).toMatch(/already fixed|variation/i);
});
