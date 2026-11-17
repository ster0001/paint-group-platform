import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { test } from "../helpers";
import { dueForTwoHourReminder } from "../../lib/visits/reminder2h";

/**
 * Lead L11 (17 Nov 2026): the text two hours before an estimator visit.
 *
 * Three booked visits: one 90 minutes away (due), one 30 minutes away (too
 * close — never sent), one 3 hours away (not yet). The half-hour sweep texts
 * the first customer once, with the visit's window; a second sweep sends
 * nothing new. Inside quiet hours nothing is due, and the spec checks that
 * instead. The key ships OFF: the spec switches it on and puts settings back.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");
const SECRET = process.env.CRON_SECRET ?? "";
const KEY = "visit_reminder_2h";
const freshMobile = () => `04${String(parseInt(randomBytes(4).toString("hex"), 16)).padStart(8, "0").slice(0, 8)}`;
const e164 = (m: string) => `+61${m.replace(/^0/, "")}`;

test.describe("Visit reminder two hours before (L11)", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!SECRET, "set CRON_SECRET");
  let saved: Record<string, unknown> | null = null;
  let touched = false;
  const visits: { id: string; phone: string }[] = [];

  test.afterAll(async () => {
    if (!db) return;
    if (touched) {
      if (saved === null) await db.from("settings").delete().eq("key", "messaging");
      else await db.from("settings").upsert({ key: "messaging", value: saved }, { onConflict: "key" });
    }
    if (visits.length) {
      await db.from("automation_claims").delete().eq("automation_key", KEY).in("entity_id", visits.map((v) => v.id));
      await db.from("messages").delete().in("to_address", visits.map((v) => e164(v.phone)));
      await db.from("visits").delete().in("id", visits.map((v) => v.id));
    }
  });

  test("texts the customer whose visit is in 90 minutes, once; not the one in 30 or in 3 hours", async ({ request }) => {
    test.setTimeout(180_000);
    const { data, error } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    if (error) throw new Error(error.message);
    saved = (data as { value: Record<string, unknown> } | null)?.value ?? null;
    const base = saved ?? {};
    const up = await db!.from("settings").upsert({ key: "messaging", value: {
      ...base,
      enabled: [...new Set([...((base.enabled as string[] | undefined) ?? []), KEY])],
      disabled: ((base.disabled as string[] | undefined) ?? []).filter((k) => k !== KEY),
    } }, { onConflict: "key" });
    if (up.error) throw new Error(up.error.message);
    touched = true;

    const seed = async (tag: string, minutesAway: number) => {
      const phone = freshMobile();
      const start = new Date(Date.now() + minutesAway * 60_000);
      const ins = await db!.from("visits").insert({
        starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
        kind: "quote", status: "booked", source: "staff",
        customer_name: `Remind${tag} Tester`, customer_phone: phone, address: `${tag} Remind Street, Fairfield VIC 3078 (${run})`,
      }).select("id, starts_at").single();
      if (ins.error) throw new Error(ins.error.message);
      visits.push({ id: ins.data.id as string, phone });
      return { id: ins.data.id as string, phone, starts_at: ins.data.starts_at as string };
    };
    const a = await seed("A", 90);
    const b = await seed("B", 30);
    const c = await seed("C", 180);

    const quiet = (saved as { quietHours?: unknown } | null)?.quietHours;
    const sweep = () => request.get("/api/cron/campaign-sweep?only=visits", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 120_000 });
    const res = await sweep();
    expect(res.status()).toBe(200);
    const body = await res.json() as { visits2h: { error?: string } | null };
    expect(body.visits2h?.error).toBeUndefined();

    const textsTo = async (phone: string) => {
      const { data: rows, error: e } = await db!.from("messages").select("body").eq("to_address", e164(phone)).eq("channel", "sms").eq("direction", "out");
      if (e) throw new Error(e.message);
      return (rows ?? []).map((r) => r.body as string);
    };
    // What the rule says right now (quiet hours shut the window entirely).
    const sendable = dueForTwoHourReminder([{ starts_at: a.starts_at, status: "booked", customer_phone: a.phone }], new Date(), quiet).length === 1;
    const aTexts = await textsTo(a.phone);
    if (sendable) {
      expect(aTexts).toHaveLength(1);
      expect(aTexts[0]).toMatch(/^Hi RemindA, .+ will be with you between \d{1,2}:\d{2} [ap]m and \d{1,2}:\d{2} [ap]m today\. — /);
    } else {
      expect(aTexts).toHaveLength(0);
    }
    expect(await textsTo(b.phone)).toHaveLength(0);
    expect(await textsTo(c.phone)).toHaveLength(0);

    // Claimed: a second sweep sends nothing new.
    expect((await sweep()).status()).toBe(200);
    expect(await textsTo(a.phone)).toHaveLength(sendable ? 1 : 0);
  });
});
