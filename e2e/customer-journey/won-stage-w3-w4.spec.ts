import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "../fixtures/woLoop";
import { credentials, test } from "../helpers";
import { morningBeforeDue } from "../../lib/automations/dateOffset";
import { parseQuietHours, withinSendingHours } from "../../lib/automations/controls";

/**
 * W3 + W4 (17 Nov 2026): the customer's texts before the job starts.
 * Two booked jobs at pre_start: one starting in 5 days with no colour tick
 * (W3, "still need your colours confirmed"), one starting in 2 days (W4, the
 * painter and the day). Due from 9 am Melbourne on the day; before 9 am the
 * spec checks nothing went. A second sweep sends nothing new. Both keys ship
 * OFF: the spec switches them on and puts the settings back.
 */
const db = serviceClient();
const contractor = credentials("CONTRACTOR");
const run = randomBytes(3).toString("hex");
const SECRET = process.env.CRON_SECRET ?? "";
const KEYS = ["colours_tbc", "start_reminder"];
const MEL = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
const melDayPlus = (d: number) => MEL.format(new Date(Date.now() + d * 86_400_000));
const freshMobile = () => `04${String(parseInt(randomBytes(4).toString("hex"), 16)).padStart(8, "0").slice(0, 8)}`;
const e164 = (m: string) => `+61${m.replace(/^0/, "")}`;

test.describe("Won stage W3 + W4", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!SECRET, "set CRON_SECRET");
  test.skip(!contractor, "set E2E_CONTRACTOR_EMAIL / E2E_CONTRACTOR_PASSWORD");
  let saved: Record<string, unknown> | null = null;
  let touched = false;
  const jobs: { fx: LoopFixture; phone: string }[] = [];

  test.afterAll(async () => {
    if (!db) return;
    if (touched) {
      if (saved === null) await db.from("settings").delete().eq("key", "messaging");
      else await db.from("settings").upsert({ key: "messaging", value: saved }, { onConflict: "key" });
    }
    for (const j of jobs) {
      await db.from("automation_claims").delete().eq("entity_id", j.fx.workOrderId);
      await db.from("automation_holds").delete().eq("estimate_id", j.fx.estimateId);
      await db.from("messages").delete().eq("to_address", e164(j.phone));
      await destroyLoopFixture(db, j.fx);
    }
  });

  test("W3 asks for colours 5 days out; W4 names the painter 2 days out — once each", async ({ request }) => {
    test.setTimeout(180_000);
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

    const contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    const seed = async (tag: string, startInDays: number) => {
      const fx = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls"] }]);
      const phone = freshMobile();
      jobs.push({ fx, phone });
      const e = await db!.from("estimates").update({
        title: `${tag} Start Street`, share_token: `wstart${tag}${run}${randomBytes(12).toString("hex")}`,
        builder_state: { blocks: [], modSel: {}, materials: {}, contact: { name: `Start${tag} Tester`, email: `start${tag}.${run}@won-stage.invalid`, phone } },
        sent_snapshot: { contactName: `Start${tag} Tester`, jobAddress: `${tag} Start Street, Fairfield VIC 3078` },
      }).eq("id", fx.estimateId);
      if (e.error) throw new Error(e.error.message);
      const start = melDayPlus(startInDays);
      const w = await db!.from("work_orders").update({ stage: "pre_start", status: "issued", start_date: start }).eq("id", fx.workOrderId);
      if (w.error) throw new Error(w.error.message);
      return { phone, start };
    };
    const c = await seed("C", 5);
    const s = await seed("S", 2);

    const sweep = () => request.get("/api/cron/campaign-sweep?only=start", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 120_000 });
    const res = await sweep();
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { startReminders: { error?: string } }).startReminders.error).toBeUndefined();

    const texts = async (phone: string) => {
      const { data: rows, error: e } = await db!.from("messages").select("body").eq("to_address", e164(phone)).eq("channel", "sms").eq("direction", "out");
      if (e) throw new Error(e.message);
      return (rows ?? []).map((r) => r.body as string);
    };
    const now = new Date();
    // Quiet hours hold a TEXT (decide.ts D1) — a run after the evening cut-off (24 Nov 2026, ~10 pm) sends nothing yet.
    const open = withinSendingHours(now, parseQuietHours((base as { quietHours?: unknown }).quietHours));
    const cDue = open && morningBeforeDue(c.start, 5, now), sDue = open && morningBeforeDue(s.start, 2, now);
    const cTexts = await texts(c.phone), sTexts = await texts(s.phone);
    if (cDue) {
      expect(cTexts).toHaveLength(1);
      expect(cTexts[0]).toContain("Hi StartC, we start C Start Street on");
      expect(cTexts[0]).toContain("still need your colours confirmed");
    } else expect(cTexts).toHaveLength(0);
    if (sDue) {
      expect(sTexts).toHaveLength(1);
      expect(sTexts[0]).toMatch(/^Hi StartS, .+ will arrive at S Start Street on \w+ \d+ \w+ between/);
    } else expect(sTexts).toHaveLength(0);

    expect((await sweep()).status()).toBe(200);
    expect(await texts(c.phone)).toHaveLength(cDue ? 1 : 0);
    expect(await texts(s.phone)).toHaveLength(sDue ? 1 : 0);
  });
});
