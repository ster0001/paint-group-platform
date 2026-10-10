import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { authUserIdByEmail, credentials, missingCreds, signIn, test } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 11 Oct 2026: Settings → Trade accounts → "Create a trade account" for
 * info@modvs.com with his own mobile turned an EXISTING customer account
 * (tjhroman+crm.ashwood@…, same phone) into the trade organisation — renamed
 * it and made the new login its owner. ensureAccount matches by email OR
 * phone; a trade login is keyed by its email only. A phone shared with
 * someone else's account must never hand that account over.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

test.describe("Settings → Trade accounts → create", () => {
  test.skip(!staff || !db, missingCreds("STAFF") + " + service key");
  test.use({ viewport: { width: 1280, height: 900 } });

  const run = randomBytes(3).toString("hex");
  // A 04xx number unique to this run, so no other row on the project shares it.
  const phone = `04${String(Number.parseInt(run, 16) % 100_000_000).padStart(8, "0")}`;
  const existingEmail = `pg.e2e.tc.existing.${run}@example.com`;
  const tradeEmail = `pg.e2e.tc.trade.${run}@example.com`;
  let existingId = "";

  test.beforeAll(async () => {
    const ins = await db!.from("accounts")
      .insert({ email: existingEmail, name: `Existing Customer ${run}`, phone })
      .select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    existingId = ins.data.id;
  });

  test.afterAll(async () => {
    const sb = db!;
    const { data: accts, error } = await sb.from("accounts").select("id").in("email", [existingEmail, tradeEmail]);
    if (error) throw new Error(error.message);
    const ids = [...new Set([existingId, ...(accts ?? []).map((a) => a.id as string)].filter(Boolean))];
    if (ids.length) {
      await sb.from("account_users").delete().in("account_id", ids);
      await sb.from("accounts").delete().in("id", ids);
    }
    const uid = await authUserIdByEmail(sb, tradeEmail);
    if (uid) await sb.auth.admin.deleteUser(uid);
  });

  test("a new email with a phone already on file makes a NEW trade account and leaves the other one alone", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/settings#trade-accounts");
    const form = page.locator("form").filter({ hasText: "Create a trade account" });
    await expect(form).toBeVisible({ timeout: 20_000 });
    // The customer-chat dock opens itself when a chat is waiting (C1 keeps a
    // few from the chat specs) and sits over the form's button.
    const dock = page.getByTestId("staff-dock");
    if (await dock.getAttribute("data-open") === "1") {
      await dock.getByTestId("dock-minimise").first().click();
      await expect(dock).toHaveAttribute("data-open", "0");
    }
    await form.locator('input[name="email"]').fill(tradeEmail);
    await form.locator('input[name="name"]').fill(`Demo Agency ${run}`);
    await form.locator('input[name="phone"]').fill(phone);
    await form.locator('input[name="password"]').fill("painttest123");
    await form.getByRole("button", { name: "Create trade account" }).click();
    await expect(form.getByText(`Done — ${tradeEmail} can sign in`)).toBeVisible({ timeout: 20_000 });

    const sb = db!;
    // The customer already on file is exactly as it was.
    const before = await sb.from("accounts").select("email, name, account_type").eq("id", existingId).single();
    expect(before.error).toBeNull();
    expect(before.data).toEqual({ email: existingEmail, name: `Existing Customer ${run}`, account_type: "residential" });
    const theirSeats = await sb.from("account_users").select("id").eq("account_id", existingId);
    expect(theirSeats.error).toBeNull();
    expect(theirSeats.data).toEqual([]);

    // The trade organisation is its own account, owned by the new login.
    const trade = await sb.from("accounts").select("id, name, account_type, phone").eq("email", tradeEmail).single();
    expect(trade.error).toBeNull();
    expect(trade.data?.account_type).toBe("trade");
    expect(trade.data?.name).toBe(`Demo Agency ${run}`);
    const uid = await authUserIdByEmail(sb, tradeEmail);
    const seat = await sb.from("account_users").select("role").eq("account_id", trade.data!.id).eq("profile_id", uid!).single();
    expect(seat.error).toBeNull();
    expect(seat.data?.role).toBe("owner");
  });
});
