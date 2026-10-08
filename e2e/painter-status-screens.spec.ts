import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * The painter's traffic light, Step 6 (brief §7, R17–R20, ⚑21).
 *
 * AS THE PAINTER, in each of the five colours: the Home card shows the lamp
 * AND the word, the line on what it gets them, the steps to Green; My status
 * shows the reason line, the perks, the three measures as counts, the job
 * dots (tap one to see why), the tips and the colour key. Never a bonus
 * amount. Under reduced motion the lamp does not pulse. AS AN EMPLOYED LEAD:
 * the same screens say "jobs you led" and carry no priority or payment line.
 * AS A NON-LEAD EMPLOYEE: no status UI anywhere. With the office switch OFF:
 * nothing for anyone, and My status is a 404.
 *
 * The rows are written straight into painter_status / painter_job_results by
 * the service client — the evaluator is proven in painter-status.spec.ts;
 * this spec proves the screens read what is there.
 */
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const run = Date.now().toString(36);
const lead = { email: `pg.e2e.employee.${run}.lead@example.com`, password: `Employee-${run}-pw!` };
const crew = { email: `pg.e2e.employee.${run}.crew@example.com`, password: `Employee-${run}-pw!` };
const made: { user: string; contractor: string }[] = [];

let contractorId = "";
let leadId = "";
let cleanJob: LoopFixture | null = null;
let slipJob: LoopFixture | null = null;
let savedRules: Record<string, unknown> | null = null;

const measures = (checks: [number, number], rem: [number, number], cb: number, bands: { c: string | null; r: string | null; cb: string }) => ({
  checks: { passedFirstTime: checks[0], done: checks[1], band: bands.c },
  reminders: { answered: rem[0], scored: rem[1], creditsApplied: 0, band: bands.r },
  callbacks: { scored: cb, band: bands.cb },
});
const PROFILES = {
  new: { streak: 2, best_streak: 2, bonus_counter: 0, line: "Clean job 2 of 4. Finish 4 clean jobs in a row to reach Green.", measures: { ...measures([2, 2], [5, 5], 0, { c: "yellow", r: "yellow", cb: "yellow" }), stepsToGreen: 2 } },
  green: { streak: 6, best_streak: 6, bonus_counter: 3, line: "Your last 4 jobs were all clean.", measures: { ...measures([3, 3], [12, 12], 0, { c: "yellow", r: "yellow", cb: "yellow" }), stepsToGreen: 0 } },
  yellow: { streak: 2, best_streak: 5, bonus_counter: 0, line: "One call back in your last 10 jobs.", measures: { ...measures([5, 5], [20, 20], 1, { c: "yellow", r: "yellow", cb: "yellow" }), stepsToGreen: 2 } },
  orange: { streak: 0, best_streak: 3, bonus_counter: 0, line: "Two call backs and two failed checks in your last 10 jobs.", measures: { ...measures([3, 5], [20, 30], 2, { c: "orange", r: "orange", cb: "orange" }), stepsToGreen: 4 } },
  red: { streak: 0, best_streak: 2, bonus_counter: 0, line: "Four call backs in your last 10 jobs.", measures: { ...measures([2, 5], [12, 30], 4, { c: "red", r: "red", cb: "red" }), stepsToGreen: 4 } },
} as const;

async function setStatus(painterId: string, colour: keyof typeof PROFILES) {
  const p = PROFILES[colour];
  const { error } = await db!.from("painter_status").upsert({ painter_id: painterId, colour, ...p, computed_at: new Date().toISOString() }, { onConflict: "painter_id" });
  expect(error?.message ?? "").toBe("");
}
async function setResults(painterId: string) {
  await db!.from("painter_job_results").delete().eq("painter_id", painterId);
  const { error } = await db!.from("painter_job_results").insert([
    { painter_id: painterId, work_order_id: cleanJob!.workOrderId, result: "clean", reasons: [], hours: 20, counts_for_bonus: true, signed_on: "2026-09-20", checks_done: 1, checks_passed: 1, moments_scored: 3, moments_answered: 3, callbacks_scored: 0, credits_applied: 0, finalised_at: new Date().toISOString() },
    { painter_id: painterId, work_order_id: slipJob!.workOrderId, result: "not_clean", reasons: ["A call back for workmanship", "Missed 1 of 2 reminders"], hours: 8, counts_for_bonus: false, signed_on: "2026-09-25", checks_done: 0, checks_passed: 0, moments_scored: 2, moments_answered: 1, callbacks_scored: 1, credits_applied: 0, finalised_at: new Date().toISOString() },
  ]);
  expect(error?.message ?? "").toBe("");
}
async function makePainter(creds: { email: string; password: string }, name: string) {
  const created = await db!.auth.admin.createUser({ email: creds.email, password: creds.password, email_confirm: true, user_metadata: { name } });
  if (created.error || !created.data.user) throw new Error(`create ${name}: ${created.error?.message}`);
  const uid = created.data.user.id;
  const role = await db!.from("profiles").update({ role: "contractor", name }).eq("id", uid);
  if (role.error) throw new Error(role.error.message);
  const c = await db!.from("contractors").insert({ profile_id: uid, tier: "B", active: true, company_name: "", employment_type: "employee", standards_grace_until: "2030-01-01T00:00:00Z" }).select("id").single();
  if (c.error) throw new Error(c.error.message);
  made.push({ user: uid, contractor: (c.data as { id: string }).id });
  return (c.data as { id: string }).id;
}
async function home(page: Page) {
  await page.goto("/portal");
  await expect(page.locator("h1")).toContainText(/G.day/);
}

