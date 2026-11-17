import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { test } from "../helpers";
import { nurtureHour } from "../../lib/automations/coldNurture";

/**
 * L4 and R5 (17 Nov 2026), both pointing at a real finished job.
 *
 *   1 · L4: a lead who saw their range 10 days ago and did nothing gets the
 *       last note on their chat, naming the published showcase job in their
 *       suburb with its price and link.
 *   2 · R5: a customer who declined four months ago gets the quarterly note —
 *       weekdays 10 am–3 pm Melbourne; outside those hours the sweep says so
 *       and sends nothing. A second sweep in the quarter sends nothing new.
 * The keys ship OFF: the spec switches them on and puts settings back; the
 * showcase job it publishes is removed after.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");
const SECRET = process.env.CRON_SECRET ?? "";
const KEYS = ["lead_range_last", "cold_nurture"];
const SUBURB = `Testburb${run}`;
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

test.describe("Nurture L4 + R5", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!SECRET, "set CRON_SECRET");
  let saved: Record<string, unknown> | null = null;
  let touched = false;
  let showcaseId = "";
  const slug = `e2e-nurture-${run}`;
  const ests: string[] = [];
  const drafts: string[] = [];
  const accounts: string[] = [];

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
    const sc = await db!.from("showcase_jobs").insert({
      slug, title: `Nurture test ${run}`, job_type: "interior", property_type: "home", suburb: SUBURB, completed_on: "2026-10-01",
      price_low_cents: 840_000, price_high_cents: 960_000, hero_path: "e2e/hero.jpg", consent_confirmed: true, published: true,
    }).select("id").single();
    if (sc.error) throw new Error(sc.error.message);
    showcaseId = sc.data.id as string;
  });
  test.afterAll(async () => {
    if (!db) return;
    if (touched) {
      if (saved === null) await db.from("settings").delete().eq("key", "messaging");
      else await db.from("settings").upsert({ key: "messaging", value: saved }, { onConflict: "key" });
    }
    if (showcaseId) { await db.from("showcase_jobs").update({ published: false }).eq("id", showcaseId); await db.from("showcase_jobs").delete().eq("id", showcaseId); }
    if (ests.length) {
      await db.from("automation_claims").delete().in("entity_id", [...ests, ...accounts]);
      await db.from("estimate_messages").delete().in("estimate_id", ests);
      await db.from("messages").delete().in("estimate_id", ests);
      await db.from("crm_events").delete().in("estimate_id", ests);
    }
    if (drafts.length) await db.from("wizard_drafts").delete().in("id", drafts);
    if (ests.length) await db.from("estimates").delete().in("id", ests);
    if (accounts.length) { await db.from("crm_events").delete().in("account_id", accounts); await db.from("accounts").delete().in("id", accounts); }
  });

  const sweep = (request: import("@playwright/test").APIRequestContext, only: string) =>
    request.get(`/api/cron/campaign-sweep?only=${only}`, { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 200_000 });

  test("1 · L4 names the showcase job in their suburb", async ({ request }) => {
    test.setTimeout(240_000);
    const token = `nurl4${run}${randomBytes(12).toString("hex")}`;
    const snap = { version: 1, kind: "lead", rangeLoCents: 700_000, rangeHiCents: 800_000, parts: null, jobType: "interior", firstName: "Nurture", address: `4 Last Street, ${SUBURB} VIC 3078`, biggerJob: false, pricedAt: ago(10.1) };
    const est = await db!.from("estimates").insert({
      title: "4 Last Street", status: "draft", source: "customer_intake", level_of_finish: 3, share_token: token, lead_snapshot: snap,
      builder_state: { blocks: [], modSel: {}, materials: {}, contact: { name: "Nurture Tester", email: `l4.${run}@nurture.invalid`, phone: "0400000000" } },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    ests.push(est.data.id as string);
    const d = await db!.from("wizard_drafts").insert({ estimate_id: est.data.id, suburb: SUBURB, job_type: "interior", mode: "home", name: "Nurture Tester",
      started_at: ago(10.2), last_seen_at: ago(10.1), gate_completed_at: ago(10.1), range_shown_at: ago(10.1) }).select("id").single();
    if (d.error) throw new Error(d.error.message);
    drafts.push(d.data.id as string);

    const res = await sweep(request, "leads");
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { leads: { error?: string } }).leads.error).toBeUndefined();
    const chat = await db!.from("estimate_messages").select("body").eq("estimate_id", est.data.id);
    if (chat.error) throw chat.error;
    expect(chat.data).toHaveLength(1);
    const body = (chat.data![0] as { body: string }).body;
    expect(body).toContain(`We finished a similar job in ${SUBURB} recently at $8,400`);
    expect(body).toContain(`/work/${slug}`);
    expect(body).toContain(`/e/${token}`);
  });

  test("2 · R5 the quarterly note to a customer who declined four months ago", async ({ request }) => {
    test.setTimeout(240_000);
    const acc = await db!.from("accounts").insert({ email: `r5.${run}@nurture.invalid`, name: "Cold Tester" }).select("id").single();
    if (acc.error) throw new Error(acc.error.message);
    accounts.push(acc.data.id as string);
    const est = await db!.from("estimates").insert({
      title: "5 Cold Street", status: "declined", source: "manual", level_of_finish: 3, share_token: `nurr5${run}${randomBytes(12).toString("hex")}`,
      account_id: acc.data.id, sent_at: ago(130), declined_at: ago(120), total_cents: 500_000,
      builder_state: { blocks: [], modSel: {}, materials: {}, contact: { name: "Cold Tester", email: `r5.${run}@nurture.invalid` } },
      sent_snapshot: { contactName: "Cold Tester", jobAddress: `5 Cold Street, ${SUBURB} VIC 3078` },
    }).select("id, created_at").single();
    if (est.error) throw new Error(est.error.message);
    ests.push(est.data.id as string);
    // created long ago too: "anything newer than 90 days" is the customer's activity, read from created/sent.
    const back = await db!.from("estimates").update({ created_at: ago(130) }).eq("id", est.data.id);
    if (back.error) throw back.error;

    const hours = nurtureHour(new Date());
    const res = await sweep(request, "nurture");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { nurture: { error?: string; skipped?: string } };
    expect(body.nurture.error).toBeUndefined();
    const rows = async () => (await db!.from("estimate_messages").select("body").eq("estimate_id", est.data.id)).data ?? [];
    if (!hours) {
      expect(body.nurture.skipped).toBe("hours");
      expect(await rows()).toHaveLength(0);
      return;
    }
    const chat = await rows();
    expect(chat).toHaveLength(1);
    expect((chat[0] as { body: string }).body).toContain(`We just finished one in ${SUBURB} at $8,400`);
    expect((chat[0] as { body: string }).body).toContain("/wizard");
    expect((await sweep(request, "nurture")).status()).toBe(200);
    expect(await rows()).toHaveLength(1);
  });
});
