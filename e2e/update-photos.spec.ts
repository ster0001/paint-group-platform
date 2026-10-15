import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn, test, TINY_SIGNATURE_PNG } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { deleteUserByEmail, magicLinkFor, openMagicLink } from "./fixtures/portal";

/**
 * Tom, 14 Oct 2026: "Clients are unable to see photos attached in the updates
 * section." The office picked photos on the job page composer; they rode in
 * the email only, and the portal card showed whatever was taken that day.
 * Now the chosen ids are recorded on the update (20270268) and the customer's
 * card shows exactly those — whatever day they were taken.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

test.describe("update photos reach the customer", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.updphoto.${run}@example.com`;
  let fixture: LoopFixture | null = null;
  let accountId = "";
  let oldPhotoId = "";
  const photoPaths: string[] = [];
  const body = `Front weatherboards finished today — photo from Monday shows how it started. ${run}`;

  test.beforeAll(async () => {
    const sb = db!;
    const contractorId = await contractorIdForEmail(sb, contractor!.email);
    fixture = await createLoopFixture(sb, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    await sb.from("work_orders").update({ stage: "in_progress", start_date: new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10) }).eq("id", fixture.workOrderId);

    const acct = await sb.from("accounts").insert({ email, name: "Priya Update" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id;
    const link = await sb.from("estimates").update({ account_id: accountId, title: "8 Elm Grove", accepted_name: "Priya Update" }).eq("id", fixture.estimateId);
    if (link.error) throw new Error(`estimate link: ${link.error.message}`);

    const png = Buffer.from(TINY_SIGNATURE_PNG.split(",")[1], "base64");
    const photo = async (kind: string, caption: string, agoDays: number) => {
      // Under wo/<job>/ — the bucket read policy keys on that segment, and the
      // PC page signs the gallery as the STAFF login, not the service role.
      const path = `wo/${fixture!.workOrderId}/e2e-${kind}-${Math.random().toString(36).slice(2, 8)}.png`;
      const up = await sb.storage.from("wo-photos").upload(path, png, { contentType: "image/png" });
      if (up.error) throw new Error(`photo upload: ${up.error.message}`);
      photoPaths.push(path);
      const row = await sb.from("wo_photos").insert({
        work_order_id: fixture!.workOrderId, kind, area: "Front", caption, storage_path: path,
        created_at: new Date(Date.now() - agoDays * 86_400_000).toISOString(),
      }).select("id").single();
      if (row.error) throw new Error(`photo row: ${row.error.message}`);
      return row.data.id as string;
    };
    // Taken three days ago: the day-grouping would never put it on today's update.
    oldPhotoId = await photo("before", `Monday — how the front started ${run}`, 3);
  });

  test.afterAll(async () => {
    const sb = db!;
    if (fixture) await destroyLoopFixture(sb, fixture);
    if (photoPaths.length) await sb.storage.from("wo-photos").remove(photoPaths);
    if (accountId) {
      await sb.from("account_users").delete().eq("account_id", accountId);
      await sb.from("accounts").delete().eq("id", accountId);
    }
    await deleteUserByEmail(sb, email);
  });

  test("the office attaches a photo from another day; the customer's update card shows it, once", async ({ page }) => {
    const sb = db!;
    // The office, on the job page: words + the chosen photo.
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);
    const composer = page.getByTestId("update-composer");
    await composer.getByTestId("update-body").fill(body);
    await composer.getByTestId(`update-photo-${oldPhotoId}`).click();
    await expect(composer.getByTestId("send-update")).toContainText("+ 1 photo");
    await composer.getByTestId("send-update").click();
    await expect(composer.getByTestId("update-composer-msg")).toContainText(/Update sent/, { timeout: 20_000 });

    // Recorded on the row, scoped to the job.
    const { data: row } = await sb.from("wo_updates").select("status, photo_ids").eq("work_order_id", fixture!.workOrderId).eq("status", "sent").single();
    expect((row as { photo_ids: string[] }).photo_ids).toEqual([oldPhotoId]);

    // The customer: the update card carries that photo — and it is not drawn
    // again as a "before photos" card on the day it was taken.
    await page.context().clearCookies();
    await openMagicLink(page, await magicLinkFor(sb, email));
    await page.goto("/account/project");
    const card = page.locator(".card", { hasText: body.slice(0, 40) });
    await expect(card).toBeVisible();
    await expect(card.locator(".pgrid .photo")).toHaveCount(1);
    await expect(card.locator(".pgrid .photo").first()).toHaveAttribute("aria-label", new RegExp(`Monday — how the front started ${run}`));
    expect(await page.getByText("Before photos — how it started").count()).toBe(0);
    expect(await page.locator(".pgrid .photo").count()).toBe(1);
  });
});
