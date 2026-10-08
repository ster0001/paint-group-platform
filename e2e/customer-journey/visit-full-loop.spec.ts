import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../fixtures/woLoop";
import { gotoTodayWith } from "../helpers";
import { cleanupCustomers, codeFor, ensureEstimator, loginStaff, staffEmail, startCustomer, type Customer } from "./visitHelpers";

/**
 * Visit booking addendum A · S7 — the full loop, as an ANONYMOUS customer:
 *
 *   wizard → gate (details first) → range → Book a site visit → calendar →
 *   hold → text code → booked → [Google event] → decline → the slot reopens.
 *
 * The test project has no Google credentials or connection, so the two Google
 * steps are driven at the seam the inbound sync uses: a booked visit cannot
 * reach Google here (no `staff_gcal_events` row), and "the guest declined" is
 * applied through the same RPC `lib/gcal/inbound.ts` calls when it classifies
 * an event as declined (`visit_set_status` → cancelled, `declined_invitation`).
 * From there everything is the platform's own: the visit cancelled, the event
 * on the record, the slot offered to the next customer, the card on Today.
 * The invitation itself, the decline from Gmail / Outlook / Apple Mail and the
 * cancel text are Tom's `docs/manual-tests/visit-gcal.md`.
 *
 * Also here, from section 8: 14 (another customer calling this booking by id
 * is refused — 403, as test 9 fixes it; 404 is "does not exist") and the platform half of 19 (a booked slot blocks its full
 * 90 minutes for the next customer, whatever happens to the travel block in
 * Google).
 *
 * The gate order is set to details first for the run and put back after.
 */
const db: SupabaseClient | null = serviceClient();
const SUBURB = "Glen Waverley"; // Zone 1

