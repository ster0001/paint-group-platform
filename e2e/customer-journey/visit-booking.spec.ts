import { test, expect, type Browser, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { driveNoPlanWizard } from "./drive";
import { serviceClient } from "../fixtures/woLoop";
import { STANDARD_WEEK } from "../../lib/visits/schedule";

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
const staffEmail = process.env.E2E_STAFF_EMAIL ?? "";
const run = randomBytes(3).toString("hex");
const SUBURB = "Glen Waverley", POSTCODE = "3150"; // Zone 1

type Customer = { page: Page; estimateId: string; mobile: string; email: string };

export async function startCustomer(browser: Browser, tag: string, suburb = SUBURB, postcode = POSTCODE): Promise<Customer> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await driveNoPlanWizard(page, { stopAtReveal: true, suburb, postcode });
  const estimateId = (await page.getByTestId("reveal").getAttribute("data-estimate-id")) ?? "";
  expect(estimateId).toBeTruthy();
  const mobile = `04${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  return { page, estimateId, mobile, email: `visit.${tag}.${run}@example.com` };
}

export async function codeFor(sb: SupabaseClient, mobile: string): Promise<string> {
  const e164 = `+61${mobile.replace(/\D/g, "").slice(1)}`;
  for (let i = 0; i < 20; i++) {
    const { data } = await sb.from("messages").select("body, created_at").eq("to_address", e164).ilike("body", "%code to book%").order("created_at", { ascending: false }).limit(1);
    const m = /\b(\d{6})\b/.exec((data?.[0]?.body as string | undefined) ?? "");
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no code text recorded for ${e164}`);
}

/** The staff login covers every zone and has a week, for the length of the run. */
export async function ensureEstimator(sb: SupabaseClient): Promise<{ staffId: string; restore: () => Promise<void> }> {
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const u = users?.users.find((x) => (x.email ?? "").toLowerCase() === staffEmail.toLowerCase());
  if (!u) throw new Error("staff login not found");
  const staffId = u.id;
  const { data: zones } = await sb.from("visit_zones").select("key, estimator_id");
  const before = new Map((zones ?? []).map((z) => [z.key as string, z.estimator_id as string | null]));
  await sb.from("visit_zones").update({ estimator_id: staffId }).is("estimator_id", null);
  const { data: slots } = await sb.from("visit_slots").select("id").eq("estimator_id", staffId).limit(1);
  const hadWeek = !!slots?.length;
  if (!hadWeek) {
    const { error } = await sb.from("visit_slots").insert(STANDARD_WEEK.map((s) => ({ estimator_id: staffId, weekday: s.weekday, start_minutes: s.startMinutes, length_minutes: 90, zones: [...s.zones].sort(), cond_zone: s.cond?.zone ?? null, cond_if_prev_zone: s.cond?.ifPrevZone ?? null })));
    if (error) throw new Error(error.message);
  }
  return {
    staffId,
    restore: async () => {
      for (const [key, est] of before) if (est === null) await sb.from("visit_zones").update({ estimator_id: null }).eq("key", key);
      if (!hadWeek) await sb.from("visit_slots").delete().eq("estimator_id", staffId);
    },
  };
}

export async function cleanupCustomers(sb: SupabaseClient, customers: Customer[]) {
  const ids = customers.map((c) => c.estimateId).filter(Boolean);
  if (ids.length) {
    await sb.from("visits").delete().in("estimate_id", ids);
    await sb.from("visit_holds").delete().in("estimate_id", ids);
  }
  for (const c of customers) {
    const { data: acc } = await sb.from("accounts").select("id").eq("email", c.email).maybeSingle();
    if (acc) {
      await sb.from("estimates").update({ account_id: null, property_id: null }).eq("account_id", acc.id);
      await sb.from("properties").delete().eq("account_id", acc.id);
      await sb.from("accounts").delete().eq("id", acc.id);
    }
  }
}

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
