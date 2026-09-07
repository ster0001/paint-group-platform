import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * CRM v2 · P6 — visits and the Diary, driven as staff on the real screens (C1).
 *
 *   · Settings → Estimator visits: an estimator starts taking visits
 *   · the record's Visits panel books one: the row, the CRM event, the lane
 *   · the same estimator at an overlapping time is refused by the database
 *   · the Diary lane shows it; "No show" records the outcome, Today raises
 *     the rebook item, the lane falls back to the quote
 *   · "Book again" moves it; "Done" completes it → "Visit done" lane
 *   · cancel writes visit_cancelled
 */

const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };
const run = randomBytes(4).toString("hex");
const NAME = `Vera Visit ${run}`;
const EMAIL = `crm.p6.${run}@volume.example`;

async function loginAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Next Tuesday, as a Melbourne calendar date — a weekday well clear of the cutoff. */
function nextTuesday(): string {
  const d = new Date(Date.now() + 2 * 86_400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test.describe("CRM v2 P6 — visits and the Diary", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  let accountId = "", staffId = "", hadAvailability = false, visitId = "";
  const day = nextTuesday();

  test.beforeAll(async () => {
    const sb = db!;
    const acc = await sb.from("accounts").insert({ email: EMAIL, name: NAME, phone: `0400 ${run.slice(0, 3)} 9${run.slice(3, 5)}` }).select("id").single();
    if (acc.error) throw new Error(acc.error.message);
    accountId = acc.data.id as string;
    await sb.from("properties").insert({ account_id: accountId, address: `7 Visit Lane`, suburb: `Visitville${run}`, state: "VIC", postcode: "3000" });
    const est = await sb.from("estimates").insert({
      title: `P6 visit ${run}`, status: "sent", level_of_finish: 3, total_cents: 380_000, account_id: accountId,
      sent_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), builder_state: { blocks: [] },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    const { data: s } = await sb.from("profiles").select("id").eq("role", "staff").order("created_at").limit(1).single();
    staffId = s!.id as string;
    const { data: av } = await sb.from("staff_availability").select("staff_id").eq("staff_id", staffId).maybeSingle();
    hadAvailability = !!av;
  });

  test.afterAll(async () => {
    const sb = db!;
    // Every delete is checked and retried once: a swallowed transient error
    // here shows up later as a foreign-key failure on the account delete.
    const wipe = async (table: string, col: string, val: string) => {
      for (let i = 0; i < 2; i++) {
        const { error } = await sb.from(table).delete().eq(col, val);
        if (!error) return;
        if (i === 1) throw new Error(`${table} delete failed: ${error.message}`);
      }
    };
    await wipe("visits", "account_id", accountId);
    if (!hadAvailability) await wipe("staff_availability", "staff_id", staffId);
    await wipe("estimates", "account_id", accountId);
    await wipe("properties", "account_id", accountId);
    await wipe("accounts", "id", accountId);
  });

  test("Settings → Estimator visits: an estimator starts taking visits", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto("/settings#estimator-visits");
    const row = page.getByTestId(`avail-${staffId}`);
    await expect(row).toBeVisible();
    const tick = row.getByTestId(`avail-${staffId}-takes`);
    if (!(await tick.isChecked())) await tick.check();
    await row.getByTestId(`avail-${staffId}-save`).click();
    await expect(page.getByTestId("visits-msg")).toContainText("Saved");
    const { data } = await db!.from("staff_availability").select("takes_visits").eq("staff_id", staffId).single();
    expect(data?.takes_visits).toBe(true);
  });

  test("the record books a visit; the row, the event and the lane follow; a clash is refused", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/customers/${accountId}`);
    await page.getByTestId("book-visit").click();
    await page.getByTestId("visit-staff").selectOption(staffId);
    await page.getByTestId("visit-date").fill(day);
    await page.getByTestId("visit-time").fill("10:00");
    await page.getByTestId("visit-save").click();
    await expect(page.getByTestId("visit-said")).toContainText("Booked");
    await expect(page.getByTestId("status-line")).toContainText("Visit booked");

    const { data: v } = await db!.from("visits").select("id, status, staff_id, customer_name, address, starts_at").eq("account_id", accountId).single();
    expect(v).toMatchObject({ status: "booked", staff_id: staffId, customer_name: NAME });
    expect(v?.address).toContain("7 Visit Lane");
    visitId = v!.id as string;
    const { data: ev } = await db!.from("crm_events").select("type, payload").eq("account_id", accountId).eq("type", "visit_booked");
    expect(ev?.length).toBe(1);
    expect((ev![0].payload as { visitId: string }).visitId).toBe(visitId);

    // Overlapping, same estimator: the database says no.
    await page.getByTestId("book-visit").click();
    await page.getByTestId("visit-staff").selectOption(staffId);
    await page.getByTestId("visit-date").fill(day);
    await page.getByTestId("visit-time").fill("10:30");
    await page.getByTestId("visit-save").click();
    await expect(page.getByTestId("visit-said")).toContainText("already taken");
    const { count } = await db!.from("visits").select("id", { count: "exact", head: true }).eq("account_id", accountId);
    expect(count).toBe(1);
  });

  test("the Diary lane shows it; a no-show raises the rebook item and clears the lane", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/diary?view=day&d=${day}`);
    const lane = page.getByTestId(`lane-${staffId}`);
    await expect(lane).toContainText(NAME);
    const card = page.getByTestId(`visit-${visitId}`);
    await card.getByRole("button", { name: "No show" }).click();
    await card.getByTestId("outcome-form").getByPlaceholder(/Anything to note/).fill(`Nobody home ${run}`);
    await card.getByRole("button", { name: "Record no show" }).click();
    await expect(page.getByTestId("diary-said")).toContainText("No show recorded");
    const { data: v } = await db!.from("visits").select("status, outcome_note").eq("id", visitId).single();
    expect(v).toMatchObject({ status: "no_show", outcome_note: `Nobody home ${run}` });

    await page.goto("/crm/today?f=followups");
    await expect(page.getByText(`${NAME} — visit was a no-show, rebook it`)).toBeVisible();
    await page.goto(`/crm/customers/${accountId}`);
    await expect(page.getByTestId("status-line")).toContainText("Estimate sent");
  });

  test("book again moves it; done completes it into the 'visit done' lane; cancel writes its event", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/diary?view=week&d=${day}`);
    const card = page.getByTestId(`visit-${visitId}`);
    await card.getByRole("button", { name: "Book again" }).click();
    const form = card.getByTestId("move-form");
    await form.getByLabel("Time").fill("14:00");
    await form.getByRole("button", { name: "Move it" }).click();
    await expect(page.getByTestId("diary-said")).toContainText("Moved");
    const { data: moved } = await db!.from("visits").select("status, starts_at, reminder_sent_at").eq("id", visitId).single();
    expect(moved?.status).toBe("booked");
    expect(new Date(moved!.starts_at as string).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hour12: false })).toBe("14:00");

    await page.reload();
    const again = page.getByTestId(`visit-${visitId}`);
    await again.getByRole("button", { name: "Done", exact: true }).click();
    await again.getByTestId("outcome-form").getByPlaceholder(/What came of it/).fill(`Measured up ${run}`);
    await again.getByRole("button", { name: "Mark done" }).click();
    await expect(page.getByTestId("diary-said")).toContainText("Marked done");
    const { data: ev } = await db!.from("crm_events").select("type").eq("account_id", accountId).in("type", ["visit_completed", "visit_no_show", "visit_booked"]);
    expect(ev?.map((e) => e.type).sort()).toEqual(["visit_booked", "visit_booked", "visit_completed", "visit_no_show"]);
    await page.goto(`/crm/customers/${accountId}`);
    await expect(page.getByTestId("status-line")).toContainText(/Visited today|silent/);

    // A second visit, then cancelled.
    const { data: second, error } = await db!.rpc("visit_book", {
      p_starts: new Date(`${day}T04:00:00Z`).toISOString(), p_ends: new Date(`${day}T05:00:00Z`).toISOString(),
      p_account: accountId, p_staff: staffId, p_kind: "remeasure", p_source: "phone",
    });
    expect(error).toBeNull();
    await page.goto(`/crm/customers/${accountId}`);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId(`record-visit-${second}`).getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("visit-said")).toContainText("Cancelled");
    const { data: cancelled } = await db!.from("crm_events").select("id").eq("account_id", accountId).eq("type", "visit_cancelled");
    expect(cancelled?.length).toBe(1);
  });
});
