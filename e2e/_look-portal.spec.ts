import { test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./fixtures/woLoop";
import { deleteUserByEmail, destroyAccountChain } from "./fixtures/portal";

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
      title: "12 Acacia Street", status: "accepted", level_of_finish: 3,
      account_id: accountId, accepted_total_cents: 845_000,
      builder_state: { blocks: [] },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id;

    const inv = await sb.from("invoices").insert({
      estimate_id: estimateId, kind: "deposit", status: "paid",
      number: `INV-LOOK${Date.now() % 1e6}`, token: `look${Date.now().toString(36)}`,
      subtotal_ex_cents: 230_455, gst_cents: 23_045, total_inc_cents: 253_500,
      issued_on: "2026-08-13", due_on: "2026-08-20",
    }).select("id").single();
    if (!inv.error) {
      await sb.from("payments").insert({
        invoice_id: inv.data.id, amount_cents: 253_500, status: "succeeded",
        method: "bank_transfer", paid_on: "2026-08-14", receipt_number: `RCT-LOOK${Date.now() % 1e6}`,
      });
    }
  });

  test.afterAll(async () => {
    const sb = db!;
    await destroyAccountChain(sb, email);
    await deleteUserByEmail(sb, email);
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

    await page.goto("/account/money");
    await page.screenshot({ path: `${SHOTS}/phone-money.png`, fullPage: true });

    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto("/account");
    await page.screenshot({ path: `${SHOTS}/desktop-home.png` });
  });
});