test.describe.configure({ mode: "serial" });

test.describe("the painter's traffic light", () => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to write the status rows");
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    const { data: rules } = await db!.from("settings").select("value").eq("key", "painter_status_rules").maybeSingle();
    savedRules = ((rules as { value: Record<string, unknown> } | null)?.value) ?? null;
    expect(savedRules, "painter_status_rules must exist (migration 20270228)").not.toBeNull();
    await db!.from("settings").update({ value: { ...savedRules, statusVisibleToPainters: true } }).eq("key", "painter_status_rules");
    cleanJob = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls"] }]);
    slipJob = await createLoopFixture(db!, contractorId, [{ heading: "Hall", labels: ["Walls"] }]);
    for (const f of [cleanJob, slipJob]) await db!.from("work_orders").update({ stage: "closed", status: "complete" }).eq("id", f.workOrderId);
    await setResults(contractorId);
    leadId = await makePainter(lead, "E2E Lead Employee");
    await makePainter(crew, "E2E Crew Employee");
    await setStatus(leadId, "green");
  });

  test.afterAll(async () => {
    if (!db) return;
    await db.from("painter_job_results").delete().eq("painter_id", contractorId);
    await db.from("painter_status").delete().eq("painter_id", contractorId);
    for (const f of [cleanJob, slipJob]) await destroyLoopFixture(db, f);
    for (const m of made) { await db.from("contractors").delete().eq("id", m.contractor); await db.auth.admin.deleteUser(m.user); }
    if (savedRules) await db.from("settings").update({ value: savedRules }).eq("key", "painter_status_rules");
  });

  for (const colour of ["new", "green", "yellow", "orange", "red"] as const) {
    test(`as a contractor on ${colour}: Home card and My status read the row, in words`, async ({ page }) => {
      await setStatus(contractorId, colour);
      await signIn(page, contractor!, /\/portal/);
      await home(page);
      const card = page.getByTestId("status-card");
      await expect(card).toHaveAttribute("data-colour", colour);
      const word = { new: "New", green: "Green", yellow: "Yellow", orange: "Orange", red: "Red" }[colour];
      await expect(card.getByTestId("status-word")).toHaveText(word);
      await expect(card.getByTestId("traffic-light")).toHaveAttribute("aria-label", `Traffic light showing ${word}`);
      if (colour === "green") {
        await expect(card).toContainText("Priority jobs");
        await expect(card.locator(".ststeps")).toHaveCount(0);
      } else {
        await expect(card.locator(".ststeps")).toHaveCount(1);
      }
      if (colour === "red") await expect(card).toContainText("No new job offers");

      await card.click();
      await expect(page).toHaveURL(/\/portal\/status/);
      const my = page.getByTestId("my-status");
      await expect(my).toHaveAttribute("data-colour", colour);
      await expect(my.getByTestId("status-word")).toHaveText(word);
      await expect(my.getByTestId("status-line")).toHaveText(PROFILES[colour].line);
      // Counts, never percentages (brief §7 wording).
      const m = PROFILES[colour].measures;
      await expect(my.getByTestId("measure-checks")).toContainText(`${m.checks.passedFirstTime} of ${m.checks.done} passed first time`);
      await expect(my.getByTestId("measure-reminders")).toContainText(`${m.reminders.answered} of ${m.reminders.scored} reminders answered`);
      await expect(my.getByTestId("measure-reminders")).not.toContainText("%");
      await expect(my.getByTestId("measure-callbacks")).toContainText(m.callbacks.scored === 0 ? "None" : `${m.callbacks.scored} call back`);
      // The dots: two resulted jobs, oldest left; tap the slip to see why.
      const dots = my.getByTestId("job-dots");
      await expect(dots.locator(".jd.ok")).toHaveCount(1);
      await expect(dots.locator(".jd.slip")).toHaveCount(1);
      if (colour === "new") await expect(dots.locator(".jd.todo")).toHaveCount(2);
      await dots.locator(".jd.slip").click();
      await expect(my.getByTestId("job-dot-detail")).toContainText("A call back for workmanship");
      await expect(my.getByTestId("job-dot-detail")).toContainText("small job");
      // What you get, and the counter with NO amount (R14).
      if (colour === "green") {
        await expect(my.getByTestId("streak")).toHaveText("6");
        await expect(my.getByTestId("bonus-counter")).toHaveText("3 of 4");
        await expect(my.getByTestId("perks")).toContainText("Priority on new jobs");
      } else {
        await expect(my.getByTestId("steps-to-green")).toHaveText(`${Math.min(PROFILES[colour].streak, 4)} of 4`);
        await expect(my.getByTestId("perks")).toContainText("Unlocks on Green");
      }
      await expect(my).not.toContainText("$");
      await expect(my.getByTestId("tips").locator("li")).toHaveCount(3);
      if (colour === "orange") await expect(my.getByTestId("tips")).toContainText("call you");
      if (colour === "red") await expect(my.getByTestId("tips")).toContainText("talked with us");
      // The word is on every screen that shows a lamp (R19).
      await expect(my.getByTestId("traffic-light")).toHaveAttribute("aria-label", `Traffic light showing ${word}`);
    });
  }

  test("the lamp pulses, and stops under reduced motion", async ({ page, browser }) => {
    await setStatus(contractorId, "green");
    await signIn(page, contractor!, /\/portal/);
    await home(page);
    const anim = () => page.getByTestId("traffic-light").locator(".lamp.on").evaluate((el) => getComputedStyle(el).animationName);
    expect(await anim()).toBe("pt-pulse");
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, storageState: await page.context().storageState() });
    const quiet = await ctx.newPage();
    await quiet.goto("/portal");
    await expect(quiet.getByTestId("status-card")).toBeVisible();
    expect(await quiet.getByTestId("traffic-light").locator(".lamp.on").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await ctx.close();
  });

  test("light theme: the status word uses the text-safe token, the lamp keeps the lamp colour", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await home(page);
    const darkWord = await page.getByTestId("status-card").getByTestId("status-word").evaluate((el) => getComputedStyle(el).color);
    const lamp = await page.getByTestId("traffic-light").locator(".lamp.on").evaluate((el) => getComputedStyle(el).getPropertyValue("--c").trim());
    await page.evaluate(() => { document.cookie = "crm_theme=light; path=/"; });
    await page.reload();
    await expect(page.locator(".pt")).toHaveAttribute("data-theme", "light");
    const lightWord = await page.getByTestId("status-card").getByTestId("status-word").evaluate((el) => getComputedStyle(el).color);
    expect(lightWord).not.toBe(darkWord);
    expect(await page.getByTestId("traffic-light").locator(".lamp.on").evaluate((el) => getComputedStyle(el).getPropertyValue("--c").trim())).toBe(lamp);
    await page.evaluate(() => { document.cookie = "crm_theme=dark; path=/"; });
  });

  test("an employed lead painter sees 'jobs you led' and no priority or payment line; a crew employee sees no status UI", async ({ page }) => {
    await signIn(page, lead, /\/portal/);
    await home(page);
    const card = page.getByTestId("status-card");
    await expect(card).toContainText("jobs you led");
    await expect(card).toContainText("Bonus eligible");
    await expect(card).not.toContainText("Priority");
    await page.goto("/portal/status");
    const my = page.getByTestId("my-status");
    await expect(my).toContainText("jobs you led");
    await expect(my.getByTestId("perks")).not.toContainText("Priority");
    await expect(my.getByTestId("perks")).not.toContainText("3 business days");
    await expect(my.getByTestId("perks")).toContainText("Bonus eligible");
    await expect(my).not.toContainText("$");
    await page.context().clearCookies();

    await signIn(page, crew, /\/portal/);
    await home(page);
    await expect(page.getByTestId("status-card")).toHaveCount(0);
    await expect(page.getByTestId("traffic-light")).toHaveCount(0);
    const res = await page.goto("/portal/status");
    expect(res?.status()).toBe(404);
  });

  test("the office switch off: no card for anyone and My status is a 404", async ({ page }) => {
    await db!.from("settings").update({ value: { ...savedRules, statusVisibleToPainters: false } }).eq("key", "painter_status_rules");
    try {
      await signIn(page, contractor!, /\/portal/);
      await home(page);
      await expect(page.getByTestId("status-card")).toHaveCount(0);
      const res = await page.goto("/portal/status");
      expect(res?.status()).toBe(404);
    } finally {
      await db!.from("settings").update({ value: { ...savedRules, statusVisibleToPainters: true } }).eq("key", "painter_status_rules");
    }
  });
});
