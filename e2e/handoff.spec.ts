import { test, expect, type Browser } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor } from "./fixtures/portal";

/**
 * S7 — live handoff, two browsers (C1 stack, AGENT_MODEL_STUB=1):
 *   in hours   customer asks for a person → card in Today → staff claims →
 *              messages both ways, live → resolve → the assistant resumes
 *   after hours the assistant says so and books a callback for the next
 *              working day (a callback_requested event → the existing card)
 * Support hours are set on the test project for each half and restored.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db: SupabaseClient | null = url && key ? createClient(url, key) : null;
const staff = credentials("STAFF");

const ALL_DAY = { timezone: "Australia/Melbourne", days: { mon: ["00:00", "23:59"], tue: ["00:00", "23:59"], wed: ["00:00", "23:59"], thu: ["00:00", "23:59"], fri: ["00:00", "23:59"], sat: ["00:00", "23:59"], sun: ["00:00", "23:59"] }, strongCoverageDays: [] };
const CLOSED = { timezone: "Australia/Melbourne", days: { mon: ["08:00", "08:01"] }, strongCoverageDays: [] };

async function customerContext(browser: Browser, sb: SupabaseClient, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(await magicLinkFor(sb, email));
  return { context, page };
}

test.describe("assistant — human handoff", () => {
  test.skip(!db || !staff, "service key + staff login needed");
  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.handoff.${run}@example.com`;
  let estimateId: string | null = null;
  let savedHours: unknown = null;

  test.beforeAll(async () => {
    const sb = db!;
    const { data } = await sb.from("agent_settings").select("support_hours").eq("tenant_key", "paint-group").maybeSingle();
    savedHours = data?.support_hours ?? null;
    const acct = await sb.from("accounts").insert({ email, name: "Hannah Handoff" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    const est = await sb.from("estimates").insert({ title: "9 Handoff Lane", status: "sent", source: "wizard", level_of_finish: 3, account_id: acct.data.id, share_token: `ho${run}${Math.random().toString(36).slice(2, 20)}`, sent_at: new Date().toISOString(), total_cents: 450000, builder_state: { blocks: [], agent: { answers: {}, facts: { accountType: "residential", email } } } }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;
  });
  test.afterAll(async () => {
    const sb = db!;
    if (savedHours) await sb.from("agent_settings").update({ support_hours: savedHours }).eq("tenant_key", "paint-group");
    if (estimateId) await sb.from("agent_conversations").delete().eq("estimate_id", estimateId);
    await destroyAccountChain(sb, email);
    await deleteUserByEmail(sb, email);
  });

  test("in hours: request → card → claim → both ways live → resolve → the assistant resumes", async ({ browser, page: staffPage }) => {
    test.setTimeout(300_000);
    const sb = db!;
    await sb.from("agent_settings").update({ support_hours: ALL_DAY }).eq("tenant_key", "paint-group");

    const { context, page } = await customerContext(browser, sb, email);
    await page.goto(`/account/assist/${estimateId}`);
    await expect(page.getByTestId("sp-msg-assistant").first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("sp-person").click();
    await expect(page.getByTestId("sp-msg-assistant").last()).toContainText(/asked a person/, { timeout: 60_000 });
    await expect(page.getByTestId("support")).toHaveAttribute("data-status", "handed_off", { timeout: 20_000 });

    // The card, in Today, with one action: Claim.
    await signIn(staffPage, staff!, /estimates/);
    await staffPage.goto("/crm/today?f=messages");
    const card = staffPage.locator("text=Hannah Handoff is waiting for a person").first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const claimLink = staffPage.getByRole("link", { name: /Claim/ }).first();
    await claimLink.click();
    await expect(staffPage).toHaveURL(/\/crm\/chat\//);
    await staffPage.getByTestId("lc-claim").click();
    await expect(staffPage.getByTestId("lc-summary")).toContainText(/asked for a person/, { timeout: 20_000 });

    // Both ways, live, one transcript.
    await staffPage.getByTestId("lc-input").fill("Hi Hannah — Tom here. What can I help with?");
    await staffPage.getByTestId("lc-send").click();
    await expect(page.getByTestId("sp-msg-staff").last()).toContainText("Tom here", { timeout: 30_000 });
    await expect(page.getByTestId("sp-status")).toContainText(/with you now/);
    await page.getByTestId("sp-input").fill("Is Saturday OK for the visit?");
    await page.getByTestId("sp-send").click();
    await expect(staffPage.getByTestId("lc-msg-user").last()).toContainText("Saturday", { timeout: 30_000 });
    // The assistant stayed quiet while a person had it.
    const assistantCount = await page.getByTestId("sp-msg-assistant").count();

    await staffPage.getByTestId("lc-resolve").click();
    await expect(page.getByTestId("sp-msg-assistant").last()).toContainText(/stepped away/, { timeout: 30_000 });
    expect(await page.getByTestId("sp-msg-assistant").count()).toBe(assistantCount + 1);
    await expect(page.getByTestId("support")).toHaveAttribute("data-status", "open", { timeout: 20_000 });

    // Nothing lost: every message is in the one transcript.
    const { data: conv } = await sb.from("agent_conversations").select("id").eq("estimate_id", estimateId).eq("mode", "support").maybeSingle();
    const { data: msgs } = await sb.from("agent_messages").select("role, content").eq("conversation_id", conv!.id).order("created_at");
    const roles = (msgs ?? []).map((m) => m.role);
    expect(roles).toContain("staff");
    expect((msgs ?? []).some((m) => m.role === "user" && /Saturday/.test(m.content))).toBe(true);
    const { data: h } = await sb.from("agent_handoffs").select("status, claimed_by").eq("conversation_id", conv!.id).order("requested_at", { ascending: false }).limit(1).maybeSingle();
    expect(h?.status).toBe("resolved");
    expect(h?.claimed_by).toBeTruthy();
    await context.close();
  });

  test("after hours: the assistant says so and books a callback for the next working day", async ({ browser }) => {
    test.setTimeout(180_000);
    const sb = db!;
    await sb.from("agent_settings").update({ support_hours: CLOSED }).eq("tenant_key", "paint-group");
    const { context, page } = await customerContext(browser, sb, email);
    await page.goto(`/account/assist/${estimateId}`);
    await expect(page.getByTestId("sp-msg-assistant").first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("sp-person").click();
    await expect(page.getByTestId("sp-msg-assistant").last()).toContainText(/closed just now/, { timeout: 60_000 });
    await page.getByTestId("sp-callback").click();
    await page.getByLabel("Mobile number").fill("0412 345 678");
    await page.getByRole("button", { name: "Book the callback" }).click();
    await expect(page.getByTestId("sp-msg-assistant").last()).toContainText(/Booked — we'll call you \d{4}-\d{2}-\d{2}/, { timeout: 60_000 });

    const { data: acct } = await sb.from("accounts").select("id").eq("email", email).single();
    const { data: cbs } = await sb.from("callback_requests").select("phone_e164, window, created_for_date").eq("account_id", acct!.id);
    expect(cbs?.length).toBeGreaterThan(0);
    expect(cbs![0].phone_e164).toBe("+61412345678");
    expect(cbs![0].created_for_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(cbs![0].created_for_date).getTime()).toBeGreaterThan(Date.now() - 86_400_000);
    const { data: ev } = await sb.from("crm_events").select("type").eq("account_id", acct!.id).eq("type", "callback_requested");
    expect(ev?.length).toBeGreaterThan(0);
    await context.close();
  });
});
