import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient, createLoopFixture, destroyLoopFixture, type LoopFixture } from "./fixtures/woLoop";
import { deleteUserByEmail, magicLinkFor, openMagicLink } from "./fixtures/portal";
import { TINY_SIGNATURE_PNG } from "./helpers";

/**
 * Portal photos, every day of the job (27 Oct 2026 — Chris, Rose Street:
 * "I can't see the photos in my portal").
 *
 * Two things hid a customer's photos:
 *  1. The timeline signed at most 12 thumbnails per page and fetched at most
 *     40 photo rows, so on a job with more than three days of photos every
 *     older day rendered a "Photos from the site" card with NOTHING in it.
 *  2. Until the portal UX pass (PR #395, 26 Oct) a customer with a second
 *     address could not reach its job at all; its project switcher (D1,
 *     `?project=<work order id>`) is exercised here with two addresses so
 *     the Rose Street job is the one under test, not the account's first.
 *
 * What must hold: every photo card carries its photos (thumbnails are
 * minted on demand, so the count is not capped), and the thumbnail route
 * still hands out renditions only (never the original, never a qa-kind
 * photo).
 */

const db: SupabaseClient | null = serviceClient();

test.describe("portal photos — every day, every property", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the portal photo suite");

  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.rosephotos.${run}@example.com`;
  const painterEmail = `pg.e2e.painter.rose.${run}@example.com`;
  let rose: LoopFixture | null = null;
  let elm: LoopFixture | null = null;
  let accountId = "";
  let rosePropertyId = "";
  let elmPropertyId = "";
  let contractorId = "";
  let painterUserId = "";
  let qaPhotoId = "";
  const photoPaths: string[] = [];
  const PHOTO_DAYS = 5;
  const PER_DAY = 4;

  test.beforeAll(async () => {
    const sb = db!;

    const painter = await sb.auth.admin.createUser({
      email: painterEmail, password: "painttest123", email_confirm: true,
      user_metadata: { name: "Marco Rose" },
    });
    if (painter.error) throw new Error(painter.error.message);
    painterUserId = painter.data.user!.id;
    const c = await sb.from("contractors").insert({ profile_id: painterUserId, active: true }).select("id").single();
    if (c.error) throw new Error(`contractor fixture: ${c.error.message}`);
    contractorId = c.data.id;

    const acct = await sb.from("accounts").insert({ email, name: "Chris Rose" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id;

    const property = async (address: string) => {
      const p = await sb.from("properties").insert({
        account_id: accountId, address, suburb: "Fitzroy", postcode: "3065",
        address_norm: `${address.toLowerCase()} fitzroy 3065 ${run}`,
      }).select("id").single();
      if (p.error) throw new Error(`property: ${p.error.message}`);
      return p.data.id as string;
    };
    rosePropertyId = await property("8 Rose Street");
    elmPropertyId = await property("22 Elm Street");

    // Two jobs on the one account. Elm is the "current" one by stage order;
    // Rose is the one Chris actually asked about.
    rose = await createLoopFixture(sb, contractorId, [{ heading: "Front rooms", labels: ["Walls", "Ceiling"] }]);
    elm = await createLoopFixture(sb, contractorId, [{ heading: "Kitchen", labels: ["Walls"] }]);
    for (const [fx, title, propertyId] of [[rose, "8 Rose Street", rosePropertyId], [elm, "22 Elm Street", elmPropertyId]] as const) {
      const link = await sb.from("estimates")
        .update({ account_id: accountId, property_id: propertyId, title, accepted_total_cents: 640_000 })
        .eq("id", fx!.estimateId);
      if (link.error) throw new Error(`estimate link: ${link.error.message}`);
    }
    await sb.from("work_orders").update({ stage: "walkthrough", status: "in_progress" }).eq("id", elm.workOrderId);

    // Rose Street: PHOTO_DAYS days of PER_DAY progress photos each, newest
    // first on the feed — more than the old 12-signature budget, so the
    // older days used to render empty cards. Plus a qa-kind photo that must
    // never leave through any route.
    const png = Buffer.from(TINY_SIGNATURE_PNG.split(",")[1], "base64");
    const photo = async (woId: string, kind: string, caption: string, agoDays: number) => {
      const path = `e2e-rosephotos/${run}/${kind}-${Math.random().toString(36).slice(2, 8)}.png`;
      const up = await sb.storage.from("wo-photos").upload(path, png, { contentType: "image/png" });
      if (up.error) throw new Error(`photo upload: ${up.error.message}`);
      photoPaths.push(path);
      const row = await sb.from("wo_photos").insert({
        work_order_id: woId, kind, area: "Front rooms", caption, storage_path: path,
        created_at: new Date(Date.now() - agoDays * 86_400_000 - 3_600_000).toISOString(),
      }).select("id").single();
      if (row.error) throw new Error(`photo row: ${row.error.message}`);
      return row.data.id as string;
    };
    for (let day = 0; day < PHOTO_DAYS; day++) {
      for (let n = 0; n < PER_DAY; n++) {
        await photo(rose.workOrderId, day === PHOTO_DAYS - 1 ? "before" : "progress", `Day ${PHOTO_DAYS - day} photo ${n + 1}`, day);
      }
    }
    qaPhotoId = await photo(rose.workOrderId, "qa", "QA close-up — internal", 0);
  });

  test.afterAll(async () => {
    const sb = db!;
    for (const fx of [rose, elm]) {
      if (!fx) continue;
      await sb.from("wo_photos").delete().eq("work_order_id", fx.workOrderId);
      await destroyLoopFixture(sb, fx);
    }
    if (photoPaths.length) await sb.storage.from("wo-photos").remove(photoPaths);
    if (accountId) {
      await sb.from("properties").delete().eq("account_id", accountId);
      await sb.from("account_users").delete().eq("account_id", accountId);
      await sb.from("accounts").delete().eq("id", accountId);
    }
    if (contractorId) await sb.from("contractors").delete().eq("id", contractorId);
    for (const e of [email, painterEmail]) await deleteUserByEmail(sb, e);
  });

  test("every photo card on the Rose Street timeline carries its photos", async ({ page }) => {
    const sb = db!;
    await openMagicLink(page, await magicLinkFor(sb, email));

    // The project switcher (D1) reaches the second job; the Rose St chip leads there.
    await page.goto("/account/project");
    await expect(page.locator("h1")).toHaveText("Your project, day by day");
    await expect(page.locator(".greet")).toHaveText("22 Elm Street"); // the account's current job by stage
    const roseChip = page.getByTestId("project-chip").filter({ hasText: "8 Rose St" });
    await expect(roseChip).toBeVisible();
    await roseChip.click();
    await expect(page).toHaveURL(new RegExp(`/account/project\\?project=${rose!.workOrderId}`));
    await expect(page.locator(".greet")).toHaveText("8 Rose Street");

    // Every photo card has photos — none of the "Fresh from your painter's
    // phone" cards is empty — and the count is the whole job's, not 12.
    const photoCards = page.locator(".card", { hasText: /Photos from the site|Before photos — how it started/ });
    await expect(photoCards).toHaveCount(PHOTO_DAYS);
    for (let i = 0; i < PHOTO_DAYS; i++) {
      await expect(photoCards.nth(i).locator(".pgrid img")).toHaveCount(PER_DAY);
    }
    await expect(page.locator(".pgrid img")).toHaveCount(PHOTO_DAYS * PER_DAY);
    expect(await page.getByText(/QA close-up/).count()).toBe(0);

    // A thumbnail is a rendition minted on demand through the account — never
    // the original object, never signed into the page up front.
    const src = await page.locator(".pgrid img").first().getAttribute("src");
    expect(src).toMatch(/^\/account\/photo\/[0-9a-f-]{36}\?size=thumb$/);
    const hop = await page.request.get(src!, { maxRedirects: 0 });
    expect(hop.status()).toBe(307);
    expect(hop.headers()["location"]).toContain("/render/image/");
    expect(hop.headers()["location"]).toContain("width=640");

    // The qa-kind photo is refused by the same route, whatever size is asked for.
    const qa = await page.request.get(`/account/photo/${qaPhotoId}?size=thumb`, { maxRedirects: 0 });
    expect(qa.status()).toBe(404);

    // The lightbox still opens the large rendition.
    await page.locator(".pgrid img").first().click();
    await expect(page.locator(".lightbox img")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".lightbox")).toHaveCount(0);
  });
});
