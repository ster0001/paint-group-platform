import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../fixtures/woLoop";
import { cleanupCustomers, codeFor, ensureEstimator, staffEmail, startCustomer, type Customer } from "./visitHelpers";

/**
 * Visit booking addendum A · S3 walking skeleton, as an ANONYMOUS customer:
 * guide range → Book your estimator → a few details → calendar → hold →
 * text code → "Your site visit is booked". Then a second customer in the
 * same zone no longer sees that slot.
 *
 * The test stack has no Twilio, so the code is read back from the `messages`
 * row the adapter records (body stored, status not_configured).
 *
 * Cleanup: the visits, holds and accounts this spec created are removed in
 * afterAll; the estimator assignment and week it had to create are put back.
 */

const db: SupabaseClient | null = serviceClient();
const SUBURB = "Glen Waverley"; // Zone 1

test.describe("S3 — book a site visit as an anonymous customer", () => {
  test.skip(!db || !staffEmail, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_EMAIL");
  const customers: Customer[] = [];
  let restore: () => Promise<void> = async () => undefined;

  test.beforeAll(async () => { restore = (await ensureEstimator(db!)).restore; });
  test.afterAll(async () => { await cleanupCustomers(db!, customers); await restore(); });

  test("range → details → calendar → code → booked; the slot is gone for the next customer", async ({ browser }) => {
    const sb = db!;
    const a = await startCustomer(browser, "a");
    customers.push(a);
    const page = a.page;

    await page.getByTestId("door-book").click();
    await page.waitForURL((u) => u.pathname === "/estimate/visit");

    // We hold nothing yet — the details screen, mockup wording.
    await expect(page.getByTestId("visit-details")).toBeVisible();
    await expect(page.getByRole("heading", { name: "A few details first" })).toBeVisible();
    await page.getByTestId("visit-name").fill("Alex Morgan");
    await page.getByTestId("visit-email").fill(a.email);
    await page.getByTestId("visit-mobile").fill(a.mobile);
    await page.getByTestId("visit-details-go").click();

    // The calendar: "These are the times we are in Glen Waverley and nearby."
    await expect(page.getByTestId("visit-calendar")).toBeVisible();
    await expect(page.getByText(`These are the times we are in ${SUBURB} and nearby.`)).toBeVisible();
    await expect(page.getByTestId("visit-none-suit")).toHaveText("None of these suit? Request a different time");
    await expect(page.getByTestId("visit-tighten")).toHaveText("Tighten your price online");
    const firstTime = page.getByTestId("visit-time").first();
    const startsAt = await firstTime.getAttribute("data-starts-at");
    expect(startsAt).toBeTruthy();
    await firstTime.click();
    await expect(page.getByTestId("visit-book")).toContainText(/^Book /);
    await page.getByTestId("visit-book").click();

    // The code screen: the one-hour summary, the masked mobile, the hold clock.
    await expect(page.getByTestId("visit-code")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Confirm it’s you" })).toBeVisible();
    const summary = await page.getByTestId("visit-summary").innerText();
    expect(summary).toMatch(/\d{1,2}:\d{2} [ap]m to \d{1,2}:\d{2} [ap]m/);
    await expect(page.getByText(/We have sent a 6-digit code by text to 04\d{2} ••• \d{3}\./)).toBeVisible();
    await expect(page.getByTestId("visit-hold-clock")).toBeVisible();
    const { data: hold } = await sb.from("visit_holds").select("id, starts_at, zone, far_edge, expires_at").eq("estimate_id", a.estimateId).is("released_at", null).single();
    expect(hold?.zone).toBe("zone_1");
    expect(new Date(hold!.starts_at as string).toISOString()).toBe(new Date(startsAt!).toISOString());

    // A wrong code first, then the real one from the recorded text.
    await page.getByTestId("visit-code-input").fill("000000");
    await page.getByTestId("visit-confirm").click();
    await expect(page.getByTestId("visit-error")).toContainText("That code isn't right");
    const code = await codeFor(sb, a.mobile);
    await page.getByTestId("visit-code-input").fill(code);
    await page.getByTestId("visit-confirm").click();

    await expect(page.getByTestId("visit-done")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your site visit is booked" })).toBeVisible();
    await expect(page.getByText("We have sent the details by text, and a calendar invitation by email. We will send a reminder by text the evening before. If you need to cancel, decline the invitation or call us.")).toBeVisible();

    // The visit row, frozen with its zone; the hold confirmed; the event; the text.
    const { data: visit } = await sb.from("visits").select("id, status, source, kind, zone, far_edge, starts_at, ends_at, staff_id, customer_phone").eq("estimate_id", a.estimateId).single();
    expect(visit).toMatchObject({ status: "booked", source: "wizard", kind: "quote", zone: "zone_1", far_edge: false });
    expect(new Date(visit!.ends_at as string).getTime() - new Date(visit!.starts_at as string).getTime()).toBe(60 * 60_000);
    const { data: holdAfter } = await sb.from("visit_holds").select("confirmed_visit_id").eq("id", hold!.id).single();
    expect(holdAfter?.confirmed_visit_id).toBe(visit!.id);
    const { data: ev } = await sb.from("crm_events").select("id").eq("type", "visit_booked").contains("payload", { visitId: visit!.id });
    expect(ev?.length).toBeGreaterThan(0);
    const { data: texts } = await sb.from("messages").select("body").eq("to_address", `+61${a.mobile.slice(1)}`).ilike("body", "%site visit is booked%");
    expect(texts?.length).toBe(1);
    expect(texts![0].body as string).toMatch(/\d{1,2}:\d{2} [ap]m to \d{1,2}:\d{2} [ap]m/);

    // A second customer in the same zone does not see that slot.
    const b = await startCustomer(browser, "b");
    customers.push(b);
    await b.page.getByTestId("door-book").click();
    await b.page.getByTestId("visit-name").fill("Sam Lee");
    await b.page.getByTestId("visit-email").fill(b.email);
    await b.page.getByTestId("visit-mobile").fill(b.mobile);
    await b.page.getByTestId("visit-details-go").click();
    await expect(b.page.getByTestId("visit-calendar")).toBeVisible();
    const r = await b.page.request.get(`/api/visits/availability?estimateId=${b.estimateId}`);
    const av = await r.json() as { days: Array<{ slots: Array<{ startsAt: string }> }> };
    const offered = av.days.flatMap((d) => d.slots.map((s) => new Date(s.startsAt).toISOString()));
    expect(offered).not.toContain(new Date(startsAt!).toISOString());
    expect(offered.length).toBeGreaterThan(0);
  });
});
