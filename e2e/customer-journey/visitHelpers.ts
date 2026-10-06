import { expect, type Browser, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { driveNoPlanWizard } from "./drive";
import { STANDARD_WEEK } from "../../lib/visits/schedule";

/**
 * Shared by the visit-booking specs (S3, S4): an anonymous customer at the
 * guide range, the code read back from the recorded text, the estimator the
 * staff login stands in for, and the cleanup of everything a run created.
 */
export const RUN = randomBytes(3).toString("hex");
export const staffEmail = process.env.E2E_STAFF_EMAIL ?? "";

export type Customer = { page: Page; estimateId: string; mobile: string; email: string };

export async function startCustomer(browser: Browser, tag: string, suburb = "Glen Waverley", postcode = "3150"): Promise<Customer> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const mobile = `04${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const email = `visit.${tag}.${RUN}@example.com`;
  // S6: under "details first" the gate takes these; under "range first" the
  // visit page's details screen asks for them (`fillDetailsIfAsked`).
  await driveNoPlanWizard(page, { stopAtReveal: true, suburb, postcode, email, mobile, contactName: `Visit ${tag}` });
  const estimateId = (await page.getByTestId("reveal").getAttribute("data-estimate-id")) ?? "";
  expect(estimateId).toBeTruthy();
  return { page, estimateId, mobile, email };
}

/** The visit page's "A few details first" — shown only when the session holds no contact (range first). */
export async function fillDetailsIfAsked(c: Customer, name: string): Promise<void> {
  const details = c.page.getByTestId("visit-details");
  const other = c.page.locator("[data-testid='visit-calendar'], [data-testid='visit-request'], [data-testid='visit-out'], [data-testid='visit-code']");
  await expect(details.or(other.first())).toBeVisible({ timeout: 30_000 });
  if (await details.count()) {
    await c.page.getByTestId("visit-name").fill(name);
    await c.page.getByTestId("visit-email").fill(c.email);
    await c.page.getByTestId("visit-mobile").fill(c.mobile);
    await c.page.getByTestId("visit-details-go").click();
  }
}

export async function codeFor(sb: SupabaseClient, mobile: string): Promise<string> {
  const e164 = `+61${mobile.replace(/\D/g, "").slice(1)}`;
  for (let i = 0; i < 20; i++) {
    const { data } = await sb.from("messages").select("body, created_at").eq("to_address", e164).ilike("body", "%code to book%").order("created_at", { ascending: false }).limit(1);
    const m = /\b(\d{6})\b/.exec((data?.[0]?.body as string | undefined) ?? "");
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no code text recorded for ${e164}`);
}

/** The staff login covers every zone and has a week, for the length of the run. */
export async function ensureEstimator(sb: SupabaseClient): Promise<{ staffId: string; restore: () => Promise<void> }> {
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const u = users?.users.find((x) => (x.email ?? "").toLowerCase() === staffEmail.toLowerCase());
  if (!u) throw new Error("staff login not found");
  const staffId = u.id;
  const { data: zones } = await sb.from("visit_zones").select("key, estimator_id");
  const before = new Map((zones ?? []).map((z) => [z.key as string, z.estimator_id as string | null]));
  await sb.from("visit_zones").update({ estimator_id: staffId }).is("estimator_id", null);
  // S5: a real booking needs the estimator's Google Calendar; the test project has
  // none, so the rule is switched off for the run and put back after.
  const { data: rulesRow } = await sb.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
  const rulesBefore = (rulesRow?.value ?? {}) as Record<string, unknown>;
  await sb.from("settings").upsert({ key: "visit_booking_rules", value: { ...rulesBefore, calendarRequired: false } }, { onConflict: "key" });
  const { data: slots } = await sb.from("visit_slots").select("id").eq("estimator_id", staffId).limit(1);
  const hadWeek = !!slots?.length;
  if (!hadWeek) {
    const { error } = await sb.from("visit_slots").insert(STANDARD_WEEK.map((s) => ({ estimator_id: staffId, weekday: s.weekday, start_minutes: s.startMinutes, length_minutes: 90, zones: [...s.zones].sort(), cond_zone: s.cond?.zone ?? null, cond_if_prev_zone: s.cond?.ifPrevZone ?? null })));
    if (error) throw new Error(error.message);
  }
  return {
    staffId,
    restore: async () => {
      await sb.from("settings").upsert({ key: "visit_booking_rules", value: rulesBefore }, { onConflict: "key" });
      for (const [key, est] of before) if (est === null) await sb.from("visit_zones").update({ estimator_id: null }).eq("key", key);
      if (!hadWeek) await sb.from("visit_slots").delete().eq("estimator_id", staffId);
    },
  };
}

export async function cleanupCustomers(sb: SupabaseClient, customers: Customer[]) {
  const ids = customers.map((c) => c.estimateId).filter(Boolean);
  if (ids.length) {
    await sb.from("visits").delete().in("estimate_id", ids);
    await sb.from("visit_holds").delete().in("estimate_id", ids);
    await sb.from("visit_requests").delete().in("estimate_id", ids);
    await sb.from("customer_message_receipts").delete().in("estimate_id", ids);
  }
  for (const c of customers) {
    await sb.from("visit_requests").delete().eq("email", c.email);
    const { data: acc } = await sb.from("accounts").select("id").eq("email", c.email).maybeSingle();
    if (acc) {
      await sb.from("estimates").update({ account_id: null, property_id: null }).eq("account_id", acc.id);
      await sb.from("visit_requests").delete().eq("account_id", acc.id);
      await sb.from("properties").delete().eq("account_id", acc.id);
      await sb.from("accounts").delete().eq("id", acc.id);
    }
  }
}

export async function loginStaff(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', staffEmail);
  await page.fill('input[type="password"]', process.env.E2E_STAFF_PASSWORD ?? "");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
