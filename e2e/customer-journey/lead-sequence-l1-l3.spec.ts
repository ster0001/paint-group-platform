import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { test } from "../helpers";

/**
 * Automations brief §7 session 2, the walking skeleton (L1–L3, built 17 Nov
 * 2026): "L1 switched on in test → a seeded range-no-action lead gets one SMS
 * at +2 h, cancelled if they book first" — and L2, the chat message at a day,
 * read by the customer on their own range page.
 *
 *   A · saw their range 25 h ago, did nothing      → L2: a chat message in the
 *       estimator's name on their page (+ the email notification); no late L1
 *   B · saw their range 2.5 h ago, did nothing     → L1: one text (or held for
 *       quiet hours), linking to their page
 *   C · saw their range 2.5 h ago, then started    → nothing: the stage moved
 *       tightening
 *   A second sweep sends nothing new (claims). The keys ship OFF: the spec
 *   switches them on for its run and puts the settings back.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");
const SECRET = process.env.CRON_SECRET ?? "";
const hours = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const KEYS = ["lead_range_reminder", "lead_range_nudge", "lead_range_human"];

type Seeded = { estId: string; draftId: string; token: string; phone: string };

async function seedLead(tag: string, rangeHoursAgo: number): Promise<Seeded> {
  const token = `seq${tag}${run}${randomBytes(12).toString("hex")}`;
  const phone = `04${String(parseInt(randomBytes(4).toString("hex"), 16)).padStart(8, "0").slice(0, 8)}`;
  const snapshot = { version: 1, kind: "lead", rangeLoCents: 640_000, rangeHiCents: 790_000, parts: null, jobType: "interior", firstName: `Seq${tag}`, address: `${tag} Sequence Street, Fairfield VIC 3078`, biggerJob: false, pricedAt: hours(rangeHoursAgo) };
  const est = await db!.from("estimates").insert({
    title: `${tag} Sequence Street`, status: "draft", source: "customer_intake", level_of_finish: 3, share_token: token, lead_snapshot: snapshot,
    builder_state: { blocks: [], modSel: {}, materials: {}, contact: { name: `Seq${tag} Tester`, email: `pg.e2e.seq${tag}.${run}@example.com`, phone } },
  }).select("id").single();
  if (est.error) throw new Error(est.error.message);
  const draft = await db!.from("wizard_drafts").insert({
    estimate_id: est.data.id, suburb: `E2E Seq ${run}`, job_type: "interior", mode: "home", name: `Seq${tag} Tester`,
    started_at: hours(rangeHoursAgo + 0.3), last_seen_at: hours(rangeHoursAgo), gate_completed_at: hours(rangeHoursAgo), range_shown_at: hours(rangeHoursAgo),
  }).select("id").single();
  if (draft.error) throw new Error(draft.error.message);
  return { estId: est.data.id as string, draftId: draft.data.id as string, token, phone };
}

test.describe("Lead sequence L1–L3 — the walking skeleton", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !SECRET, "set SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET");
  let saved: Record<string, unknown> | null = null;
  const leads: Seeded[] = [];

  test.beforeAll(async () => {
    const { data, error } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    if (error) throw new Error(error.message);
    saved = (data as { value: Record<string, unknown> } | null)?.value ?? null;
    const base = saved ?? {};
    const enabled = [...new Set([...((base.enabled as string[] | undefined) ?? []), ...KEYS])];
    const disabled = ((base.disabled as string[] | undefined) ?? []).filter((k) => !KEYS.includes(k));
    const up = await db!.from("settings").upsert({ key: "messaging", value: { ...base, enabled, disabled } }, { onConflict: "key" });
    if (up.error) throw new Error(up.error.message);
  });
  test.afterAll(async () => {
    if (!db) return;
    if (saved === null) await db.from("settings").delete().eq("key", "messaging");
    else await db.from("settings").upsert({ key: "messaging", value: saved }, { onConflict: "key" });
    for (const l of leads) {
      await db.from("automation_claims").delete().eq("entity_id", l.estId);
      await db.from("automation_holds").delete().eq("estimate_id", l.estId);
      await db.from("estimate_messages").delete().eq("estimate_id", l.estId);
      await db.from("messages").delete().eq("estimate_id", l.estId);
      await db.from("crm_events").delete().eq("estimate_id", l.estId);
      await db.from("crm_events").delete().eq("wizard_draft_id", l.draftId);
      await db.from("wizard_drafts").delete().eq("id", l.draftId);
      await db.from("estimates").delete().eq("id", l.estId);
    }
  });

  test("L2 reaches the anonymous lead's page, L1 texts the fresh one, the one who moved on gets nothing", async ({ request, browser }) => {
    test.setTimeout(240_000);
    const a = await seedLead("A", 25); leads.push(a);
    const b = await seedLead("B", 2.5); leads.push(b);
    const c = await seedLead("C", 2.5); leads.push(c);
    // C started tightening after the range: the stage is no longer "range seen, no action".
    const moved = await db!.from("crm_events").insert({ estimate_id: c.estId, wizard_draft_id: c.draftId, type: "quote_stage_viewed", source: "customer", payload: {}, occurred_at: hours(2), dedupe_key: `e2e-seq-c-${run}` });
    if (moved.error) throw new Error(moved.error.message);

    const sweep = () => request.get("/api/cron/campaign-sweep?only=leads", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    const res = await sweep();
    expect(res.status()).toBe(200);
    const body = await res.json() as { leads: { error?: string; sent: Record<string, number> } };
    expect(body.leads.error).toBeUndefined();

    // A · the chat message, in the estimator's name, on the lead's own chat — and its email.
    const { data: aChat, error: aErr } = await db!.from("estimate_messages").select("direction, body").eq("estimate_id", a.estId);
    if (aErr) throw new Error(aErr.message);
    expect(aChat).toHaveLength(1);
    expect(aChat![0]).toMatchObject({ direction: "staff" });
    expect(aChat![0].body).toContain("Your range for A Sequence Street came out at $6,400–$7,900 inc. GST");
    const { count: aMail } = await db!.from("messages").select("id", { count: "exact", head: true }).eq("estimate_id", a.estId).eq("channel", "email").eq("direction", "out");
    expect(aMail).toBe(1);
    // …and no late L1 text: its moment was 23 hours ago.
    const { count: aSms } = await db!.from("messages").select("id", { count: "exact", head: true }).eq("estimate_id", a.estId).eq("channel", "sms");
    expect(aSms).toBe(0);

    // B · one text with the link to their page (sent, or held until 8 am in quiet hours).
    const { data: bSms } = await db!.from("messages").select("body").eq("estimate_id", b.estId).eq("channel", "sms").eq("direction", "out");
    const { data: bHeld } = await db!.from("automation_holds").select("sms_body").eq("estimate_id", b.estId).eq("automation_key", "lead_range_reminder");
    const text = (bSms?.[0]?.body as string | undefined) ?? (bHeld?.[0]?.sms_body as string | undefined) ?? "";
    expect((bSms?.length ?? 0) + (bHeld?.length ?? 0)).toBe(1);
    expect(text).toContain(`/e/${b.token}`);
    expect(text).toContain("Hi SeqB");

    // C · nothing at all.
    for (const t of ["estimate_messages", "messages", "automation_holds"] as const) {
      const { count, error } = await db!.from(t).select("id", { count: "exact", head: true }).eq("estimate_id", c.estId);
      if (error) throw new Error(error.message);
      expect(count, t).toBe(0);
    }

    // A second sweep: claimed, so nothing new.
    expect((await sweep()).status()).toBe(200);
    const { count: aAgain } = await db!.from("estimate_messages").select("id", { count: "exact", head: true }).eq("estimate_id", a.estId);
    expect(aAgain).toBe(1);

    // The lead, anonymous, on their range page: the message is in the chat.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`/e/${a.token}`);
    await expect(page.getByTestId("lead-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lead-chat").locator(".chatrow.theirs .chatbody")).toContainText("came out at $6,400–$7,900 inc. GST", { timeout: 20_000 });
    await ctx.close();
  });
});
