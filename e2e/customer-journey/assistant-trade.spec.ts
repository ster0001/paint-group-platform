import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor } from "../fixtures/portal";

/**
 * Addendum A2 — "Describe the job" (C1 stack, AGENT_MODEL_STUB=1).
 *   trade:       paste the paragraph → range at once (wide band) → answer 4
 *                tightening chips → attach 1 photo → sweep → band narrows → CTA
 *   residential: same paragraph → chips but no number until the sweep is done
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db: SupabaseClient | null = url && key ? createClient(url, key) : null;
const MONEY = /\$[\d,]+\s*–\s*\$[\d,]+/;
const TOM = "3 bedroom 1 bathroom house requires painting with a colour match throughout. The walls are in good condition with a few minor cracks to the kitchen area, all trims including windows, doors, frames and skirtings to be painted.";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function member(sb: SupabaseClient, email: string, type: "trade" | "residential") {
  const acct = await sb.from("accounts").insert({ email, name: type === "trade" ? "Trade Client" : "Res Client", account_type: type }).select("id").single();
  if (acct.error) throw new Error(acct.error.message);
  return acct.data.id as string;
}

/** Answer chips by key; the assumption chip taps ask the question first. */
async function answerChips(page: Page, keys: string[]) {
  for (const key of keys) {
    const chip = page.locator(`[data-testid="as-chip"][data-key="${key}"]`).first();
    if (!(await chip.count())) continue;
    await chip.click();
    const chips = page.getByTestId("as-chips");
    await expect(chips).toHaveAttribute("data-gap", key, { timeout: 20_000 });
    const click = (name: string) => chips.getByRole("button", { name, exact: true }).first().click();
    if (key === "door_style") await click("Flat");
    else if (key === "window_style") await click("Casement");
    else if (key === "ceiling_height") await click("2.4 m");
    else if (key === "q.property_flags") { for (const f of ["builtPre1970", "heritageListed", "bodyCorporate", "asbestosSuspected"]) await chips.locator(`[data-flag="${f}"]`).getByRole("button", { name: "No", exact: true }).click(); await click("Done"); }
    await expect(page.locator(".as-typing")).toHaveCount(0, { timeout: 60_000 });
  }
}

async function driveLoop(page: Page, stopWhen: () => Promise<boolean>) {
  for (let i = 0; i < 120; i++) {
    if (await stopWhen()) return;
    const chips = page.getByTestId("as-chips");
    if (!(await chips.count())) { await page.waitForTimeout(500); continue; }
    const key = (await chips.getAttribute("data-gap")) ?? "";
    const click = (name: string) => chips.getByRole("button", { name, exact: true }).first().click();
    if (/\.size$/.test(key)) await click("Looks right");
    else if (/cupboard_interiors$/.test(key) || /cupboards$/.test(key)) await click("No");
    else if (/anything_else$/.test(key)) await click("Nothing else");
    else if (/\.surfaces$/.test(key)) await click("Looks right");
    else if (/\.confirm$/.test(key)) await click("Confirm");
    else if (/dw_totals$/.test(key)) await click("Yes, that's right");
    else if (/missed_rooms$/.test(key)) await click("Nothing missed");
    else if (key === "occupied") await click("No, it'll be empty");
    else if (key === "paint.brand") { await click("Dulux"); await click("Done"); }
    else if (key === "paint.colours") await click("Match what's there / advice");
    else if (key === "door_style") await click("Flat");
    else if (key === "window_style") await click("Casement");
    else if (key === "ceiling_height") await click("2.4 m");
    else if (key === "q.timing") await click("Soon");
    else if (key === "q.property_flags") { for (const f of ["builtPre1970", "heritageListed", "bodyCorporate", "asbestosSuspected"]) await chips.locator(`[data-flag="${f}"]`).getByRole("button", { name: "No", exact: true }).click(); await click("Done"); }
    else if (key === "surfaces.ceilings") await click("Leave them out");
    // The photo ask ranks last; the chat's own control stages, keeps and claims the photo.
    else if (/\.photos$/.test(key)) { await page.getByTestId("as-photo").setInputFiles({ name: "crack.png", mimeType: "image/png", buffer: PNG }); await expect(page.getByTestId("as-photo")).toHaveCount(0, { timeout: 30_000 }); }
    else if (/\.presence$/.test(key)) await click("Keep it");
    else throw new Error(`no scripted answer for ${key}`);
    await expect(page.locator(".as-typing")).toHaveCount(0, { timeout: 60_000 });
  }
}

