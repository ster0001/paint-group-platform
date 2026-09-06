import { test, expect } from "@playwright/test";
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

async function member(sb: SupabaseClient, email: string, type: "trade" | "residential") {
  const acct = await sb.from("accounts").insert({ email, name: type === "trade" ? "Trade Client" : "Res Client", account_type: type }).select("id").single();
  if (acct.error) throw new Error(acct.error.message);
  return acct.data.id as string;
}

/** Answer chips by key; the assumption chip taps ask the question first. */


test.describe("Addendum A2 — describe the job", () => {
  test.skip(!db, "service key needed");
  const run = randomBytes(4).toString("hex");
  const emails = { trade: `pg.e2e.trade.${run}@example.com`, res: `pg.e2e.res.${run}@example.com` };
  test.afterAll(async () => { if (!db) return; for (const e of Object.values(emails)) { await destroyAccountChain(db, e); await deleteUserByEmail(db, e); } });

  // Tom, 7 Sep: a described job lands STRAIGHT in the editor — one request
  // builds the whole estimate, every assumption marked; the chat is only the
  // fallback when the paragraph was not enough to build from.
  for (const [who, type] of [["trade", "trade"], ["residential", "residential"]] as const) {
    test(`${who}: the paragraph builds the estimate in one go and lands in the editor with the assumptions marked`, async ({ page }) => {
      test.setTimeout(600_000);
      const sb = db!;
      const email = type === "trade" ? emails.trade : emails.res;
      await member(sb, email, type);
      await page.goto(await magicLinkFor(sb, email));
      await page.goto("/estimate");
      await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
      await page.getByPlaceholder("Suburb").fill("Murrumbeena");
      await page.getByPlaceholder("Postcode").fill("3163");
      await page.getByTestId("entry-describe").click();
      await page.getByTestId("describe-job").fill(TOM);
      // Tom, 7 Sep: the contact details are still the last question, then the build.
      await page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
      const contact = page.locator(".wz-crow input");
      if (await contact.count()) {
        await contact.nth(0).fill("E2E Describe");
        if (!(await contact.nth(1).inputValue())) await contact.nth(1).fill(email);
        await contact.nth(2).fill("0400 000 111");
        await page.getByRole("button", { name: "See my estimate" }).click();
      }
      await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 120_000 });
      // The editor: a range, the rooms the paragraph named, and the open assumptions as amber lines.
      await expect(page.locator(".sc-r").first()).toHaveText(MONEY, { timeout: 30_000 });
      const names = await page.locator('[data-card^="room:"] .sc-hd').allInnerTexts();
      expect(names.length).toBeGreaterThanOrEqual(3);
      await expect(page.locator(".wz-confirmonsite")).toBeVisible();
      // The details card is where the assumed styles get settled.
      await expect(page.getByTestId("details-card")).toBeVisible();
      const { data: est } = await sb.from("estimates").select("id, source").eq("id", new URL(page.url()).searchParams.get("id")!).single();
      expect(est?.source).toBe("customer_intake");
    });
  }
});
