import { expect, type Locator, type Page } from "@playwright/test";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export type Credentials = { email: string; password: string };

/** Reads a login from the environment. Null when it isn't configured. */
export type Who = "CONTRACTOR" | "STAFF" | "CUSTOMER";

export function credentials(who: Who): Credentials | null {
  const email = process.env[`E2E_${who}_EMAIL`];
  const password = process.env[`E2E_${who}_PASSWORD`];
  return email && password ? { email, password } : null;
}

export const missingCreds = (who: Who) =>
  `set E2E_${who}_EMAIL and E2E_${who}_PASSWORD to run this`;

/**
 * Sign in through the real form. Deliberately not a cookie-injection shortcut:
 * login and role routing are themselves part of what these tests cover.
 */
export async function signIn(page: Page, creds: Credentials, expectPath: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(expectPath, { timeout: 20_000 });
}

/**
 * The auth user id behind an e2e login. `auth.admin.listUsers` is paged and
 * C1 carries thousands of anon wizard sessions, so paging to find one staff
 * login stopped working (10 Sep); signing the credentials in through the
 * anon client answers directly.
 */
export async function userIdFor(creds: Credentials): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const sb = createSupabaseClient(url, key, { auth: { persistSession: false } });
  const { data } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password });
  const id = data.user?.id ?? null;
  await sb.auth.signOut().catch(() => {});
  return id;
}

export async function signOutIfPossible(page: Page) {
  const button = page.getByRole("button", { name: /sign out/i });
  if (await button.count()) await button.first().click();
}

/**
 * Draw a squiggle on the shared SignaturePad. The pad emits its PNG on
 * pointer-up, so the mouse.up() is the moment the form receives the signature.
 */
export async function drawSignature(page: Page) {
  const canvas = page.getByTestId("signature-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("signature canvas has no bounding box");
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 100, { steps: 6 });
  await page.mouse.move(box.x + 150, box.y + 40, { steps: 6 });
  await page.mouse.move(box.x + 210, box.y + 90, { steps: 6 });
  await page.mouse.up();
}

/**
 * The smallest PNG data URL the signing RPC accepts — for headless rpcAs
 * flows where nothing draws on a real canvas.
 */
export const TINY_SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Tom, 17 Sep 2026: the CRM's date boxes open a mini calendar
 * (app/crm/DateField.tsx) instead of the browser's date input, so a spec
 * picks a day by clicking it. `testId` is the DateField's testId; `day` is
 * `YYYY-MM-DD`. Steps the month view to the target, then clicks the day.
 */
export async function pickDay(page: Page, testId: string, day: string) {
  const field = page.getByTestId(testId);
  const button = page.getByTestId(`${testId}-button`);
  await button.click();
  const cal = page.getByTestId(`${testId}-calendar`);
  await cal.waitFor({ state: "visible" });
  const current = (await button.getAttribute("data-value")) || new Date().toLocaleDateString("en-CA");
  const months = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
  let delta = months(day) - months(current);
  while (delta > 0) { await cal.getByLabel("Next month").click(); delta -= 1; }
  while (delta < 0) { await cal.getByLabel("Previous month").click(); delta += 1; }
  await cal.locator(`[data-day="${day}"]`).click();
  await field.getByTestId(`${testId}-calendar`).waitFor({ state: "hidden" }).catch(() => undefined);
}

/**
 * Open the CRM Today queue and walk its pages (50 a page, bucket order) until
 * `target` is on one — the test project's Today runs to ten pages of leaked
 * e2e items, so "the card is on page 1" was never the assertion; "the card is
 * in the queue" is. Resolves to the page number it was found on, or 0 when
 * the last page was reached without it (assert on the locator after, so the
 * failure names the card). `url` is the Today URL with its filters.
 */
export async function gotoTodayWith(page: Page, url: string, target: Locator, maxPages = 12): Promise<number> {
  const u = new URL(url, "http://x");
  for (let p = 1; p <= maxPages; p++) {
    u.searchParams.set("page", String(p));
    await page.goto(u.pathname + u.search);
    await expect(page.getByTestId("who-chips")).toBeVisible({ timeout: 30_000 });
    if (await target.count()) return p;
    if (!(await page.getByRole("link", { name: /older/i }).count())) return 0;
  }
  return 0;
}
