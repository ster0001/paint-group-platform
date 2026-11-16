import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { melbourneDate } from "@/lib/workorder/console";

/**
 * Tom, 12 Nov 2026: "I am unable to remove the nothing ticked in 3 days when
 * clicking the x button … I can press one button and it send another text to
 * the crew to update and then removes the prompt. Also the x button needs to
 * work."
 *
 * Two jobs, one quiet-site card each (a card key is per job, so one job can't
 * prove both ways out). The ✕ closes it for good; "Text the crew" texts every
 * painter on the job to update, logs it on the job, and closes the card too.
 * Both stay gone across a reload.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let crossJob: LoopFixture | null = null;
let textJob: LoopFixture | null = null;
let contractorId: string | null = null;
let phoneBefore: string | null | undefined;

const flag = (workOrderId: string) => db!.from("wo_events").insert({
  work_order_id: workOrderId, type: "quiet_site", actor_kind: "system",
  meta: { date: melbourneDate(new Date()), wo_ref: "WO-E2E", days: 3 },
});

test.describe("Nothing ticked in 3 days on PC Command", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture jobs");

  test.beforeAll(async () => {
    contractorId = await contractorIdForEmail(db!, contractor!.email);
    // The painter needs a mobile to be texted at all; the test stack has no
    // SMS provider, so nothing leaves the building.
    const { data: c, error: cErr } = await db!.from("contractors").select("phone").eq("id", contractorId!).single();
    if (cErr) throw cErr;
    phoneBefore = (c as { phone: string | null }).phone;
    const p = await db!.from("contractors").update({ phone: phoneBefore || "0400 000 000" }).eq("id", contractorId!);
    if (p.error) throw p.error;
    crossJob = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    textJob = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    for (const j of [crossJob, textJob]) {
      const r = await flag(j.workOrderId);
      if (r.error) throw r.error;
    }
  });

  test.afterAll(async () => {
    if (crossJob) await db!.from("wo_variations").delete().eq("work_order_id", crossJob.workOrderId);
    if (contractorId && phoneBefore !== undefined) await db!.from("contractors").update({ phone: phoneBefore }).eq("id", contractorId);
    await destroyLoopFixture(db!, crossJob);
    await destroyLoopFixture(db!, textJob);
  });

  test("the ✕ closes the card off for good", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const key = `quiet-site:${crossJob!.workOrderId}`;
    const card = page.getByTestId(`card-${key}`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText("Nothing ticked in 3 days");

    await card.getByTestId(`dismiss-${key}`).click();
    await expect(card).toHaveCount(0, { timeout: 20_000 });

    await page.goto("/pc");
    await expect(page.locator("h1")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`card-${key}`)).toHaveCount(0);
  });

  test("Text the crew sends the update text and closes the card", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const key = `quiet-site:${textJob!.workOrderId}`;
    const card = page.getByTestId(`card-${key}`);
    await expect(card).toBeVisible({ timeout: 20_000 });

    const nudge = card.getByTestId(`nudge-crew-${textJob!.workOrderId}`);
    await expect(nudge).toHaveText("Text the crew");
    await nudge.click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });

    // The text is on the job's record, one outcome per painter on it.
    await expect.poll(async () => {
      const { data, error } = await db!.from("wo_events").select("meta")
        .eq("work_order_id", textJob!.workOrderId).eq("type", "quiet_site_nudged");
      if (error) throw error;
      return ((data ?? []) as { meta: { outcomes?: Record<string, string> } }[])[0]?.meta?.outcomes?.[contractorId!] ?? null;
    }, { timeout: 20_000 }).not.toBeNull();

    await page.goto("/pc");
    await expect(page.locator("h1")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`card-${key}`)).toHaveCount(0);
  });

  // Tom, 12 Nov 2026: "the extra scope items also need an x to be able to be
  // closed off". The row leaves the list for good; the variation is untouched.
  test("an Extra scope row on Variations for approval closes off with its ✕", async ({ page }) => {
    const v = await db!.from("wo_variations").insert({
      work_order_id: crossJob!.workOrderId, category: "extra_scope",
      comment: "Paint the shed too", est_hours: 2, status: "raised",
    }).select("id").single();
    if (v.error) throw v.error;
    const id = (v.data as { id: string }).id;

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const row = page.getByTestId(`variation-approval-${id}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText("Extra scope");
    await row.getByTestId(`dismiss-variation-approval:${id}`).click();
    await expect(row).toHaveCount(0, { timeout: 20_000 });

    await page.goto("/pc");
    await expect(page.locator("h1")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`variation-approval-${id}`)).toHaveCount(0);
    const { data, error } = await db!.from("wo_variations").select("status").eq("id", id).single();
    if (error) throw error;
    expect((data as { status: string }).status).toBe("raised");
  });
});
