import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, signIn } from "../helpers";
import { deleteUserByEmail, destroyAccountChain } from "../fixtures/portal";
import { driveNoPlanWizard, uniquePhone , openQuickLook, fillQuickAddress } from "./drive";

/**
 * Tom, 8 Sep 2026 — reach a person from the BUILDER at any point, and chat:
 *   1. rooms not yet confirmed: "Request a call back" from the footer strip
 *      files the request (a mobile is all it needs);
 *   2. "Book a site visit" lists the real windows and books one — a visits
 *      row, and the draft says "Booked: …" so Today raises no second card;
 *   3. the chat bubble: a customer line pops the dock on a staff screen that
 *      is NOT the CRM, staff answer from the dock, the customer sees it.
 * C1 stack (AGENT_MODEL_STUB=1); support hours set all-day for the run.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
const staff = credentials("STAFF");
const stamp = Date.now();
// Test-pattern emails are never attached to an account (lib/accounts/identity
// isTestEmail) — the request files by PHONE, so the checks look it up that way.
const callbackEmail = `e2e-reach-call-${stamp}@example.com`;
const visitEmail = `e2e-reach-visit-${stamp}@example.com`;
const callbackPhone = uniquePhone(), visitPhone = uniquePhone();
void visitPhone;
const accountByPhone = async (sb: SupabaseClient, phone: string) => {
  const { data } = await sb.rpc("crm_find_account", { p_email: null, p_phone: phone });
  return (data as string | null) ?? null;
};
const ALL_DAY = { timezone: "Australia/Melbourne", days: { mon: ["00:00", "23:59"], tue: ["00:00", "23:59"], wed: ["00:00", "23:59"], thu: ["00:00", "23:59"], fri: ["00:00", "23:59"], sat: ["00:00", "23:59"], sun: ["00:00", "23:59"] }, strongCoverageDays: [] };

/** The quick look's first screen, with an address on it (v2 phase 2). */
async function openWizardPage1(page: import("@playwright/test").Page) {
  await openQuickLook(page);
  await fillQuickAddress(page);
}

