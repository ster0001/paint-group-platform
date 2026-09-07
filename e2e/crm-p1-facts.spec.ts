import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * CRM v2 · P1 — identity, the self-feeding event log, the facts layer and
 * lapsing, driven as staff against the real screens (C1 test stack).
 *
 * The load-bearing assertions, from the deep dive's fault list:
 *   · F2: a sent, opened, lapsed estimate writes its own events — nothing in
 *     app code logged them, the triggers did
 *   · F1: a phone-only customer exists and is findable; two records for one
 *     phone merge into one, and the merge is on the timeline
 *   · F4: the list is a database query — search by name and by phone digits,
 *     the Lapsed chip counts, the board's "Quote lapsed" lane files the card
 *   · 8.11: a lapsed quote becomes a Today item that a logged call retires
 */

const db: SupabaseClient | null = serviceClient();
const staff = {
  email: process.env.E2E_STAFF_EMAIL ?? "",
  password: process.env.E2E_STAFF_PASSWORD ?? "",
};

const run = randomBytes(4).toString("hex");
const NAME = `Priya Lapsed ${run}`;
const EMAIL = `crm.p1.${run}@volume.example`;
const DIGITS = String(parseInt(run.slice(0, 6), 16)).padStart(8, "0").slice(0, 8);
const PHONE = `04${DIGITS.slice(0, 2)} ${DIGITS.slice(2, 5)} ${DIGITS.slice(5, 8)}`;
const PHONE_ONLY_NAME = `Ravi Phoneonly ${run}`;
const REV = DIGITS.split("").reverse().join("");
const PHONE_ONLY = `0498 ${REV.slice(0, 3)} ${REV.slice(3, 6)}`;

const SHOTS = process.env.CRM_P1_SHOTS ?? "";

