import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./fixtures/woLoop";
import { gotoTodayWith } from "./helpers";
import { fillDetailsIfAsked, loginStaff, staffEmail, startCustomer, type Customer, cleanupCustomers } from "./customer-journey/visitHelpers";
import { STANDARD_WEEK } from "../lib/visits/schedule";

/**
 * Visit booking addendum A · S5 — what the platform does WITHOUT Google
 * (4.6: "Disconnecting the calendar stops customer booking for that estimator
 * and tells staff why"; "If Google cannot be reached when a customer confirms,
 * do not book blind"). The test project has no Google connection and no
 * Google credentials, so these are the paths that can be driven here:
 *
 *   · Booking rules say a calendar is required and the estimator has none:
 *     a zone customer gets the request-a-time screen, the API refuses a hold,
 *     and Today carries the "calendar not connected" card
 *   · a connection row that cannot be refreshed (a dead token) counts as
 *     Google unreachable — only when the stack has Google credentials
 */
const db: SupabaseClient | null = serviceClient();

test.describe("S5 — booking without a connected Google Calendar", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staffEmail, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_EMAIL");
  const customers: Customer[] = [];
  let staffId = "", hadWeek = false, rulesBefore: Record<string, unknown> = {};
  const zonesBefore = new Map<string, string | null>();

  test.beforeAll(async () => {
    const sb = db!;
    const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
    staffId = users?.users.find((x) => (x.email ?? "").toLowerCase() === staffEmail.toLowerCase())?.id ?? "";
    if (!staffId) throw new Error("staff login not found");
    const { data: zones } = await sb.from("visit_zones").select("key, estimator_id");
    for (const z of zones ?? []) zonesBefore.set(z.key as string, z.estimator_id as string | null);
    await sb.from("visit_zones").update({ estimator_id: staffId }).is("estimator_id", null);
    const { data: rulesRow } = await sb.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
    rulesBefore = (rulesRow?.value ?? {}) as Record<string, unknown>;
    // The rule ON — the production default.
    await sb.from("settings").upsert({ key: "visit_booking_rules", value: { ...rulesBefore, calendarRequired: true } }, { onConflict: "key" });
    const { data: slots } = await sb.from("visit_slots").select("id").eq("estimator_id", staffId).limit(1);
    hadWeek = !!slots?.length;
    if (!hadWeek) {
      const { error } = await sb.from("visit_slots").insert(STANDARD_WEEK.map((s) => ({ estimator_id: staffId, weekday: s.weekday, start_minutes: s.startMinutes, length_minutes: 90, zones: [...s.zones].sort(), cond_zone: s.cond?.zone ?? null, cond_if_prev_zone: s.cond?.ifPrevZone ?? null })));
      if (error) throw new Error(error.message);
    }
    await sb.from("staff_gcal_connections").delete().eq("staff_id", staffId).eq("google_email", "dead-token@example.com");
  });

  test.afterAll(async () => {
    const sb = db!;
    await cleanupCustomers(sb, customers);
    await sb.from("staff_gcal_connections").delete().eq("staff_id", staffId).eq("google_email", "dead-token@example.com");
    for (const [key, est] of zonesBefore) if (est === null) await sb.from("visit_zones").update({ estimator_id: null }).eq("key", key);
    if (!hadWeek) await sb.from("visit_slots").delete().eq("estimator_id", staffId);
    await sb.from("settings").upsert({ key: "visit_booking_rules", value: rulesBefore }, { onConflict: "key" });
  });

  test("no connected calendar: the customer is offered a request, a hold is refused, and staff see why on Today", async ({ browser, page }) => {
    const sb = db!;
    const { count } = await sb.from("staff_gcal_connections").select("staff_id", { count: "exact", head: true }).eq("staff_id", staffId);
    test.skip((count ?? 0) > 0, "the staff login has a real Google connection on this project");
    const c = await startCustomer(browser, "nocal");
    customers.push(c);
    await c.page.getByTestId("door-book").click();
    await fillDetailsIfAsked(c, "No Cal");
    await expect(c.page.getByTestId("visit-request")).toBeVisible();
    await expect(c.page.getByTestId("visit-calendar")).toHaveCount(0);
    await expect(c.page.getByTestId("visit-calendar-state")).toHaveAttribute("data-state", "none");
    const av = await (await c.page.request.get(`/api/visits/availability?estimateId=${c.estimateId}`)).json();
    expect(av.calendar).toBe("none");
    expect(av.days).toEqual([]);
    const hold = await c.page.request.post("/api/visits/hold", { data: { estimateId: c.estimateId, startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() } });
    expect(hold.status()).toBe(409);
    expect((await hold.json()).code).toBe("calendar_unavailable");

    await loginStaff(page);
    const card = page.getByText(/Google Calendar is not connected/).first();
    await gotoTodayWith(page, "/crm/today?f=approvals", card);
    await expect(card).toBeVisible();
    await expect(page.getByText(/cannot book a time until it is/).first()).toBeVisible();
  });

  test("a connection Google refuses to refresh counts as unreachable: no times, no booking", async ({ browser }) => {
    test.skip(!process.env.GOOGLE_CLIENT_ID, "needs Google credentials on the stack to attempt a token refresh");
    const sb = db!;
    const { count } = await sb.from("staff_gcal_connections").select("staff_id", { count: "exact", head: true }).eq("staff_id", staffId);
    test.skip((count ?? 0) > 0, "the staff login has a real Google connection on this project");
    const { error } = await sb.from("staff_gcal_connections").insert({ staff_id: staffId, google_email: "dead-token@example.com", refresh_token: "dead", scopes: "openid email https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events" });
    expect(error).toBeNull();
    const c = await startCustomer(browser, "deadcal");
    customers.push(c);
    const r = await c.page.request.post("/api/visits/details", { data: { estimateId: c.estimateId, name: "Dead Cal", email: c.email, mobile: c.mobile } });
    expect(r.status()).toBe(200);
    const av = await (await c.page.request.get(`/api/visits/availability?estimateId=${c.estimateId}`)).json();
    expect(av.calendar).toBe("unavailable");
    expect(av.days).toEqual([]);
    await c.page.goto(`/estimate/visit?id=${c.estimateId}`);
    await expect(c.page.getByTestId("visit-request")).toBeVisible();
    await expect(c.page.getByText("We can't show live times just now.")).toBeVisible();
  });
});
