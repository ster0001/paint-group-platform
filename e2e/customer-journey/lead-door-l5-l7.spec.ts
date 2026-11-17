import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { test } from "../helpers";
import { textedCodeFor } from "./drive";

/**
 * The lead page door + L5–L7 (Tom, 17 Nov 2026: "Lead page + code").
 *
 *   1 · An anonymous customer on another device opens their range page from
 *       a text, taps Book a visit, is texted a code to the mobile ON FILE,
 *       types it, and lands on the visit page for THEIR draft. A wrong code
 *       opens nothing; a second fresh browser still has to prove the mobile.
 *   2 · L5: a lead who started tightening 1.5 h ago and stopped gets one text
 *       with the link to their page. L7: a lead who finished tightening 4.5 h
 *       ago and booked nothing gets the closer-range text with the range.
 *       A second sweep sends nothing new. The keys ship OFF: the spec
 *       switches them on for its run and puts the settings back.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");
const SECRET = process.env.CRON_SECRET ?? "";
const hours = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const KEYS = ["lead_tighten_resume", "lead_tighten_help", "lead_tightened_close"];

type Seeded = { estId: string; draftId: string; token: string; phone: string };
const freshMobile = () => `04${String(parseInt(randomBytes(4).toString("hex"), 16)).padStart(8, "0").slice(0, 8)}`;

async function seedLead(tag: string, rangeHoursAgo: number, range = { lo: 640_000, hi: 790_000 }): Promise<Seeded> {
  const token = `door${tag}${run}${randomBytes(12).toString("hex")}`;
  const phone = freshMobile();
  const snapshot = { version: 1, kind: "lead", rangeLoCents: range.lo, rangeHiCents: range.hi, parts: null, jobType: "interior", firstName: `Door${tag}`, address: `${tag} Door Street, Fairfield VIC 3078`, biggerJob: false, pricedAt: hours(rangeHoursAgo) };
  const est = await db!.from("estimates").insert({
    title: `${tag} Door Street`, status: "draft", source: "customer_intake", level_of_finish: 3, share_token: token, lead_snapshot: snapshot,
    builder_state: { blocks: [], modSel: {}, materials: {}, contact: { name: `Door${tag} Tester`, email: `door${tag}.${run}@lead-door.invalid`, phone } },
  }).select("id").single();
  if (est.error) throw new Error(est.error.message);
  const draft = await db!.from("wizard_drafts").insert({
    estimate_id: est.data.id, suburb: `E2E Door ${run}`, job_type: "interior", mode: "home", name: `Door${tag} Tester`,
    started_at: hours(rangeHoursAgo + 0.3), last_seen_at: hours(rangeHoursAgo), gate_completed_at: hours(rangeHoursAgo), range_shown_at: hours(rangeHoursAgo),
  }).select("id").single();
  if (draft.error) throw new Error(draft.error.message);
  return { estId: est.data.id as string, draftId: draft.data.id as string, token, phone };
}

test.describe("Lead page door + L5–L7", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  let saved: Record<string, unknown> | null = null;
  let touched = false;
  const leads: Seeded[] = [];

  test.afterAll(async () => {
    if (!db) return;
    if (touched) {
      if (saved === null) await db.from("settings").delete().eq("key", "messaging");
      else await db.from("settings").upsert({ key: "messaging", value: saved }, { onConflict: "key" });
    }
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

  test("1 · the door: another device proves the mobile on file and opens THAT draft's visit page", async ({ browser, request }) => {
    test.setTimeout(180_000);
    const lead = await seedLead("A", 3); leads.push(lead);

    // An unknown token is a 404, never a 403.
    expect((await request.post(`/api/lead/${"x".repeat(40)}/door`, { data: { action: "open", to: "visit" } })).status()).toBe(404);

    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`/e/${lead.token}`);
    await expect(page.getByTestId("lead-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("lead-carry-on")).toBeVisible();
    await page.getByTestId("lead-book-visit").click();
    // Not this browser's draft: the code, to the mobile on file (masked; the page never names the number itself).
    await expect(page.getByTestId("lead-code")).toContainText(lead.phone.slice(-3), { timeout: 20_000 });
    await page.getByTestId("lead-code-send").click();
    await expect(page.getByTestId("lead-code-input")).toBeVisible({ timeout: 20_000 });
    const { code } = await textedCodeFor(db!, lead.phone);

    // A wrong code opens nothing.
    await page.getByTestId("lead-code-input").fill(code === "000000" ? "111111" : "000000");
    await page.getByTestId("lead-code-verify").click();
    await expect(page.getByTestId("lead-door-error")).toContainText("didn't match", { timeout: 20_000 });
    const { count: none } = await db!.from("estimate_draft_doors").select("estimate_id", { count: "exact", head: true }).eq("estimate_id", lead.estId);
    expect(none).toBe(0);

    // The right one opens the visit page for this draft.
    await page.getByTestId("lead-code-input").fill(code);
    await page.getByTestId("lead-code-verify").click();
    await page.waitForURL(new RegExp(`/estimate/visit\\?id=${lead.estId}`), { timeout: 30_000 });
    await expect(page.locator(".wz-vpage")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("We couldn't find that estimate.")).toHaveCount(0);
    const { count: one } = await db!.from("estimate_draft_doors").select("estimate_id", { count: "exact", head: true }).eq("estimate_id", lead.estId);
    expect(one).toBe(1);

    // Back on the range page, the same browser goes straight through.
    await page.goto(`/e/${lead.token}`);
    await page.getByTestId("lead-book-visit").click();
    await page.waitForURL(/\/estimate\/visit\?id=/, { timeout: 30_000 });
    await ctx.close();

    // A second fresh browser still has to prove the mobile: the door is per login.
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.goto(`/e/${lead.token}`);
    await p2.getByTestId("lead-carry-on").click();
    await expect(p2.getByTestId("lead-code")).toBeVisible({ timeout: 20_000 });
    await p2.goto(`/estimate/visit?id=${lead.estId}`);
    await expect(p2.getByText(/We couldn't find that estimate|Open your estimate from the link/)).toBeVisible({ timeout: 30_000 });
    await other.close();
  });

  test("2 · L5 texts the lead who stopped tightening; L7 texts the closer range to the one who finished", async ({ request }) => {
    test.skip(!SECRET, "set CRON_SECRET");
    test.setTimeout(240_000);
    const { data, error } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    if (error) throw new Error(error.message);
    saved = (data as { value: Record<string, unknown> } | null)?.value ?? null;
    const base = saved ?? {};
    const enabled = [...new Set([...((base.enabled as string[] | undefined) ?? []), ...KEYS])];
    const disabled = ((base.disabled as string[] | undefined) ?? []).filter((k) => !KEYS.includes(k));
    const up = await db!.from("settings").upsert({ key: "messaging", value: { ...base, enabled, disabled } }, { onConflict: "key" });
    if (up.error) throw new Error(up.error.message);
    touched = true;

    const b = await seedLead("B", 2); leads.push(b);
    const c = await seedLead("C", 6, { lo: 700_000, hi: 760_000 }); leads.push(c);
    const ev = await db!.from("crm_events").insert([
      { estimate_id: b.estId, wizard_draft_id: b.draftId, type: "quote_stage_viewed", source: "customer", payload: {}, occurred_at: hours(1.5), dedupe_key: `e2e-door-b-${run}` },
      { estimate_id: c.estId, wizard_draft_id: c.draftId, type: "quote_stage_viewed", source: "customer", payload: {}, occurred_at: hours(5), dedupe_key: `e2e-door-c1-${run}` },
      { estimate_id: c.estId, wizard_draft_id: c.draftId, type: "quote_stage_done", source: "customer", payload: {}, occurred_at: hours(4.5), dedupe_key: `e2e-door-c2-${run}` },
    ]);
    if (ev.error) throw new Error(ev.error.message);

    const sweep = () => request.get("/api/cron/campaign-sweep?only=leads", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    const res = await sweep();
    expect(res.status()).toBe(200);
    const body = await res.json() as { leads: { error?: string } };
    expect(body.leads.error).toBeUndefined();

    // A text, sent or held for quiet hours (8 pm–8 am), exactly one per lead.
    const textFor = async (l: Seeded, key: string) => {
      const { data: sms, error: e1 } = await db!.from("messages").select("body").eq("estimate_id", l.estId).eq("channel", "sms").eq("direction", "out");
      const { data: held, error: e2 } = await db!.from("automation_holds").select("sms_body").eq("estimate_id", l.estId).eq("automation_key", key);
      if (e1 || e2) throw new Error((e1 ?? e2)!.message);
      expect((sms?.length ?? 0) + (held?.length ?? 0)).toBe(1);
      return (sms?.[0]?.body as string | undefined) ?? (held?.[0]?.sms_body as string | undefined) ?? "";
    };
    const l5 = await textFor(b, "lead_tighten_resume");
    expect(l5).toContain("Hi DoorB");
    expect(l5).toContain("Pick up where you left off");
    expect(l5).toContain(`/e/${b.token}`);
    const l7 = await textFor(c, "lead_tightened_close");
    expect(l7).toContain("your closer range for C Door Street is ready: $7,000–$7,600 inc. GST");
    expect(l7).toContain(`/e/${c.token}`);

    // Claimed: a second sweep sends nothing new.
    expect((await sweep()).status()).toBe(200);
    await textFor(b, "lead_tighten_resume");
    await textFor(c, "lead_tightened_close");
  });
});
