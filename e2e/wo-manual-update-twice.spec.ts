import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn, test, TINY_SIGNATURE_PNG } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { deleteUserByEmail, magicLinkFor, openMagicLink } from "./fixtures/portal";

/**
 * Tom, 25 Oct 2026: "i couldnt send anything in the update section, as
 * something has already been sent for today." The job-page composer rode on
 * the END-OF-DAY row, which is one per job per day, so once the day's summary
 * had gone the office could not send the finished photos. A manual update is
 * now its own kind (20270304): as many a day as the office likes, each one
 * emailed, texted and on the customer's timeline.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

test.describe("manual updates from PC Command go out even after the day's summary", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.updtwice.${run}@example.com`;
  let fixture: LoopFixture | null = null;
  let accountId = "";
  let afterPhotoId = "";
  const photoPaths: string[] = [];
  const first = `Quick one — the hallway is finished and looking sharp. ${run}`;
  const second = `Here are the finished photos of the front. ${run}`;

  test.beforeAll(async () => {
    const sb = db!;
    const contractorId = await contractorIdForEmail(sb, contractor!.email);
    fixture = await createLoopFixture(sb, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    await sb.from("work_orders").update({ stage: "in_progress", start_date: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10) }).eq("id", fixture.workOrderId);

    const acct = await sb.from("accounts").insert({ email, name: "Nadia Twice" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id;
    const link = await sb.from("estimates").update({ account_id: accountId, title: "3 Fern Court", accepted_name: "Nadia Twice" }).eq("id", fixture.estimateId);
    if (link.error) throw new Error(`estimate link: ${link.error.message}`);

    const png = Buffer.from(TINY_SIGNATURE_PNG.split(",")[1], "base64");
    const path = `wo/${fixture.workOrderId}/e2e-completion-${run}.png`;
    const up = await sb.storage.from("wo-photos").upload(path, png, { contentType: "image/png" });
    if (up.error) throw new Error(`photo upload: ${up.error.message}`);
    photoPaths.push(path);
    const row = await sb.from("wo_photos").insert({
      work_order_id: fixture.workOrderId, kind: "completion", area: "Front", caption: `Front — finished ${run}`, storage_path: path,
    }).select("id").single();
    if (row.error) throw new Error(`photo row: ${row.error.message}`);
    afterPhotoId = row.data.id as string;

    // Today's end-of-day summary has ALREADY gone — the state Tom hit.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const drafted = await rpcAs(staff!, "wo_draft_update", { p_work_order_id: fixture.workOrderId, p_for_date: today, p_text: `Today's summary. ${run}`, p_tick_ids: [], p_photo_count: 0 });
    if (!drafted.startsWith("ok:")) throw new Error(`draft: ${drafted}`);
    const id = drafted.slice(3);
    expect(await rpcAs(staff!, "wo_approve_update", { p_update_id: id, p_final_text: null })).toBe("ok:approved");
    expect(await rpcAs(staff!, "wo_send_update", { p_update_id: id, p_photo_ids: [], p_sender_name: null })).toBe("ok:sent");
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

  test("two manual updates on a day whose summary went; the customer sees all three", async ({ page }) => {
    const sb = db!;
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);
    const composer = page.getByTestId("update-composer");
    await expect(composer).toContainText(/as many as you need/i);

    // First manual update: words only.
    await composer.getByTestId("update-body").fill(first);
    await composer.getByTestId("send-update").click();
    await expect(composer.getByTestId("update-composer-msg")).toContainText(/Update sent/, { timeout: 20_000 });

    // Second, the same day: the finished photo.
    await composer.getByTestId("update-body").fill(second);
    await composer.getByTestId(`update-photo-${afterPhotoId}`).click();
    await expect(composer.getByTestId("send-update")).toContainText("+ 1 photo");
    await composer.getByTestId("send-update").click();
    await expect(composer.getByTestId("update-composer-msg")).toContainText(/Update sent/, { timeout: 20_000 });

    // Three sent rows today: the summary and two manual ones, the photo on the last.
    const { data: rows, error } = await sb.from("wo_updates").select("kind, status, photo_ids, final_text")
      .eq("work_order_id", fixture!.workOrderId).order("created_at");
    if (error) throw new Error(error.message);
    const sent = (rows ?? []) as { kind: string; status: string; photo_ids: string[]; final_text: string }[];
    expect(sent.map((r) => [r.kind, r.status])).toEqual([["end_of_day", "sent"], ["manual", "sent"], ["manual", "sent"]]);
    expect(sent[2].photo_ids).toEqual([afterPhotoId]);

    // The customer: both manual updates are on the timeline, the photo on the second.
    await page.context().clearCookies();
    await openMagicLink(page, await magicLinkFor(sb, email));
    await page.goto("/account/project");
    await expect(page.locator(".card", { hasText: first.slice(0, 40) })).toBeVisible();
    const withPhoto = page.locator(".card", { hasText: second.slice(0, 40) });
    await expect(withPhoto).toBeVisible();
    await expect(withPhoto.locator(".pgrid .photo")).toHaveCount(1);
  });
});
