import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Visit booking addendum A · S2 — the schedule and booking rules, as staff on
 * the real screens.
 *
 *   · Visit schedule: load the standard week for the staff login (21 slots,
 *     per-zone totals 16/13/6/5/9), toggle a zone on Monday 11:00 and watch
 *     the Zone 1 total fall, a slot with no zones shows the warning
 *   · adding a slot inside another's 90 minutes is refused (section 8, test 18)
 *   · Booking rules: change the window and a public holiday, read it back
 *
 * Cleanup: the slots this spec created for the staff login are deleted
 * (only if the login had none before), and the rules row is put back.
 */

const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };

async function loginAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe("S2 — visit schedule and booking rules", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  let staffId = "", hadWeek = false;
  let rulesBefore: unknown = null;

  test.beforeAll(async () => {
    const sb = db!;
    const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const u = users?.users.find((x) => (x.email ?? "").toLowerCase() === staff.email.toLowerCase());
    if (!u) throw new Error("staff login not found");
    staffId = u.id;
    const { data: slots, error } = await sb.from("visit_slots").select("id").eq("estimator_id", staffId).limit(1);
    if (error) throw new Error(`visit_slots: ${error.message} — run migration 20270213 on the test project`);
    hadWeek = !!slots?.length;
    const { data: r } = await sb.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
    rulesBefore = r?.value ?? null;
  });

  test.afterAll(async () => {
    const sb = db!;
    if (!hadWeek) await sb.from("visit_slots").delete().eq("estimator_id", staffId);
    if (rulesBefore) await sb.from("settings").upsert({ key: "visit_booking_rules", value: rulesBefore }, { onConflict: "key" });
  });

  test("load the standard week; toggling a zone changes the live count; an empty slot warns", async ({ page }) => {
    test.skip(hadWeek, "the staff login already has a week; not overwriting it");
    await loginAs(page, staff);
    await page.goto("/settings#visit-schedule");
    await page.getByTestId(`sched-est-${staffId}`).click();
    await expect(page.getByTestId("sched-empty")).toBeVisible();
    await page.getByTestId("sched-load-standard").click();
    await page.waitForLoadState("networkidle");
    await page.goto("/settings#visit-schedule");
    await page.getByTestId(`sched-est-${staffId}`).click();
    await expect(page.getByTestId("sched-empty")).toHaveCount(0);
    const totals = async () => Promise.all([1, 2, 3, 4, 5].map((z) => page.getByTestId(`sched-total-${z}`).getByTestId("total-n").innerText()));
    expect(await totals()).toEqual(["16", "13", "6", "5", "9"]);
    const { count } = await db!.from("visit_slots").select("id", { count: "exact", head: true }).eq("estimator_id", staffId);
    expect(count).toBe(21);

    // Monday 11:00 is Zone 1 only. Turn Zone 1 off → warning; the Zone 1 total drops to 15.
    await page.getByTestId("sched-day-1").click();
    const slot = page.getByTestId("slot-1-660");
    await slot.getByRole("button").first().click();
    await slot.getByTestId("slot-zone-1").click();
    await expect(page.getByTestId("visit-schedule-msg")).toContainText("nobody can book it");
    await expect(slot.getByTestId("slot-no-zones")).toBeVisible();
    expect(await totals()).toEqual(["15", "13", "6", "5", "9"]);
    const { data: row } = await db!.from("visit_slots").select("zones").eq("estimator_id", staffId).eq("weekday", 1).eq("start_minutes", 660).single();
    expect(row?.zones).toEqual([]);
    // And back on — wait for the save to land before reading the count.
    await slot.getByTestId("slot-zone-1").click();
    await expect(slot.getByTestId("slot-no-zones")).toHaveCount(0);
    await expect(page.getByTestId("visit-schedule-msg")).toContainText("11:00: Zone 1.");
    expect(await totals()).toEqual(["16", "13", "6", "5", "9"]);

    // Friday 12:30 carries the R14 rule.
    await page.getByTestId("sched-day-5").click();
    await expect(page.getByTestId("slot-5-750")).toContainText("Zone 1 if the visit before is Zone 1");
  });

  test("a slot that starts inside another slot's 90 minutes is refused (test 18)", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto("/settings#visit-schedule");
    await page.getByTestId(`sched-est-${staffId}`).click();
    await page.getByTestId("sched-day-1").click();
    await page.getByTestId("sched-add-time").fill("08:45");
    await page.getByTestId("sched-add").click();
    await expect(page.getByTestId("visit-schedule-msg")).toContainText("starts inside the 08:00 slot");
    const { count } = await db!.from("visit_slots").select("id", { count: "exact", head: true }).eq("estimator_id", staffId).eq("weekday", 1).eq("start_minutes", 525);
    expect(count).toBe(0);
    // The database refuses it too, with the server action out of the way.
    const direct = await db!.from("visit_slots").insert({ estimator_id: staffId, weekday: 1, start_minutes: 525, length_minutes: 90, zones: ["zone_1"] });
    expect(direct.error?.message ?? "").toMatch(/visit_slots_no_overlap/);
  });

  test("booking rules save and read back", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto("/settings#booking-rules");
    await expect(page.getByTestId("booking-rules")).toBeVisible();
    await page.getByTestId("rules-windowDays").fill("14");
    await page.getByTestId("rules-holiday-new").fill("2026-12-25");
    await page.getByTestId("rules-holiday-add").click();
    await expect(page.getByTestId("rules-holidays")).toContainText("2026-12-25");
    await page.getByTestId("rules-save").click();
    await expect(page.getByTestId("rules-msg")).toContainText("Saved");
    const { data } = await db!.from("settings").select("value").eq("key", "visit_booking_rules").single();
    expect(data?.value).toMatchObject({ windowDays: 14, publicHolidays: ["2026-12-25"], slotMinutes: 90, visitMinutes: 60 });
    // A visit longer than the slot is refused.
    await page.getByTestId("rules-visitMinutes").fill("120");
    await page.getByTestId("rules-save").click();
    await expect(page.getByTestId("rules-msg")).toContainText("cannot be longer than the slot");
  });
});
