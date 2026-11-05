import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { MONEY_RANGE, driveMobileQuickLook, textedCodeFor } from "./drive";

/**
 * The gate's one-time code (Tom, 5 Nov 2026: "customers put in their mobile
 * number and they have to input the code to get the price"), as an ANONYMOUS
 * customer on a phone (390 × 780, touch).
 *
 *  1. Continue on the details screen texts a code and shows the code screen
 *     (masked mobile, no price anywhere); a wrong code is refused with the
 *     brief's words; the right code — read back from the recorded text, the
 *     test stack has no Twilio — shows the range.
 *  2. "Send it again" waits a minute (the server refuses a sooner resend with
 *     429 too_soon); "Wrong number? Change it" returns to the details with
 *     the answers kept, and a changed mobile gets its own code.
 *  3. At the API: the submit the browser made, replayed with a mobile that
 *     was never verified, is refused with 409 otp_required; the verified
 *     mobile is accepted again (it stays verified for the draft).
 */
const db = serviceClient();

test.describe("Wizard gate — the texted code", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });

  const run = randomBytes(3).toString("hex");
  const suburb = `E2E Otp ${run}`;
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
    await db.from("estimates").delete().ilike("title", `%${suburb}%`);
  });

  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  const freshMobile = () => `04${String(Date.now()).slice(-8)}`;

  /** The phone's screens to the details, the three fields filled, Continue tapped: the code screen. */
  const toCode = async (page: Page, name: string, mobile: string) => {
    await page.goto("/estimate");
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await driveMobileQuickLook(page, { suburb, bedrooms: 2, colour: "same", condition: "good" });
    await at(page, "details");
    await page.getByTestId("gate-name").fill(name);
    await page.getByTestId("gate-mobile").fill(mobile);
    await page.getByTestId("gate-email").fill(`otp.${run}.${Date.now()}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    await at(page, "code");
  };

  test("1 · the code screen, a wrong code refused, the texted code shows the range", async ({ page }) => {
    test.setTimeout(240_000);
    const mobile = freshMobile();
    await toCode(page, "Otp Tester", mobile);
    // the masked mobile, the six boxes; no price on this screen and no range behind it
    await expect(page.getByTestId("wzm-h1")).toContainText(`Enter the code we texted to ${mobile.slice(0, 4)}`);
    await expect(page.getByTestId("wzm-h1")).not.toContainText(mobile.slice(4, 7));
    await expect(page.getByTestId("gate-otp-input")).toBeVisible();
    await expect(page.getByTestId("wzm-gate")).toHaveCount(0);
    await expect(page.locator(".wzm")).not.toContainText(/\$\s?\d/);
    // the bar is the progress bar of every other screen: further along than the details
    const pct = Number(await page.locator(".wzm-bar").getAttribute("aria-valuenow"));
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(55);
    // a wrong code
    await page.getByTestId("gate-otp-input").fill("000000");
    await expect(page.getByTestId("gate-otp-error")).toContainText("That code didn't match — try again", { timeout: 20_000 });
    await expect(page.getByTestId("wzm-gate")).toHaveCount(0);
    // the right one, read back from the recorded text (the message carries the brand and the ten minutes)
    const { code, body } = await textedCodeFor(db!, mobile);
    expect(body).toMatch(/^Your Paint Group code is \d{6}\. It expires in 10 minutes\.$/);
    await page.getByTestId("gate-otp-input").fill(code);
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`submit failed: ${await bounced.first().innerText()}`);
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    // the code is consumed: one row for this mobile, verified, the plain code nowhere in it
    const { data: rows, error } = await db!.from("wizard_otp_codes").select("code_hash, consumed_at, attempts").eq("mobile", mobile);
    expect(error).toBeNull();
    expect(rows?.length).toBe(1);
    expect(rows?.[0]?.consumed_at).not.toBeNull();
    expect(rows?.[0]?.attempts).toBe(1);
    expect(rows?.[0]?.code_hash).not.toContain(code);
  });

  test("2 · Send it again waits a minute; Wrong number? Change it keeps the answers and a new mobile gets its own code", async ({ page }) => {
    test.setTimeout(240_000);
    const first = freshMobile();
    await toCode(page, "Otp Changer", first);
    // the resend is a countdown for the first minute; the server says the same (60 s between sends)
    const resend = page.getByTestId("gate-otp-resend");
    await expect(resend).toBeDisabled();
    await expect(resend).toContainText(/Send it again in \d+ s/);
    const tooSoon = await page.request.post("/api/wizard/otp/send", { data: { mobile: first } });
    expect(tooSoon.status(), await tooSoon.text()).toBe(429);
    expect((await tooSoon.json()).code).toBe("too_soon");
    // change the number: back to the details with the three fields as they were
    await page.getByTestId("gate-otp-change").tap();
    await at(page, "details");
    await expect(page.getByTestId("gate-name")).toHaveValue("Otp Changer");
    await expect(page.getByTestId("gate-mobile")).toHaveValue(first);
    const second = `0${String(Number(first.slice(1)) + 7)}`;
    await page.getByTestId("gate-mobile").fill(second);
    await page.getByTestId("ql-next").tap();
    await at(page, "code");
    await expect(page.getByTestId("wzm-h1")).toContainText(second.slice(0, 4));
    const { code } = await textedCodeFor(db!, second);
    await page.getByTestId("gate-otp-input").fill(code);
    await expect(page.getByTestId("wzm-gate")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    // the first number's code was never used; the second's was
    const { data: rows } = await db!.from("wizard_otp_codes").select("mobile, consumed_at").in("mobile", [first, second]);
    expect(rows?.find((r) => r.mobile === first)?.consumed_at).toBeNull();
    expect(rows?.find((r) => r.mobile === second)?.consumed_at).not.toBeNull();
  });

  test("3 · at the API: a submit whose mobile was never verified is refused (409 otp_required); the verified one is not", async ({ page }) => {
    test.setTimeout(240_000);
    const mobile = freshMobile();
    await toCode(page, "Otp Api", mobile);
    const { code } = await textedCodeFor(db!, mobile);
    const submitReq = page.waitForRequest((r) => r.url().includes("/api/wizard/submit") && r.method() === "POST");
    await page.getByTestId("gate-otp-input").fill(code);
    const posted = (await submitReq).postDataJSON() as { state: Record<string, unknown> & { contact: { name: string; email: string; phone: string } } };
    await expect(page.getByTestId("wzm-gate")).toBeVisible({ timeout: 90_000 });
    // the same answers with a mobile nobody verified: refused before any pricing
    const other = { ...posted.state, contact: { ...posted.state.contact, phone: `0${String(Number(mobile.slice(1)) + 11)}` } };
    const refused = await page.request.post("/api/wizard/submit", { data: { state: other } });
    expect(refused.status(), await refused.text()).toBe(409);
    expect((await refused.json()).code).toBe("otp_required");
    // the verified mobile stays verified for this draft: the same submit again is not refused for the code
    const again = await page.request.post("/api/wizard/submit", { data: { state: posted.state } });
    expect([200, 429], await again.text()).toContain(again.status());
    if (again.status() === 429) expect((await again.json()).code).not.toBe("otp_required");
    // a code is never accepted twice
    const reuse = await page.request.post("/api/wizard/otp/verify", { data: { mobile, code } });
    expect(reuse.status()).toBe(410);
  });
});
