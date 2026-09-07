import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { trackedToken } from "../lib/campaigns/links";

/**
 * CRM v2 · P5 — campaigns with real rules, driven as staff on the real screens (C1).
 *
 *   · an audience with two groups (ALL / ANY) and a NOT, counted in SQL, saved
 *   · a quote follow-up that starts when an estimate is sent: waits from the
 *     anchor, a step condition ("only if unopened") skipping the step for a
 *     customer who opened, an exit rule ("they replied") finishing another
 *   · a marketing campaign to the list: a declined email permission is
 *     finished at the sweep; approve-all walks the guard per message
 *   · a tracked link records the click and redirects
 *   · the stats panel reads the enrolment
 *
 * Delivery itself ends `failed` on C1 (no marketing key, Twilio refused) —
 * the guard verdicts before it are what this asserts.
 */

const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };
const run = randomBytes(4).toString("hex");
const SUBURB = `Testville${run}`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

type Fixture = { id: string; name: string; estimateId: string };
const people: Record<"opens" | "replies" | "declined", Fixture> = {} as never;

async function loginAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe("CRM v2 P5 — campaigns with real rules", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  let smsTemplateId = "", emailTemplateId = "", segmentKey = "", followupId = "", marketingId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const make = async (key: keyof typeof people, first: string, extra: Record<string, unknown> = {}) => {
      const name = `${first} Campaign ${run}`;
      const acc = await sb.from("accounts").insert({ email: `crm.p5.${key}.${run}@volume.example`, name, phone: `0400 ${run.slice(0, 3)} ${key.length}${run.slice(3, 5)}`, ...extra }).select("id").single();
      if (acc.error) throw new Error(acc.error.message);
      await sb.from("properties").insert({ account_id: acc.data.id, address: `1 Test St ${SUBURB}`, suburb: SUBURB, state: "VIC", postcode: "3000" });
      // Sent four days ago: the estimate_sent event is dated by sent_at, so a
      // "3 days after" step is due and a "7 days after" step is not.
      const est = await sb.from("estimates").insert({
        title: `P5 ${key} ${run}`, status: "sent", level_of_finish: 3, total_cents: 435_200, account_id: acc.data.id,
        sent_at: daysAgo(4), builder_state: { blocks: [] },
      }).select("id").single();
      if (est.error) throw new Error(est.error.message);
      people[key] = { id: acc.data.id as string, name, estimateId: est.data.id as string };
    };
    await make("opens", "Olive");
    await make("replies", "Reza");
    await make("declined", "Dana", { permit_email: "declined" });

    const sms = await sb.from("campaign_templates").insert({
      name: `P5 text ${run}`, kind: "sms", sms_body: "Hi {{first_name}}, did you see your {{estimate_total}} estimate? {{estimate}}", approved_at: new Date().toISOString(),
    }).select("id").single();
    const email = await sb.from("campaign_templates").insert({
      name: `P5 email ${run}`, kind: "email", subject: "Your estimate, {{first_name}}", preheader: "",
      blocks: [{ kind: "text", body: "Hi {{first_name}} — still thinking it over?" }, { kind: "button", label: "Open it", url: "{{estimate}}", note: "" }],
      approved_at: new Date().toISOString(),
    }).select("id").single();
    if (sms.error || email.error) throw new Error(sms.error?.message ?? email.error?.message);
    smsTemplateId = sms.data.id as string;
    emailTemplateId = email.data.id as string;
  });

  test.afterAll(async () => {
    const sb = db!;
    for (const id of [followupId, marketingId].filter(Boolean)) await sb.from("campaigns").delete().eq("id", id);
    await sb.from("campaign_templates").delete().in("id", [smsTemplateId, emailTemplateId].filter(Boolean));
    if (segmentKey) await sb.from("crm_segments").delete().eq("key", segmentKey);
    const ids = Object.values(people).map((p) => p.id);
    await sb.from("messages").delete().in("account_id", ids);
    await sb.from("estimates").delete().in("account_id", ids);
    await sb.from("properties").delete().in("account_id", ids);
    const { error } = await sb.from("accounts").delete().in("id", ids);
    if (error) throw new Error(`account delete failed: ${error.message}`);
  });

  test("an audience with two groups and a NOT is counted in SQL and saved", async ({ page }) => {
    await loginAs(page, staff);
    // The record page freshens the facts row; the audience reads facts.
    for (const p of Object.values(people)) await page.goto(`/crm/customers/${p.id}`);

    await page.goto("/crm/segments/new");
    await page.getByPlaceholder(/Name the list/).fill(`P5 list ${run}`);
    // Group 1 (all): Latest quote is "Sent, no answer"; Tags has none of… flipped to NOT for good measure.
    await page.getByTestId("add-rule-0").click();
    await page.getByRole("button", { name: "+ Latest quote", exact: true }).click();
    // A fresh rule pre-selects its first option; clicking it would toggle it off.
    await expect(page.getByRole("button", { name: "Sent, no answer" })).toHaveClass(/\bon\b/);
    // Group 2 (any): Suburb is our test suburb, OR tagged VIP.
    await page.getByTestId("add-group").click();
    await page.getByTestId("add-rule-1").click();
    await page.getByRole("button", { name: "+ Suburb", exact: true }).click();
    await page.getByPlaceholder("Camberwell, Kew, Balwyn").fill(SUBURB);
    await page.getByTestId("add-rule-1").click();
    await page.getByRole("button", { name: "+ Tags", exact: true }).click();
    await page.getByTestId("group-1").getByRole("button", { name: "VIP" }).click();
    // A NOT: not tagged "Difficult access" in group 1.
    await page.getByTestId("add-rule-0").click();
    await page.getByRole("button", { name: "+ Tags", exact: true }).click();
    const group1 = page.getByTestId("group-0");
    await group1.getByRole("button", { name: "Difficult access" }).click();
    await group1.getByRole("button", { name: "is", exact: true }).last().click();
    await expect(group1.getByRole("button", { name: "not", exact: true })).toBeVisible();

    await page.getByTestId("preview").click();
    const result = page.getByTestId("preview-result");
    await expect(result).toBeVisible();
    await expect(result).toContainText(people.opens.name);
    await expect(result).toContainText(people.declined.name);
    const countText = await result.locator(".stat b").first().innerText();
    expect(Number(countText.replace(/,/g, ""))).toBeGreaterThanOrEqual(3);

    await page.getByRole("button", { name: "Save list" }).click();
    await page.waitForURL(/\/crm\/segments\/p5-list/);
    segmentKey = new URL(page.url()).pathname.split("/").pop()!;
    const { data: row } = await db!.from("crm_segments").select("rules").eq("key", segmentKey).single();
    const rules = row?.rules as { groups: Array<{ match: string; rules: Array<{ field: string; not?: boolean }> }> };
    expect(rules.groups.map((g) => g.match)).toEqual(["all", "any"]);
    expect(rules.groups[0].rules.some((r) => r.field === "tags" && r.not)).toBe(true);
  });

  test("a quote follow-up on 'estimate sent': waits from the anchor, a condition skips a step, an exit finishes a run", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto("/crm/campaigns");
    await page.getByTestId("new-name").fill(`P5 chase ${run}`);
    await page.getByTestId("new-class").selectOption("followup");
    await page.getByTestId("new-entry").selectOption("event");
    await page.getByTestId("new-trigger").selectOption("estimate_sent");
    await page.getByTestId("new-start").click();
    await page.waitForURL(/\/crm\/campaigns\/c\//);
    followupId = new URL(page.url()).pathname.split("/").pop()!;

    // The always-on exits wear their chip; step 1 = text after 3 days if unopened; step 2 = email after 7 if opened & silent.
    await expect(page.getByTestId("exit-replied")).toBeDisabled();
    await expect(page.getByTestId("exit-accepted")).toBeDisabled();
    await page.getByTestId("step-1").getByLabel("Send as").selectOption("sms");
    await page.getByTestId("step-1-days").fill("3");
    await page.getByTestId("step-1-template").selectOption(smsTemplateId);
    await page.getByTestId("step-1-condition").selectOption("unopened");
    await page.getByTestId("add-step").click();
    await page.getByTestId("step-2-days").fill("7");
    await page.getByTestId("step-2-template").selectOption(emailTemplateId);
    await page.getByTestId("step-2-condition").selectOption("opened_silent");
    await page.getByTestId("status-live").click();
    await expect(page.getByTestId("said")).toContainText("Live");

    // Events before the campaign existed are not its business — unless told so.
    await db!.from("campaigns").update({ events_since: daysAgo(10) }).eq("id", followupId);
    await page.getByTestId("dry-run").click();
    const dry = page.getByTestId("dry-run-result");
    await expect(dry).toBeVisible();
    await expect(dry).toContainText(people.opens.name);
    await expect(dry).toContainText("Waiting for approval");

    // Olive opens her estimate; Reza replies. Then the sweep judges.
    await db!.from("estimate_views").insert({ estimate_id: people.opens.estimateId, session_id: randomUUID(), dwell_ms: 42_000 });
    await db!.from("messages").insert({ account_id: people.replies.id, channel: "email", direction: "in", body: `Thanks, will call ${run}`, provider: "manual", status: "received" });
    for (const p of [people.opens, people.replies]) await page.goto(`/crm/customers/${p.id}`);

    await page.goto("/crm/campaigns/queue");
    await page.getByTestId("sweep-now").click();
    await expect(page.getByTestId("queue-said")).toContainText(/matched/, { timeout: 60_000 });

    const { data: enrolments } = await db!.from("campaign_enrolments").select("account_id, anchor_at, anchor_key, last_step, finished_at, finished_reason").eq("campaign_id", followupId);
    const of = (id: string) => enrolments?.find((e) => e.account_id === id);
    // Reza replied: finished at the sweep, nothing queued.
    expect(of(people.replies.id)?.finished_reason).toBe("They replied.");
    // Olive opened: step 1 ("only if unopened") consumed as stopped, the enrolment continues.
    expect(of(people.opens.id)?.finished_at).toBeNull();
    expect(of(people.opens.id)?.last_step).toBe(1);
    expect(of(people.opens.id)?.anchor_key).toBe(people.opens.estimateId);
    expect(Math.abs(new Date(of(people.opens.id)!.anchor_at as string).getTime() - new Date(daysAgo(4)).getTime())).toBeLessThan(120_000);
    // Dana (email declined) is not touched by an SMS step: queued, waiting for a person.
    const { data: msgs } = await db!.from("campaign_messages").select("account_id, step, state, reason, channel, condition").eq("campaign_id", followupId);
    const olive = msgs?.find((m) => m.account_id === people.opens.id);
    expect(olive).toMatchObject({ step: 1, state: "stopped", channel: "sms", condition: "unopened" });
    expect(olive?.reason).toMatch(/opened it/);
    const dana = msgs?.find((m) => m.account_id === people.declined.id);
    expect(dana).toMatchObject({ step: 1, state: "queued", channel: "sms" });

    // Step 2 is due 7 days after the anchor: not yet. Move the anchor back and sweep again.
    await page.getByTestId("sweep-now").click();
    await expect(page.getByTestId("queue-said")).toContainText(/matched/, { timeout: 60_000 });
    expect((await db!.from("campaign_messages").select("id").eq("campaign_id", followupId).eq("account_id", people.opens.id)).data).toHaveLength(1);
    await db!.from("campaign_enrolments").update({ anchor_at: daysAgo(8) }).eq("campaign_id", followupId).eq("account_id", people.opens.id);
    await page.getByTestId("sweep-now").click();
    await expect(page.getByTestId("queue-said")).toContainText(/matched/, { timeout: 60_000 });
    const { data: step2 } = await db!.from("campaign_messages").select("id, step, state, channel, condition").eq("campaign_id", followupId).eq("account_id", people.opens.id).eq("step", 2).maybeSingle();
    expect(step2).toMatchObject({ state: "queued", channel: "email", condition: "opened_silent" });

    // Approve it: the guard passes (opened, silent), delivery is attempted — on C1 there is no key, so it fails honestly.
    await page.reload();
    const card = page.getByTestId(`queue-${step2!.id}`);
    await expect(card).toContainText("follow-up");
    await card.getByTestId("approve-one").click();
    await expect(page.getByTestId("queue-said")).toBeVisible({ timeout: 30_000 });
    const { data: after } = await db!.from("campaign_messages").select("state, reason, judged_at").eq("id", step2!.id).single();
    expect(["sent", "failed"]).toContain(after?.state);
    expect(after?.judged_at).not.toBeNull();
    if (after?.state === "failed") expect(after.reason).toMatch(/key|Resend|mail/i);
  });

  test("marketing to the list: a declined permission is finished at the sweep; approve-all judges each one; a tracked link records the click", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto("/crm/campaigns");
    await page.getByTestId("new-name").fill(`P5 spring ${run}`);
    await page.getByTestId("new-class").selectOption("marketing");
    await page.getByTestId("new-entry").selectOption("audience");
    await page.getByTestId("new-segment").selectOption(segmentKey);
    await page.getByTestId("new-start").click();
    await page.waitForURL(/\/crm\/campaigns\/c\//);
    marketingId = new URL(page.url()).pathname.split("/").pop()!;
    await page.getByTestId("step-1-days").fill("0");
    await page.getByTestId("step-1-template").selectOption(emailTemplateId);
    await page.getByTestId("status-live").click();
    await expect(page.getByTestId("said")).toContainText("Live");

    await page.goto("/crm/campaigns/queue?c=" + marketingId);
    await page.getByTestId("sweep-now").click();
    await expect(page.getByTestId("queue-said")).toContainText(/matched/, { timeout: 60_000 });
    const { data: enrolments } = await db!.from("campaign_enrolments").select("account_id, finished_reason").eq("campaign_id", marketingId);
    expect(enrolments?.find((e) => e.account_id === people.declined.id)?.finished_reason).toBe("They said no to emails.");
    const { data: queued } = await db!.from("campaign_messages").select("id, account_id, state").eq("campaign_id", marketingId).eq("state", "queued");
    expect(queued?.map((q) => q.account_id)).toEqual(expect.arrayContaining([people.opens.id, people.replies.id]));
    expect(queued?.some((q) => q.account_id === people.declined.id)).toBe(false);

    await page.reload();
    await page.getByRole("button", { name: /Select all/ }).click();
    await page.getByTestId("approve-selected").click();
    await expect(page.getByTestId("queue-said")).toContainText(/sent|failed|held|refused/, { timeout: 60_000 });
    const { data: judged } = await db!.from("campaign_messages").select("id, state, judged_at").eq("campaign_id", marketingId).in("account_id", [people.opens.id, people.replies.id]);
    expect(judged?.every((m) => m.judged_at != null && ["sent", "failed", "held"].includes(m.state as string))).toBe(true);

    // The tracked link: a click lands on the queue row, the messages row, the timeline — then redirects.
    const msgId = judged![0].id as string;
    const target = `${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/account?from=${run}`;
    const res = await page.request.get(`/t/${trackedToken(msgId, target)}`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toBe(target);
    const { data: clicked } = await db!.from("campaign_messages").select("clicks, account_id").eq("id", msgId).single();
    expect(clicked?.clicks).toBe(1);
    const { data: ev } = await db!.from("crm_events").select("id").eq("account_id", clicked!.account_id).eq("type", "cta_clicked").limit(1);
    expect(ev?.length).toBe(1);
    // A forged token goes home, not to the target.
    const forged = await page.request.get(`/t/${trackedToken(msgId, target).slice(0, -2)}zz`, { maxRedirects: 0 });
    expect(forged.headers()["location"]).not.toContain(run);

    // The builder shows the numbers.
    await page.goto(`/crm/campaigns/c/${marketingId}`);
    const stats = page.getByTestId("stats");
    await expect(stats).toBeVisible();
    await expect(stats).toContainText("Enrolled");
  });
});
