import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, test, userIdFor } from "../helpers";
import { requestAlertRoute } from "../../lib/staff/requestAlertRules";

/**
 * E8 and E1 (17 Nov 2026).
 *
 *   1 · E8: an anonymous customer writes on their sent estimate's chat. Staff
 *       are alerted by the office hours (R4): in hours by email only (the dock
 *       pops up regardless), out of hours the text as well.
 *   2 · E1: a visit marked done weeks ago with no estimate sent since alerts
 *       staff once — in office hours only; out of hours the sweep says so and
 *       sends nothing.
 * E1 ships OFF: the spec switches it on, and puts the settings and the staff
 * login's routing back.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const SECRET = process.env.CRON_SECRET ?? "";
const KEYS = ["office_estimate_chat", "office_estimate_overdue"];

test.describe("Estimate alerts E8 + E1", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!staff, "set E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD");
  let saved: Record<string, unknown> | null = null;
  let touched = false;
  let staffId = "";
  let savedNotify: unknown = null;
  let notifyTouched = false;
  const made: { estId?: string; accountId?: string; visitId?: string } = {};

  const holidays = async () => {
    const r = await db!.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
    if (r.error) throw r.error;
    return new Set(((r.data as { value?: { publicHolidays?: string[] } } | null)?.value?.publicHolidays ?? []));
  };

  test.beforeAll(async () => {
    const { data, error } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    if (error) throw new Error(error.message);
    saved = (data as { value: Record<string, unknown> } | null)?.value ?? null;
    const base = saved ?? {};
    const up = await db!.from("settings").upsert({ key: "messaging", value: {
      ...base, enabled: [...new Set([...((base.enabled as string[] | undefined) ?? []), ...KEYS])],
      disabled: ((base.disabled as string[] | undefined) ?? []).filter((k) => !KEYS.includes(k)),
    } }, { onConflict: "key" });
    if (up.error) throw new Error(up.error.message);
    touched = true;
    staffId = (await userIdFor(staff!)) ?? "";
    const prof = await db!.from("profiles").select("staff_notify").eq("id", staffId).single();
    if (prof.error) throw prof.error;
    savedNotify = (prof.data as { staff_notify: unknown }).staff_notify;
    const ticked = await db!.from("profiles").update({
      staff_notify: { ...((savedNotify as Record<string, unknown> | null) ?? {}), office_estimate_chat: ["email", "sms"], office_estimate_overdue: ["email"] },
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
    if (made.estId) {
      const { data: msgs } = await db.from("estimate_messages").select("id").eq("estimate_id", made.estId);
      const ids = ((msgs ?? []) as { id: string }[]).map((m) => m.id);
      if (ids.length) await db.from("staff_notifications").delete().eq("event_key", "office_estimate_chat").in("entity_id", ids);
      await db.from("estimate_messages").delete().eq("estimate_id", made.estId);
      await db.from("messages").delete().eq("estimate_id", made.estId);
      await db.from("crm_events").delete().eq("estimate_id", made.estId);
      await db.from("estimates").delete().eq("id", made.estId);
    }
    if (made.visitId) {
      await db.from("staff_notifications").delete().eq("event_key", "office_estimate_overdue").eq("entity_id", made.visitId);
      await db.from("visits").delete().eq("id", made.visitId);
    }
    if (made.accountId) { await db.from("crm_events").delete().eq("account_id", made.accountId); await db.from("accounts").delete().eq("id", made.accountId); }
  });

  test("1 · E8: a customer's chat message alerts staff by the hours", async ({ request }) => {
    const token = `e8chat${run}${randomBytes(10).toString("hex")}`;
    const est = await db!.from("estimates").insert({
      title: `E8 ${run}`, status: "sent", source: "manual", level_of_finish: 3, share_token: token, sent_at: new Date().toISOString(), total_cents: 220000,
      builder_state: { blocks: [], modSel: {}, materials: {}, contact: { name: "Eight Tester" } },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    made.estId = est.data.id as string;

    const before = requestAlertRoute(new Date(), await holidays());
    const res = await request.post("/api/estimates/chat", { data: { token, body: "Is the ceiling included?" } });
    expect(res.status(), await res.text()).toBe(200);
    const after = requestAlertRoute(new Date(), await holidays());

    const { data: msg, error } = await db!.from("estimate_messages").select("id").eq("estimate_id", made.estId).eq("direction", "customer").single();
    if (error) throw error;
    const { data: fired, error: fErr } = await db!.from("staff_notifications").select("recipients").eq("event_key", "office_estimate_chat").eq("entity_id", msg.id);
    if (fErr) throw fErr;
    expect(fired).toHaveLength(1);
    const mine = ((fired![0] as { recipients: { profile_id: string; channel: string }[] }).recipients).filter((r) => r.profile_id === staffId).map((r) => r.channel);
    expect(mine).toContain("email");
    if (before.inHours && after.inHours) expect(mine).toEqual(["email"]);
  });

  test("2 · E1: a visit done weeks ago with no estimate sent alerts staff once, in office hours", async ({ request }) => {
    test.skip(!SECRET, "set CRON_SECRET");
    test.setTimeout(120_000);
    const acc = await db!.from("accounts").insert({ email: `e1.${run}@estimate-overdue.invalid`, name: `E1${run} Tester` }).select("id").single();
    if (acc.error) throw new Error(acc.error.message);
    made.accountId = acc.data.id as string;
    // 29 days back: inside the source's 30-day window and among its oldest rows.
    const start = new Date(Date.now() - 29 * 86_400_000);
    const v = await db!.from("visits").insert({
      account_id: made.accountId, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
      kind: "quote", status: "done", source: "staff", outcome_at: start.toISOString(), customer_name: `E1${run} Tester`, address: `1 Overdue Street ${run}, Fairfield VIC 3078`,
    }).select("id").single();
    if (v.error) throw new Error(v.error.message);
    made.visitId = v.data.id as string;

    const inHours = requestAlertRoute(new Date(), await holidays()).inHours;
    const sweep = () => request.get("/api/cron/campaign-sweep?only=overdue", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 100_000 });
    const res = await sweep();
    expect(res.status()).toBe(200);
    const body = await res.json() as { overdue: { error?: string; skipped?: string } };
    expect(body.overdue.error).toBeUndefined();
    const rows = async () => {
      const { data, error } = await db!.from("staff_notifications").select("recipients").eq("event_key", "office_estimate_overdue").eq("entity_id", made.visitId!);
      if (error) throw error;
      return data ?? [];
    };
    if (!inHours) {
      expect(body.overdue.skipped).toBe("out_of_hours");
      expect(await rows()).toHaveLength(0);
      return;
    }
    const fired = await rows();
    expect(fired).toHaveLength(1);
    expect(((fired[0] as { recipients: { profile_id: string; channel: string }[] }).recipients).some((r) => r.profile_id === staffId && r.channel === "email")).toBe(true);
    expect((await sweep()).status()).toBe(200);
    expect(await rows()).toHaveLength(1);
  });
});
