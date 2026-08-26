import { test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./fixtures/woLoop";

/** Screenshot rig for the 3a-2 shell — not part of any gate. Run with:
 *  npx playwright test _look-portal  (needs SUPABASE_SERVICE_ROLE_KEY) */

const db: SupabaseClient | null = serviceClient();
const SHOTS = "test-results/look-portal";

test.describe("portal look", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");

  const email = `pg.e2e.look.${Date.now().toString(36)}@example.com`;
  let estimateId = "";
  let accountId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const acct = await sb.from("accounts").insert({ email, name: "Margaret Attwood" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id;
    const est = await sb.from("estimates").insert({
      title: "12 Acacia Street", status: "draft", account_id: accountId,
      builder_state: { blocks: [] },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id;
  });

  test.afterAll(async () => {
    const sb = db!;
    if (estimateId) await sb.from("estimates").delete().eq("id", estimateId);
    if (accountId) {
      await sb.from("account_users").delete().eq("account_id", accountId);
      await sb.from("accounts").delete().eq("id", accountId);
    }
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
    const u = data?.users?.find((x) => (x.email ?? "") === email);
    if (u) await sb.auth.admin.deleteUser(u.id);
  });

  test("phone + desktop shots", async ({ page }) => {
    const sb = db!;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/account/login");
    await page.screenshot({ path: `${SHOTS}/phone-login.png`, fullPage: true });

    await sb.auth.admin.createUser({ email });
    const link = await sb.auth.admin.generateLink({ type: "magiclink", email });
    await page.goto(`/account/auth?token_hash=${encodeURIComponent(link.data!.properties!.hashed_token)}`);
    await page.waitForURL(/\/account$/);
    await page.screenshot({ path: `${SHOTS}/phone-home.png`, fullPage: true });

    await page.goto("/account/colours");
    await page.screenshot({ path: `${SHOTS}/phone-colours.png`, fullPage: true });

    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto("/account");
    await page.screenshot({ path: `${SHOTS}/desktop-home.png` });
  });
});
