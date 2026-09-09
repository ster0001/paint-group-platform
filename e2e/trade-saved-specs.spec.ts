import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { specFromState, flagsWithSpec } from "../lib/wizard/saved-specs";
import { defaultWizardState } from "../lib/wizard/state";

/**
 * Phase 8 (§7) — trade saved specs.
 *
 * A spec is the answers that repeat, applied to a NEW address: its rooms come
 * from that address, which is what makes it different from a rebook. This
 * drives the real link — /estimate?spec=<id> — and proves the wizard opens on
 * the spec's answers rather than the defaults.
 *
 * It builds its OWN trade org and member rather than borrowing the ambient
 * customer login, which is residential: the spec list is a trade surface, and
 * a test that quietly skipped on the wrong account type would prove nothing.
 */

const db: SupabaseClient | null = serviceClient();
const run = randomBytes(4).toString("hex");
const member = { email: `pg.e2e.spec.${run}@example.com`, id: "" };
const specId = `spec_${run}`;

test.describe("trade saved specs", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY (see .env.test.local)");

  let accountId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const created = await sb.auth.admin.createUser({ email: member.email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
    member.id = created.data.user.id;
    // /estimate only treats a signed-in user as a MEMBER when their profile
    // role is "customer" — that is what the real portal signup sets, and
    // without it ?spec= (like ?rebook=) is ignored and the wizard opens on
    // the defaults. A test that skipped this would silently prove nothing.
    const role = await sb.from("profiles").update({ role: "customer" }).eq("id", member.id);
    if (role.error) throw new Error(`profiles: ${role.error.message}`);

    const s = defaultWizardState();
    s.surfaces = ["walls", "ceilings"];
    s.condition = { ...s.condition, tier: "fresh" };
    s.details = { ...s.details, damageTier: 0, siteAccess: { cleared: "no" } };
    const spec = specFromState(s, `End-of-lease ${run}`, { id: specId });

    const acct = await sb.from("accounts").insert({
      email: member.email, name: `Spec Org ${run}`, account_type: "trade",
      flags: flagsWithSpec(null, spec),
    }).select("id").single();
    if (acct.error) throw new Error(`account: ${acct.error.message}`);
    accountId = acct.data.id as string;

    const link = await sb.from("account_users").insert({
      account_id: accountId, profile_id: member.id, role: "owner",
    });
    if (link.error) throw new Error(`account_users: ${link.error.message}`);
  });

  test.afterAll(async () => {
    const sb = db;
    if (!sb) return;
    if (accountId) {
      await sb.from("account_users").delete().eq("account_id", accountId);
      await sb.from("accounts").delete().eq("id", accountId);
    }
    if (member.id) await sb.auth.admin.deleteUser(member.id);
  });

  /**
   * The other half: a spec is MADE by naming a job the member already did.
   * Without this, specs can only be seeded by hand and the feature does not
   * exist for a real agent.
   */
  test("a member names one of their own jobs as a spec", async ({ page }) => {
    test.setTimeout(180_000);
    const sb = db!;

    // A finished job on this account, with answers worth keeping.
    const st = defaultWizardState();
    st.noPlan = true;
    st.basics = { bedrooms: 2, storeys: "single", sizeBand: "lt120", openPlanKitchenLiving: false };
    st.surfaces = ["walls", "ceilings", "doors"];
    const est = await sb.from("estimates").insert({
      // A non-draft estimate must carry a level of finish
      // (estimates_finish_required_when_sent — a smallint, not a modifier code),
      // and "sent" is what puts it in
      // the member's repeatable list.
      title: `Vacate job ${run}`, status: "sent", level_of_finish: 3,
      source: "manual", account_id: accountId,
      builder_state: {
        blocks: [], modSel: {}, materials: {},
        // `version` is what getRebookCandidates keys hasWizard on — without it
        // the job never reaches the member's repeatable list, and the
        // save-as-spec control has nothing to sit on. The submit route writes
        // exactly this shape.
        wizard: { version: 1, state: st, submittedAt: new Date().toISOString() },
      },
    }).select("id").single();
    if (est.error) throw new Error(`estimate: ${est.error.message}`);
    const estimateId = est.data.id as string;

    try {
      const link = await sb.auth.admin.generateLink({ type: "magiclink", email: member.email });
      await page.goto(`/account/auth?token_hash=${encodeURIComponent(link.data!.properties!.hashed_token)}`);
      await page.waitForURL(/\/account$/, { timeout: 30_000 });
      await page.goto("/account/new-estimate");

      await page.getByTestId(`save-spec-open-${estimateId}`).click();
      await page.getByTestId(`save-spec-name-${estimateId}`).fill(`Vacate touch-up ${run}`);
      await page.getByTestId(`save-spec-submit-${estimateId}`).click();
      await expect(page.getByTestId(`spec-saved-${estimateId}`)).toBeVisible({ timeout: 30_000 });

      // It is on the list, described by what it does — and it kept the job's
      // three surfaces, not the wizard's default six.
      await page.reload();
      await expect(page.getByText(`Vacate touch-up ${run}`)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("3 surfaces · new colours · some wear")).toBeVisible();
    } finally {
      await sb.from("estimates").delete().eq("id", estimateId);
    }
  });

  test("a spec opens the wizard on its answers, not the defaults", async ({ page }) => {
    test.setTimeout(180_000);

    // The portal is passwordless by design (⚑3), so a browser test signs in
    // the way _look-portal does: a real magic link, redeemed on /account/auth.
    const link = await db!.auth.admin.generateLink({ type: "magiclink", email: member.email });
    const hash = link.data?.properties?.hashed_token;
    expect(hash, "magic link").toBeTruthy();
    await page.goto(`/account/auth?token_hash=${encodeURIComponent(hash!)}`);
    await page.waitForURL(/\/account$/, { timeout: 30_000 });

    // The spec is offered where a trade account starts a job.
    await page.goto("/account/new-estimate");
    await expect(page.getByText(`End-of-lease ${run}`)).toBeVisible({ timeout: 30_000 });
    // Its one-line summary says what it does, without a price.
    await expect(page.getByText("2 surfaces · same colours · good")).toBeVisible();
    await page.getByTestId(`use-spec-${specId}`).click();

    // The wizard opens on the spec's surfaces — walls and ceilings, and NOT
    // the default full set, which also ticks skirting, doors and architraves.
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
    // Page 1 the way drive.ts drives it: the property kind, then the no-plan
    // route. Continue refuses (a .wz-err) if either is missing, and a test
    // that ignored that sat on page 1 believing the prefill had failed.
    // A spec carries no address — that is the point of it — so the member
    // still says where. (drive.ts fills these for the anonymous walk too.)
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    const kind = page.locator(".wz-qhead", { hasText: "What kind of property" })
      .locator("xpath=following-sibling::div[1]")
      .getByRole("button", { name: "House", exact: true });
    if (await kind.count()) await kind.first().click();
    await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
    await page.getByRole("button", { name: /Continue/ }).first().click();
    const err = page.locator(".wz-err");
    if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
    // The surface tiles carry their state in a class, not aria-pressed.
    const ticked = page.locator(".wz-tile.on");
    await expect(ticked.filter({ hasText: "Walls" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(ticked.filter({ hasText: "Ceilings" }).first()).toBeVisible();
    // The default full repaint also ticks these; the spec must have taken them off.
    await expect(ticked.filter({ hasText: "Skirting" })).toHaveCount(0);
    await expect(ticked.filter({ hasText: "Doors" })).toHaveCount(0);
  });
});
