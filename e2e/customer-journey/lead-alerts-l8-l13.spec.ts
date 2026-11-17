import { expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, gotoTodayWith, signIn, test, userIdFor } from "../helpers";
import { textedCodeFor } from "./drive";
import { requestAlertRoute } from "../../lib/staff/requestAlertRules";
import { LEAD_STEPS, stepDueAt } from "../../lib/automations/leadSequence";

/**
 * Lead L8, L9 / L10 / L13 and L10's customer chat (17 Nov 2026).
 *
 *   1 · An anonymous customer opens their range page on another phone, proves
 *       the mobile, and asks for a visit time. Staff are alerted by the office
 *       hours (R4) — the staff_notifications row names who and by what — and
 *       the staff chat pop-up shows "Visit request" on that estimate.
 *   2 · A customer on the holding page asks for a call (no estimate, no
 *       session): L13 fires once, routed by the hours.
 *   3 · L10's chat: a visit request nobody has answered a working day later
 *       gets "I'm sorting a time" on the customer's own chat; L8: a lead who
 *       tightened and booked nothing is Appendix A's call card on Today.
 * Every key ships OFF: the spec switches them on for its run and puts the
 * settings and the staff routing back.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const SECRET = process.env.CRON_SECRET ?? "";
const hours = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const KEYS = ["office_visit_request", "office_call_request", "office_lead_help", "lead_visit_request_ack"];
const ALERTS = ["office_visit_request", "office_call_request", "office_lead_help"];

type Seeded = { estId: string; draftId: string; token: string; phone: string; email: string };
const freshMobile = () => `04${String(parseInt(randomBytes(4).toString("hex"), 16)).padStart(8, "0").slice(0, 8)}`;

async function seedLead(tag: string, rangeHoursAgo: number, over: { bucket?: string } = {}): Promise<Seeded> {
  const token = `alert${tag}${run}${randomBytes(12).toString("hex")}`;
  const phone = freshMobile();
  const email = `alert${tag}.${run}@lead-alerts.invalid`;
  const snapshot = { version: 1, kind: "lead", rangeLoCents: 700_000, rangeHiCents: 760_000, parts: null, jobType: "interior", firstName: `Alert${tag}`, address: `${tag} Alert Street, Fairfield VIC 3078`, biggerJob: false, pricedAt: hours(rangeHoursAgo) };
  const est = await db!.from("estimates").insert({
    title: `${tag} Alert Street`, status: "draft", source: "customer_intake", level_of_finish: 3, share_token: token, lead_snapshot: snapshot,
    builder_state: { blocks: [], modSel: {}, materials: {}, contact: { name: `Alert${tag} Tester`, email, phone } },
  }).select("id").single();
  if (est.error) throw new Error(est.error.message);
  const draft = await db!.from("wizard_drafts").insert({
    estimate_id: est.data.id, suburb: `E2E Alert ${run}`, job_type: "interior", mode: "home", name: `Alert${tag} Tester`,
    started_at: hours(rangeHoursAgo + 0.3), last_seen_at: hours(Math.min(rangeHoursAgo, 1)), gate_completed_at: hours(rangeHoursAgo), range_shown_at: hours(rangeHoursAgo),
    ...(over.bucket ? { bucket: over.bucket } : {}),
  }).select("id").single();
  if (draft.error) throw new Error(draft.error.message);
  return { estId: est.data.id as string, draftId: draft.data.id as string, token, phone, email };
}

test.describe("Lead alerts L9 / L10 / L13, L10's chat and L8", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ staffDock: "live" });
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!staff, "set E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD");
  let saved: Record<string, unknown> | null = null;
  let touched = false;
  let staffId = "";
  let savedNotify: unknown = null;
  let notifyTouched = false;
  const leads: Seeded[] = [];
  const emails: string[] = [];

  test.beforeAll(async () => {
    const { data, error } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    if (error) throw new Error(error.message);
    saved = (data as { value: Record<string, unknown> } | null)?.value ?? null;
    const base = saved ?? {};
    const enabled = [...new Set([...((base.enabled as string[] | undefined) ?? []), ...KEYS])];
    const disabled = ((base.disabled as string[] | undefined) ?? []).filter((k) => !KEYS.includes(k));
    const up = await db!.from("settings").upsert({ key: "messaging", value: { ...base, enabled, disabled } }, { onConflict: "key" });
    if (up.error) throw new Error(up.error.message);
    touched = true;

    // The e2e staff login takes the three alerts by email and by text, for this run only.
    staffId = (await userIdFor(staff!)) ?? "";
    const prof = await db!.from("profiles").select("staff_notify").eq("id", staffId).single();
    if (prof.error) throw prof.error;
    savedNotify = (prof.data as { staff_notify: unknown }).staff_notify;
    const ticked = await db!.from("profiles").update({
      staff_notify: { ...((savedNotify as Record<string, unknown> | null) ?? {}), ...Object.fromEntries(ALERTS.map((k) => [k, ["email", "sms"]])) },
    }).eq("id", staffId);
    if (ticked.error) throw ticked.error;
    notifyTouched = true;
  });

  test.afterAll(async () => {
    if (!db) return;
    if (touched) {
      if (saved === null) await db.from("settings").delete().eq("key", "messaging");
      else await db.from("settings").upsert({ key: "messaging", value: saved }, { onConflict: "key" });
    }
    if (notifyTouched) await db.from("profiles").update({ staff_notify: savedNotify }).eq("id", staffId);
    for (const l of leads) {
      const ev = await db.from("crm_events").select("id").eq("estimate_id", l.estId);
      const ids = ((ev.data ?? []) as { id: string }[]).map((e) => e.id);
      if (ids.length) await db.from("staff_notifications").delete().in("entity_id", ids);
      await db.from("automation_claims").delete().eq("entity_id", l.estId);
      await db.from("estimate_draft_doors").delete().eq("estimate_id", l.estId);
      await db.from("visit_requests").delete().eq("estimate_id", l.estId);
      await db.from("estimate_messages").delete().eq("estimate_id", l.estId);
      await db.from("messages").delete().eq("estimate_id", l.estId);
      await db.from("crm_events").delete().eq("estimate_id", l.estId);
      await db.from("crm_events").delete().eq("wizard_draft_id", l.draftId);
      await db.from("wizard_drafts").delete().eq("id", l.draftId);
      await db.from("estimates").delete().eq("id", l.estId);
    }
    for (const email of [...emails, ...leads.map((l) => l.email)]) {
      const acc = await db.from("accounts").select("id").eq("email", email);
      for (const a of (acc.data ?? []) as { id: string }[]) {
        const ev = await db.from("crm_events").select("id").eq("account_id", a.id);
        const ids = ((ev.data ?? []) as { id: string }[]).map((e) => e.id);
        if (ids.length) await db.from("staff_notifications").delete().in("entity_id", ids);
        await db.from("crm_events").delete().eq("account_id", a.id);
        await db.from("visit_requests").delete().eq("account_id", a.id);
        await db.from("accounts").delete().eq("id", a.id);
      }
    }
  });

  /** The alert row for one CRM event, and who it went to by what. */
  async function alertFor(eventId: string) {
    for (let i = 0; i < 20; i++) {
      const { data, error } = await db!.from("staff_notifications").select("event_key, recipients, created_at").eq("entity_id", eventId);
      if (error) throw new Error(error.message);
      if (data && data.length) return data as { event_key: string; recipients: { profile_id: string; channel: string }[]; created_at: string }[];
      await new Promise((r) => setTimeout(r, 500));
    }
    return [];
  }
  const holidays = async () => {
    const r = await db!.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
    if (r.error) throw r.error;
    return new Set(((r.data as { value?: { publicHolidays?: string[] } } | null)?.value?.publicHolidays ?? []));
  };

  test("1 · a visit request from another phone alerts staff by the hours, and the pop-up shows it", async ({ browser, page }) => {
    test.setTimeout(240_000);
    const lead = await seedLead("A", 3); leads.push(lead);

    // The customer: range page → Book a visit → the code to the mobile on file → their visit page.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const cust = await ctx.newPage();
    await cust.goto(`/e/${lead.token}`);
    await cust.getByTestId("lead-book-visit").click();
    await cust.getByTestId("lead-code-send").click();
    await expect(cust.getByTestId("lead-code-input")).toBeVisible({ timeout: 20_000 });
    const { code } = await textedCodeFor(db!, lead.phone);
    await cust.getByTestId("lead-code-input").fill(code);
    await cust.getByTestId("lead-code-verify").click();
    await cust.waitForURL(/\/estimate\/visit\?id=/, { timeout: 30_000 });

    // … and asks for a time (the visit page's request, as the page itself posts it).
    const before = requestAlertRoute(new Date(), await holidays());
    const res = await cust.request.post("/api/visits/request", { data: {
      estimateId: lead.estId, kind: "time", name: "AlertA Tester", email: lead.email, mobile: lead.phone,
      suburb: "Fairfield", postcode: "3078", preferredDays: [2], timeOfDay: "morning",
    } });
    expect(res.status(), await res.text()).toBe(200);
    await ctx.close();
    const after = requestAlertRoute(new Date(), await holidays());

    const ev = await db!.from("crm_events").select("id").eq("estimate_id", lead.estId).eq("type", "visit_request_made");
    if (ev.error) throw ev.error;
    expect(ev.data).toHaveLength(1);
    const fired = await alertFor((ev.data![0] as { id: string }).id);
    expect(fired.map((f) => f.event_key)).toEqual(["office_visit_request"]);
    const mine = fired[0].recipients.filter((r) => r.profile_id === staffId).map((r) => r.channel).sort();
    // R4: email in hours, never the text; out of hours the email and the text (the text needs a
    // mobile on the staff login). A run that straddles 8 am or 5 pm checks the email only.
    expect(mine).toContain("email");
    if (before.inHours && after.inHours) expect(mine).toEqual(["email"]);

    // Staff: the chat pop-up opens on any staff page with the request on that estimate.
    await signIn(page, staff!, /\/(dashboard|crm|estimates|pc)/);
    await page.goto("/crm/today");
    const row = page.getByTestId("dock-row").filter({ hasText: "AlertA" });
    await expect(row).toBeVisible({ timeout: 40_000 });
    await expect(row).toContainText("Visit request");
  });

  test("2 · a call asked for on the holding page fires L13 once, routed by the hours", async ({ request }) => {
    test.setTimeout(120_000);
    const email = `alertcall.${run}@lead-alerts.invalid`; emails.push(email);
    const body = { name: "AlertCall Tester", phone: freshMobile(), email, address: "9 Alert Street, Fairfield VIC 3078" };
    const res = await request.post("/api/wizard/callback", { data: body });
    expect(res.status(), await res.text()).toBe(200);
    const acc = await db!.from("accounts").select("id").eq("email", email);
    if (acc.error) throw acc.error;
    const accountId = (acc.data?.[0] as { id: string } | undefined)?.id;
    expect(accountId).toBeTruthy();
    const ev = await db!.from("crm_events").select("id").eq("account_id", accountId!).eq("type", "callback_requested");
    if (ev.error) throw ev.error;
    expect(ev.data).toHaveLength(1);
    const fired = await alertFor((ev.data![0] as { id: string }).id);
    expect(fired.map((f) => f.event_key)).toEqual(["office_call_request"]);
    expect(fired[0].recipients.some((r) => r.profile_id === staffId && r.channel === "email")).toBe(true);
    // The same request again (the route's own dedupe hour) is the same event: no second alert.
    expect((await request.post("/api/wizard/callback", { data: body })).status()).toBe(200);
    const again = await db!.from("staff_notifications").select("id").eq("event_key", "office_call_request").eq("entity_id", (ev.data![0] as { id: string }).id);
    expect(again.data).toHaveLength(1);
  });

  test("3 · L10's chat a working day after an unanswered request; L8's call card on Today", async ({ page, request }) => {
    test.skip(!SECRET, "set CRON_SECRET");
    test.setTimeout(240_000);
    const hol = await holidays();
    const step = LEAD_STEPS.find((s) => s.key === "lead_visit_request_ack")!;
    // The moment, an office day back, that falls due a few minutes ago.
    const now = Date.now();
    let since: Date | null = null;
    for (let t = now - 60 * 60_000; t > now - 10 * 86_400_000; t -= 5 * 60_000) {
      const due = stepDueAt(step, new Date(t), 1, hol).getTime();
      if (due <= now - 60_000 && due > now - 30 * 60_000) { since = new Date(t); break; }
    }
    expect(since).not.toBeNull();

    // C asked for a visit (logged straight onto the estimate, as the request route does); nobody answered.
    const c = await seedLead("C", (now - since!.getTime()) / 3_600_000 + 1); leads.push(c);
    const ins = await db!.from("crm_events").insert({
      estimate_id: c.estId, wizard_draft_id: c.draftId, type: "visit_request_made", source: "customer",
      payload: { requestId: randomUUID(), kind: "time", zone: "zone_1" }, occurred_at: since!.toISOString(), dedupe_key: `e2e-alert-c-${run}`,
    });
    if (ins.error) throw ins.error;

    // D tightened 3 hours ago and has booked nothing.
    const d = await seedLead("D", 5, { bucket: "priced_no_request" }); leads.push(d);
    const evD = await db!.from("crm_events").insert([
      { estimate_id: d.estId, wizard_draft_id: d.draftId, type: "quote_stage_viewed", source: "customer", payload: {}, occurred_at: hours(4), dedupe_key: `e2e-alert-d1-${run}` },
      { estimate_id: d.estId, wizard_draft_id: d.draftId, type: "quote_stage_done", source: "customer", payload: {}, occurred_at: hours(3), dedupe_key: `e2e-alert-d2-${run}` },
    ]);
    if (evD.error) throw evD.error;

    const res = await request.get("/api/cron/campaign-sweep?only=leads", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.status()).toBe(200);
    const json = await res.json() as { leads: { error?: string } };
    expect(json.leads.error).toBeUndefined();
    const chat = await db!.from("estimate_messages").select("body, direction").eq("estimate_id", c.estId);
    if (chat.error) throw chat.error;
    expect(chat.data).toHaveLength(1);
    expect((chat.data![0] as { body: string }).body).toContain("Hi AlertC, thanks for the visit request for C Alert Street. I'm sorting a time and will come back to you by");

    // L8: Appendix A's line on Today.
    await signIn(page, staff!, /\/(dashboard|crm|estimates|pc)/);
    const card = page.getByText("Call AlertD (" + d.phone + ") — tightened D Alert Street to $7,000–$7,600 inc. GST, no booking yet");
    const found = await gotoTodayWith(page, "/crm/today", card);
    expect(found).toBeGreaterThan(0);
    await expect(page.getByText("Phone-closable: yes").first()).toBeVisible();
  });
});