test.describe("Addendum A2 — describe the job", () => {
  test.skip(!db, "service key needed");
  const run = randomBytes(4).toString("hex");
  const emails = { trade: `pg.e2e.trade.${run}@example.com`, res: `pg.e2e.res.${run}@example.com` };
  test.afterAll(async () => { if (!db) return; for (const e of Object.values(emails)) { await destroyAccountChain(db, e); await deleteUserByEmail(db, e); } });

  test("trade: the paragraph prices at once; four answers, a photo and the sweep narrow the band to the CTA", async ({ page }) => {
    test.setTimeout(420_000);
    const sb = db!;
    await member(sb, emails.trade, "trade");
    await page.goto(await magicLinkFor(sb, emails.trade));
    await page.goto("/estimate");
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    await page.getByTestId("describe-job").fill(TOM);
    await expect(page.getByTestId("build-from-brief")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("build-from-brief").click();
    await expect(page).toHaveURL(/\/estimate\/assist\?c=/, { timeout: 90_000 });

    // The range, at once, wide, with the honest list of chips.
    const range = page.getByTestId("as-range");
    await expect(range).toHaveAttribute("data-shown", "1", { timeout: 30_000 });
    await expect(range).toContainText(MONEY);
    await expect(page.getByTestId("as-band")).toHaveText("±15%");
    const chipsBefore = await page.getByTestId("as-chip").count();
    expect(chipsBefore).toBeGreaterThanOrEqual(4);
    for (const label of ["Ceilings not included", "flat doors", "cupboard interiors"]) await expect(page.getByTestId("as-assumptions")).toContainText(label);

    // Four tightening chips, tapped and answered.
    await answerChips(page, ["door_style", "window_style", "ceiling_height", "q.property_flags"]);
    expect(await page.getByTestId("as-chip").count()).toBeLessThan(chipsBefore);

    const { data: conv } = await sb.from("agent_conversations").select("estimate_id").eq("id", new URL(page.url()).searchParams.get("c")!).single();
    const estimateId = conv!.estimate_id as string;

    // The sweep: confirm everything; the band narrows and the CTA appears.
    // The accept button appears as soon as only the photo ask is left (it never
    // blocks); keep driving until the photo has gone through and no chip remains.
    await driveLoop(page, async () => (await page.getByTestId("as-cta").count()) > 0 && (await page.getByTestId("as-chips").count()) === 0 && (await page.getByTestId("as-photo").count()) === 0);
    await expect(page.getByTestId("as-cta")).toBeVisible();
    await expect(page.getByTestId("as-cta")).toHaveText(/Accept estimate|Confirm my price/);
    const band = await page.getByTestId("as-band").innerText();
    expect(["±4%", "±8%"]).toContain(band.trim());
    // The photo was kept AND claimed for this estimate (not left with estimate_id null).
    const { count } = await sb.from("estimate_sources").select("id", { count: "exact", head: true }).eq("estimate_id", estimateId).eq("kind", "defect_photo");
    expect(count).toBe(1);
  });

  test("residential: same paragraph — chips, but no number until the sweep is done", async ({ page }) => {
    test.setTimeout(420_000);
    const sb = db!;
    await member(sb, emails.res, "residential");
    await page.goto(await magicLinkFor(sb, emails.res));
    await page.goto("/estimate");
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    await page.getByTestId("describe-job").fill(TOM);
    await expect(page.getByTestId("build-from-brief")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("build-from-brief").click();
    await expect(page).toHaveURL(/\/estimate\/assist\?c=/, { timeout: 90_000 });
    const range = page.getByTestId("as-range");
    await expect(page.getByTestId("as-assumptions")).toBeVisible({ timeout: 30_000 });
    await expect(range).toHaveAttribute("data-shown", "0");
    await expect(range).not.toContainText(MONEY);
    await driveLoop(page, async () => (await range.getAttribute("data-shown")) === "1");
    await expect(range).toHaveAttribute("data-shown", "1");
    await expect(range).toContainText(MONEY);
  });
});