async function loginAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe("CRM v2 P1 — identity, lifecycle events, facts, lapsing", () => {
  // One story, in order: the lapse happens in the first test and every later one reads it.
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  let accountId = "";
  let estimateId = "";
  let phoneOnlyId = "";
  let dupId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const acc = await sb.from("accounts").insert({ email: EMAIL, name: NAME, phone: PHONE }).select("id").single();
    if (acc.error) throw new Error(acc.error.message);
    accountId = acc.data.id as string;

    const sentAt = new Date(Date.now() - 70 * 86_400_000);
    const est = await sb.from("estimates").insert({
      title: `P1 lapse ${run}`, status: "sent", level_of_finish: 3, total_cents: 435_200,
      account_id: accountId, sent_at: sentAt.toISOString(),
      valid_until: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      builder_state: { blocks: [] },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;

    // The customer opened it once — a viewing session, as the estimate page records.
    const view = await sb.from("estimate_views").insert({ estimate_id: estimateId, session_id: randomUUID(), dwell_ms: 42_000 });
    if (view.error) throw new Error(view.error.message);

    // A record with a phone and no email (decision 8.2).
    const po = await sb.from("accounts").insert({ name: PHONE_ONLY_NAME, phone: PHONE_ONLY, email: null }).select("id").single();
    if (po.error) throw new Error(`phone-only: ${po.error.message}`);
    phoneOnlyId = po.data.id as string;

    // A duplicate of the main record: different email, same mobile.
    const dup = await sb.from("accounts").insert({ email: `dup.${run}@volume.example`, name: `Priya L (dup ${run})`, phone: PHONE }).select("id").single();
    if (dup.error) throw new Error(dup.error.message);
    dupId = dup.data.id as string;
  });

  test.afterAll(async () => {
    const sb = db!;
    // Deleting an estimate that has lifecycle events must work — the FK's SET
    // NULL used to trip the append-only guard (P1 trap). A failure here is a bug.
    if (estimateId) {
      const { error } = await sb.from("estimates").delete().eq("id", estimateId);
      if (error) throw new Error(`estimate delete failed: ${error.message}`);
    }
    for (const id of [accountId, phoneOnlyId, dupId]) {
      if (!id) continue;
      const { error } = await sb.from("accounts").delete().eq("id", id);
      if (error) throw new Error(`account delete failed: ${error.message}`);
    }
  });

  test("the log feeds itself: sent, opened, then lapsed by the sweep — no app code wrote a row", async () => {
    const sb = db!;
    const before = await sb.from("crm_events").select("type").eq("account_id", accountId);
    expect((before.data ?? []).map((r) => r.type)).toEqual(expect.arrayContaining(["estimate_sent", "estimate_viewed"]));

    const lapsed = await sb.rpc("crm_lapse_estimates");
    expect(lapsed.error).toBeNull();
    expect(Number(lapsed.data)).toBeGreaterThanOrEqual(1);

    const est = await sb.from("estimates").select("status").eq("id", estimateId).single();
    expect(est.data?.status).toBe("expired");
    const after = await sb.from("crm_events").select("type").eq("account_id", accountId).eq("type", "estimate_lapsed");
    expect(after.data).toHaveLength(1);
  });

  test("two records for one mobile merge into one, and the merge is on the record", async () => {
    const sb = db!;
    const dups = await sb.rpc("crm_duplicate_candidates", { p_limit: 50, p_account: accountId });
    expect(dups.error).toBeNull();
    const pair = (dups.data as Array<{ account_a: string; account_b: string; reason: string }>)
      .find((d) => [d.account_a, d.account_b].includes(accountId) && [d.account_a, d.account_b].includes(dupId));
    expect(pair?.reason).toBe("phone");

    const merged = await sb.rpc("crm_merge_accounts", { p_keep: accountId, p_drop: dupId });
    expect(merged.error).toBeNull();
    const gone = await sb.from("accounts").select("id").eq("id", dupId).maybeSingle();
    expect(gone.data).toBeNull();
    dupId = "";
    const ev = await sb.from("crm_events").select("payload").eq("account_id", accountId).eq("type", "account_merged").single();
    expect((ev.data?.payload as { droppedEmail?: string }).droppedEmail).toBe(`dup.${run}@volume.example`);
    // The dropped record's email rides along as a contact on the kept one.
    const contacts = await sb.from("account_contacts").select("email, is_primary").eq("account_id", accountId);
    expect((contacts.data ?? []).map((c) => c.email)).toEqual(expect.arrayContaining([EMAIL, `dup.${run}@volume.example`]));
  });

  test("the list is a query: search by name and by phone digits, chips count, the board files the lane", async ({ page }) => {
    await loginAs(page, staff);

    await page.goto(`/crm/customers?q=${encodeURIComponent(run)}`);
    const row = page.locator(".prow", { hasText: NAME });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Lapsed");
    await shot(page, "customers-search");

    // Phone digits, typed as a person types them.
    await page.goto(`/crm/customers?q=${DIGITS.slice(0, 6)}`);
    await expect(page.locator(".prow", { hasText: NAME })).toBeVisible();
    await expect(page.locator(".prow", { hasText: PHONE_ONLY_NAME })).toHaveCount(0);
    await page.goto(`/crm/customers?q=0498${REV.slice(0, 3)}`);
    await expect(page.locator(".prow", { hasText: PHONE_ONLY_NAME })).toBeVisible();

    // The Lapsed chip is a count, and the filter finds her.
    await page.goto(`/crm/customers?f=lapsed&q=${encodeURIComponent(run)}`);
    await expect(page.locator(".prow", { hasText: NAME })).toBeVisible();
    const lapsedChip = page.locator(".chip", { hasText: "Lapsed" });
    const chipCount = Number((await lapsedChip.locator(".chipn").textContent())?.trim() ?? "0");
    expect(chipCount).toBeGreaterThanOrEqual(1);

    await page.goto(`/crm/customers?view=board&f=lapsed&q=${encodeURIComponent(run)}`);
    const lane = page.locator(".lane", { has: page.locator(".lanename", { hasText: "Quote lapsed" }) });
    await expect(lane.locator(".card", { hasText: NAME })).toBeVisible();
    await shot(page, "board-lapsed");
  });

  test("the record shows what the log now holds, and Today asks about the lapsed quote until someone calls", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/customers/${accountId}`);
    await expect(page.locator(".tl")).toContainText("Estimate sent");
    await expect(page.locator(".tl")).toContainText("Estimate opened");
    await expect(page.locator(".tl")).toContainText("Estimate lapsed");
    await expect(page.locator(".tl")).toContainText("Merged a duplicate record");
    await shot(page, "record-timeline");

    const title = `${NAME}'s quote lapsed`;
    const findOnToday = async (): Promise<boolean> => {
      for (let p = 1; p <= 12; p++) {
        await page.goto(`/crm/today?f=followups&page=${p}`);
        if (await page.getByText(title).count()) return true;
        if (!(await page.locator('a[href*="page="]', { hasText: /next|older|→/i }).count())) break;
      }
      return false;
    };
    expect(await findOnToday()).toBe(true);
    await shot(page, "today-lapsed");

    // Somebody rings her: the item retires on its own.
    await page.goto(`/crm/customers/${accountId}`);
    // P2: the chip picks the outcome; Save writes it.
    const sheet = page.getByTestId("log-sheet").first();
    await sheet.getByRole("button", { name: /called — no answer/i }).click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".tl")).toContainText("Called — no answer");
    expect(await findOnToday()).toBe(false);
  });
});