test.describe("S7 — the full loop", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staffEmail, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_EMAIL");
  const customers: Customer[] = [];
  let restore: () => Promise<void> = async () => undefined;
  let rulesBefore: Record<string, unknown> = {};

  test.beforeAll(async () => {
    restore = (await ensureEstimator(db!)).restore;
    const { data } = await db!.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
    rulesBefore = (data?.value ?? {}) as Record<string, unknown>;
    await db!.from("settings").upsert({ key: "visit_booking_rules", value: { ...rulesBefore, gateOrder: "details_first" } }, { onConflict: "key" });
  });
  test.afterAll(async () => {
    await cleanupCustomers(db!, customers);
    await restore();
    await db!.from("settings").upsert({ key: "visit_booking_rules", value: rulesBefore }, { onConflict: "key" });
  });

  test("wizard → gate → range → book → code → booked → declined → the slot reopens", async ({ browser, page }) => {
    const sb = db!;

    // ---- wizard → gate → range -------------------------------------------------------
    const a = await startCustomer(browser, "loop");
    customers.push(a);
    const { data: session } = await sb.from("wizard_drafts").select("gate_version, gate_completed_at, range_shown_at").eq("estimate_id", a.estimateId).maybeSingle();
    expect(session?.gate_version).toBe("details_first");
    expect(session?.gate_completed_at).not.toBeNull();
    expect(session?.range_shown_at).not.toBeNull();
    await expect(a.page.getByTestId("door-tighten")).toHaveAttribute("data-hero", "1");

    // ---- book: the details are known from the gate, so the calendar comes first --------
    await a.page.getByTestId("door-book").click();
    await a.page.waitForURL((u) => u.pathname === "/estimate/visit");
    await expect(a.page.getByTestId("visit-calendar")).toBeVisible();
    expect(await a.page.getByTestId("visit-details").count()).toBe(0);
    await expect.poll(async () => (await sb.from("wizard_drafts").select("range_option").eq("estimate_id", a.estimateId).maybeSingle()).data?.range_option, { timeout: 10_000 }).toBe("visit");
    await expect(a.page.getByText(`These are the times we are in ${SUBURB} and nearby.`)).toBeVisible();
    const firstTime = a.page.getByTestId("visit-time").first();
    const startsAt = new Date((await firstTime.getAttribute("data-starts-at")) ?? "").toISOString();
    await firstTime.click();
    await a.page.getByTestId("visit-book").click();

    // ---- the code -----------------------------------------------------------------
    await expect(a.page.getByTestId("visit-code")).toBeVisible();
    const code = await codeFor(sb, a.mobile);
    await a.page.getByTestId("visit-code-input").fill(code);
    await a.page.getByTestId("visit-confirm").click();
    await expect(a.page.getByTestId("visit-done")).toBeVisible();
    await expect(a.page.getByRole("heading", { name: "Your site visit is booked" })).toBeVisible();

    const { data: visit } = await sb.from("visits").select("id, status, zone, starts_at, ends_at, staff_id, customer_name").eq("estimate_id", a.estimateId).single();
    expect(visit).toMatchObject({ status: "booked", zone: "zone_1" });
    expect(new Date(visit!.starts_at as string).toISOString()).toBe(startsAt);
    const { data: booked } = await sb.from("crm_events").select("id").eq("type", "visit_booked").contains("payload", { visitId: visit!.id });
    expect(booked?.length).toBeGreaterThan(0);

    // ---- the Google event: nothing can reach Google on this project -----------------
    const { count: gcalRows } = await sb.from("staff_gcal_events").select("id", { count: "exact", head: true }).eq("ref_id", visit!.id);
    const { count: connections } = await sb.from("staff_gcal_connections").select("staff_id", { count: "exact", head: true }).eq("staff_id", visit!.staff_id as string);
    if ((connections ?? 0) === 0) expect(gcalRows ?? 0).toBe(0);

    // ---- the slot is gone for the next customer (section 8 · 19, platform half) ------
    const b = await startCustomer(browser, "next");
    customers.push(b);
    const offeredBefore = await offered(b);
    expect(offeredBefore).not.toContain(startsAt);
    expect(offeredBefore.length).toBeGreaterThan(0);

    // ---- section 8 · 14: another customer calling this booking by id is refused ------
    const { data: aHold } = await sb.from("visit_holds").select("id").eq("estimate_id", a.estimateId).limit(1).single();
    for (const [path, body] of [
      ["/api/visits/resend", { estimateId: a.estimateId, holdId: aHold!.id }],
      ["/api/visits/confirm", { estimateId: a.estimateId, holdId: aHold!.id, code: "123456" }],
    ] as const) {
      const r = await b.page.request.post(path, { data: body });
      expect(r.status(), `${path} as another customer`).toBe(403);
    }
    expect((await b.page.request.get(`/api/visits/availability?estimateId=${a.estimateId}`)).status()).toBe(403);
    const { data: still } = await sb.from("visits").select("status").eq("id", visit!.id).single();
    expect(still?.status).toBe("booked");

    // ---- the guest declines (what the inbound sync does when Google says so) ---------
    const { error: cancelErr } = await sb.rpc("visit_set_status", { p_id: visit!.id, p_status: "cancelled", p_note: "declined_invitation" });
    expect(cancelErr).toBeNull();
    const { data: after } = await sb.from("visits").select("status, cancel_reason, cancelled_at").eq("id", visit!.id).single();
    expect(after).toMatchObject({ status: "cancelled", cancel_reason: "declined_invitation" });
    expect(after?.cancelled_at).not.toBeNull();
    const { data: cancelled } = await sb.from("crm_events").select("id").eq("type", "visit_cancelled").contains("payload", { visitId: visit!.id });
    expect(cancelled?.length).toBeGreaterThan(0);

    // ---- the slot reopens -------------------------------------------------------------
    await expect.poll(async () => offered(b), { timeout: 20_000 }).toContain(startsAt);

    // ---- staff see it on Today ---------------------------------------------------------
    await loginStaff(page);
    const card = page.getByText(new RegExp(`${visit!.customer_name ?? "A customer"} declined the visit`)).first();
    await gotoTodayWith(page, "/crm/today?f=followups", card);
    await expect(card).toBeVisible();
    await expect(page.getByText(/the time is free again/).first()).toBeVisible();
  });
});

/** The start times the availability API offers this customer right now. */
async function offered(c: Customer): Promise<string[]> {
  const r = await c.page.request.get(`/api/visits/availability?estimateId=${c.estimateId}`);
  expect(r.status()).toBe(200);
  const av = await r.json() as { days: Array<{ slots: Array<{ startsAt: string }> }> };
  return av.days.flatMap((d) => d.slots.map((s) => new Date(s.startsAt).toISOString()));
}