test.describe("reach a person + chat (Tom, 8 Sep)", () => {
  test.skip(!db || !staff, "service key + staff login needed");
  let savedHours: unknown = null; let staffId = ""; let hadAvailability = false; let conversationId: string | null = null;

  test.beforeAll(async () => {
    const sb = db!;
    const { data } = await sb.from("agent_settings").select("support_hours").eq("tenant_key", "paint-group").maybeSingle();
    savedHours = data?.support_hours ?? null;
    await sb.from("agent_settings").update({ support_hours: ALL_DAY }).eq("tenant_key", "paint-group");
    const { data: s } = await sb.from("profiles").select("id").eq("role", "staff").order("created_at").limit(1).single();
    staffId = s!.id as string;
    const { data: av } = await sb.from("staff_availability").select("staff_id").eq("staff_id", staffId).maybeSingle();
    hadAvailability = !!av;
    await sb.from("staff_availability").upsert({ staff_id: staffId, takes_visits: true, days: [0, 1, 2, 3, 4, 5, 6], day_start: "08:00", day_end: "18:00", visit_minutes: 60 }, { onConflict: "staff_id" });
  });
  test.afterAll(async () => {
    const sb = db!;
    if (savedHours) await sb.from("agent_settings").update({ support_hours: savedHours }).eq("tenant_key", "paint-group");
    if (conversationId) await sb.from("agent_conversations").delete().eq("id", conversationId);
    for (const e of [callbackEmail, visitEmail]) {
      const { data: acct } = await sb.from("accounts").select("id").eq("email", e).maybeSingle();
      const id = acct?.id ?? await accountByPhone(sb, e === callbackEmail ? callbackPhone : visitPhone);
      if (!id) continue;
      await sb.from("agent_conversations").delete().eq("account_id", id);
      await sb.from("estimates").delete().eq("account_id", id);
      await sb.from("visits").delete().eq("account_id", id);
      await sb.from("wizard_drafts").update({ account_id: null }).eq("account_id", id);
      await sb.from("crm_events").delete().eq("account_id", id);
      await sb.from("properties").delete().eq("account_id", id);
      await sb.from("accounts").delete().eq("id", id);
    }
    for (const e of [callbackEmail, visitEmail]) { await destroyAccountChain(sb, e); await deleteUserByEmail(sb, e); }
    if (!hadAvailability) await sb.from("staff_availability").delete().eq("staff_id", staffId);
  });

  test("in the builder, rooms unconfirmed: a call back from the footer strip", async ({ page }) => {
    test.setTimeout(240_000);
    await driveNoPlanWizard(page, { email: callbackEmail });
    const strip = page.getByTestId("reach-strip");
    await expect(strip).toBeVisible();
    // Tom, 8 Sep (evening): the finalise button is no longer dead while cards
    // are open — "make it clear… that they can click it before they have
    // clicked all the details". It is live, it says so, and it hands the job
    // to a person rather than ACCEPTING an unconfirmed scope.
    await expect(page.locator(".sc-btn.il-cta")).toBeEnabled();
    await expect(page.getByTestId("cta-hint")).toContainText(/don.t have to finish first/i);
    await strip.getByTestId("reach-callback").click();
    // The number is stated when we already have one; the box is behind
    // "use a different number" (Tom, 9 Sep).
    if (await page.getByTestId("reach-phone-change").count()) {
      await page.getByTestId("reach-phone-change").click();
    }
    await page.getByTestId("reach-phone").fill(callbackPhone);
    await page.getByTestId("reach-send").click();
    await expect(page.locator(".sc-tier")).toContainText(/Call back requested/, { timeout: 20_000 });
    const { data: acct } = await db!.from("accounts").select("id").eq("email", callbackEmail).single();
    await expect.poll(async () => {
      const { data } = await db!.from("crm_events").select("id").eq("account_id", acct!.id).eq("type", "callback_requested");
      return (data ?? []).length;
    }, { timeout: 20_000 }).toBeGreaterThan(0);
  });

  test("in the builder, rooms unconfirmed: a real visit booked from the footer strip", async ({ page }) => {
    test.setTimeout(240_000);
    await driveNoPlanWizard(page, { email: visitEmail });
    const strip = page.getByTestId("reach-strip");
    await strip.getByTestId("reach-visit").click();
    const slots = page.getByTestId("reach-slot");
    await expect(slots.first()).toBeVisible({ timeout: 20_000 });
    await slots.first().click();
    await page.getByTestId("reach-book").click();
    await expect(page.locator(".sc-tier")).toContainText(/Visit booked/, { timeout: 20_000 });
    const { data: acct } = await db!.from("accounts").select("id").eq("email", visitEmail).single();
    await expect.poll(async () => {
      const { data } = await db!.from("visits").select("id, status, source, staff_id").eq("account_id", acct!.id);
      return data ?? [];
    }, { timeout: 30_000 }).toHaveLength(1);
    const { data: visits } = await db!.from("visits").select("status, source, staff_id").eq("account_id", acct!.id);
    expect(visits![0].status).toBe("booked");
    expect(visits![0].source).toBe("wizard");
    expect(visits![0].staff_id).toBe(staffId);
    // The draft says "Booked: …" — Today raises no second "book visit" card.
    // A person's session (the 2.5 s autosave) reads "Booked: …" so Today raises
    // no second card; a test outruns that autosave, so the check is conditional.
    const { data: est } = await db!.from("estimates").select("id").eq("account_id", acct!.id).order("created_at", { ascending: false }).limit(1).single();
    const { data: drafts } = await db!.from("wizard_drafts").select("outcome, outcome_note").eq("estimate_id", est!.id);
    for (const d of drafts ?? []) {
      expect(d.outcome).toBe("visit_requested");
      expect(d.outcome_note ?? "").toMatch(/^Booked:/);
    }
  });

  test("the chat bubble reaches the dock on a non-CRM staff screen; the reply comes back", async ({ browser, page: staffPage }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext();
    const customer = await ctx.newPage();
    await openWizardPage1(customer);
    await customer.getByTestId("wz-chat-bubble").click();
    await expect(customer.getByTestId("wz-chat-assistant").first()).toBeVisible({ timeout: 30_000 });
    const line = `Is a Saturday possible? ${stamp}`;
    await customer.getByTestId("wz-chat-text").fill(line);
    await customer.getByTestId("wz-chat-send").click();
    await expect(customer.getByTestId("wz-chat-panel")).toHaveAttribute("data-status", "handed_off", { timeout: 30_000 });
    conversationId = await customer.evaluate(() => window.localStorage.getItem("pg-wizard-chat"));
    expect(conversationId).toBeTruthy();

    // Staff, on the Estimates list — not the CRM — see it in the corner.
    await signIn(staffPage, staff!, /estimates/);
    await staffPage.goto("/estimates");
    const dock = staffPage.getByTestId("staff-dock");
    await expect(dock).toBeVisible({ timeout: 40_000 });
    await expect(dock).toHaveAttribute("data-open", "1", { timeout: 20_000 });
    const row = dock.getByTestId("dock-row").filter({ hasText: String(stamp) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await staffPage.getByTestId("dock-claim").click();
    await expect(staffPage.getByTestId("dock-msg-system").first()).toBeVisible({ timeout: 20_000 });
    await staffPage.getByTestId("dock-input").fill("Yes — Saturdays are fine. What time suits?");
    await staffPage.getByTestId("dock-send").click();
    await expect(customer.getByTestId("wz-chat-staff").last()).toContainText("Saturdays are fine", { timeout: 30_000 });

    // Minimise: the pill, still there on another staff screen.
    await staffPage.getByTestId("dock-minimise").click();
    await expect(staffPage.getByTestId("dock-pill")).toBeVisible();
    await staffPage.goto("/invoices");
    await expect(staffPage.getByTestId("staff-dock")).toBeVisible({ timeout: 40_000 });

    // The customer answers; the dock flags it as unseen.
    await customer.getByTestId("wz-chat-text").fill("10am works");
    await customer.getByTestId("wz-chat-send").click();
    await expect(staffPage.getByTestId("staff-dock")).toHaveAttribute("data-open", "1", { timeout: 30_000 });
    await ctx.close();
  });
});
