import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";
import { KNOWN_MONEY_KEYS } from "../lib/painters/money";

/**
 * An employed painter reads the EMPLOYEE manual, and its pictures load.
 *
 * Tom, 19 Sep, with a photo of Saulius's phone: "none of the walkthrough gif
 * videos work on mobile in the contractor portal". Not mobile, and not the
 * films: `/portal/help/[feature]` asked for the CONTRACTOR file whoever was
 * reading, while `/api/help/media` resolved the reader's REAL role. So an
 * employee was handed the contractor guide and then refused its pictures —
 * a broken "Walkthrough" icon on every guide that has a film.
 *
 * The broken image was the visible half. The other half was the content: the
 * contractor scheduling guide opens "Each offer comes with the dates, the
 * calculated labour hours, YOUR PRICE and a 24-hour clock", and an employee
 * never sees a figure (brief §3.1, the money contract).
 *
 * So this spec asserts both, as a real employee: the guide is theirs, every
 * image on it actually loads, and no money word survives anywhere.
 */

type Entry = { feature: string; role: string; title: string; summary: string; walkthrough: string | null };
const index = JSON.parse(readFileSync("docs/help/_index.json", "utf8")) as { files: Entry[] };
const employeeGuides = index.files.filter((e) => e.role === "employee");
const contractorOnly = index.files.filter(
  (e) => e.role === "contractor" && !index.files.some((f) => f.role === "employee" && f.feature === e.feature),
);
/** A contractor guide that carries a film — the exact shape that broke. */
const filmed = index.files.filter((e) => e.role === "contractor" && e.walkthrough);

const db: SupabaseClient | null = serviceClient();
const run = Date.now().toString(36);
const employee = { email: `pg.e2e.help.${run}@example.com`, password: `Help-${run}-pw!` };
let userId: string | null = null;
let contractorId: string | null = null;

test.describe("help in the portal — an employee reads their own manual", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the employee account");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const created = await db!.auth.admin.createUser({
      email: employee.email, password: employee.password, email_confirm: true,
      user_metadata: { name: "E2E Help Employee" },
    });
    if (created.error || !created.data.user) throw new Error(`create employee: ${created.error?.message}`);
    userId = created.data.user.id;
    const role = await db!.from("profiles").update({ role: "contractor", name: "E2E Help Employee" }).eq("id", userId);
    if (role.error) throw new Error(role.error.message);
    const c = await db!.from("contractors")
      .insert({ profile_id: userId, tier: "B", active: true, company_name: "", employment_type: "employee" })
      .select("id").single();
    if (c.error) throw new Error(c.error.message);
    contractorId = (c.data as { id: string }).id;
  });

  test.afterAll(async () => {
    if (contractorId) {
      const r = await db!.from("contractors").delete().eq("id", contractorId);
      if (r.error) throw new Error(`teardown contractor: ${r.error.message}`);
    }
    if (userId) {
      const r = await db!.auth.admin.deleteUser(userId);
      if (r.error) throw new Error(`teardown user: ${r.error.message}`);
    }
  });

  test("the list is the employee's guides, and a contractor-only guide is not found", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    await page.goto("/portal/help");
    for (const g of employeeGuides) await expect(page.getByTestId(`help-${g.feature}`)).toBeVisible();
    // No tour about offers, prices and progress claims.
    await expect(page.getByTestId("tour-replay")).toHaveCount(0);

    for (const g of contractorOnly) {
      const res = await page.goto(`/portal/help/${g.feature}`);
      expect(res?.status(), `${g.feature} is a contractor guide and must 404 for an employee`).toBe(404);
    }
  });

  test("every picture on every employee guide actually loads — no broken Walkthrough icon", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    for (const g of employeeGuides) {
      await page.goto(`/portal/help/${g.feature}`);
      await page.waitForLoadState("networkidle");
      // Walk the page so lazy images below the fold are asked for.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 50));
        }
      });
      const broken = await page.evaluate(() =>
        [...document.querySelectorAll("img")]
          .filter((i) => !(i.complete && i.naturalWidth > 0))
          .map((i) => i.getAttribute("src") ?? "(no src)"));
      expect(broken, `${g.feature}: images that did not load`).toEqual([]);
    }
  });

  test("a contractor's film still loads for a contractor — the fix did not close the door on them", async ({ page, browser }) => {
    test.skip(filmed.length === 0, "no contractor guide carries a film");
    // The employee is refused it…
    await signIn(page, employee, /\/portal/);
    const asEmployee = await page.request.get(
      `/api/help/media/${filmed[0].feature}/${filmed[0].walkthrough!.replace(/^media\//, "")}`);
    expect(asEmployee.status(), "a contractor film is not an employee's to read").toBe(404);

    // …and the contractor still gets it. Their own context, their own session.
    const ctx = await browser.newContext();
    const theirs = await ctx.newPage();
    const contractor = { email: process.env.E2E_CONTRACTOR_EMAIL ?? "", password: process.env.E2E_CONTRACTOR_PASSWORD ?? "" };
    test.skip(!contractor.email, "set E2E_CONTRACTOR_EMAIL to check the contractor half");
    await signIn(theirs, contractor, /\/portal/);
    await theirs.goto(`/portal/help/${filmed[0].feature}`);
    await expect(theirs.getByTestId("help-film")).toBeVisible();
    const film = await theirs.evaluate(() => {
      const i = document.querySelector('[data-testid="help-film"] img') as HTMLImageElement | null;
      return i ? { src: i.getAttribute("src"), loaded: i.complete && i.naturalWidth > 0 } : null;
    });
    expect(film?.loaded, `the contractor's film ${film?.src} must still load`).toBe(true);
    await ctx.close();
  });

  /**
   * The money contract is about what a painter is PAID — an offer amount,
   * their price, a rate, an invoice total (brief §3.1, `KNOWN_MONEY_KEYS`).
   * It is NOT a blanket ban on the "$" character: the employee expenses guide
   * has to say that anything over $100 needs asking first, which is their own
   * rule and the whole point of the tab. So this asserts the pay words and the
   * pay keys, and deliberately leaves a threshold alone.
   */
  test("no pay money reaches an employee through help — not a key, not their price", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    for (const path of ["/portal/help", ...employeeGuides.map((g) => `/portal/help/${g.feature}`)]) {
      const res = await page.goto(path);
      const html = (await res?.text()) ?? "";
      for (const key of KNOWN_MONEY_KEYS) expect(html, `${path} leaked ${key}`).not.toContain(key);
      const text = await page.locator("body").innerText();
      expect(text, `${path} talks about their price`)
        .not.toMatch(/your price|progress claim|self-invoice|RCTI|your rate|per hour|\/\s?hr\b/i);
      // A figure attached to pay, rather than the expenses threshold.
      expect(text, `${path} shows a pay figure`).not.toMatch(/\$\s?[\d,]+(\.\d\d)?\s*(for the job|for this job|paid to you|your)/i);
    }
  });
});
