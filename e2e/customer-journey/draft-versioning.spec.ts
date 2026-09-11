import { test, expect, type Page } from "@playwright/test";
import { openQuickLook, fillQuickAddress, quickNext } from "./drive";

/**
 * C3 — one server truth for a part-finished walk.
 *
 * `wizard_drafts` autosaved last-write-wins: the route read the open row and
 * wrote the whole state back. Two tabs on one session — a laptop and the phone
 * beside it, or a staff member joining an assisted session — and the later
 * write erased the earlier one. Nobody saw it: the route is best-effort by
 * design and answered 200 either way.
 *
 * Driven as the anonymous customer, which is the only way this bug is real: the
 * anonymous auth user is what the draft is keyed on, so two tabs in ONE browser
 * context are two writers on one row.
 *
 * NOTE: needs migration 20270136000000_wizard_drafts_version.sql on the target
 * project. Without the `version` column every write takes the old path and the
 * conflict never fires.
 */

async function startAWalk(page: Page, suburb: string) {
  await openQuickLook(page);
  await fillQuickAddress(page, { suburb });
  await quickNext(page);
}

test("two tabs on one session: the loser merges instead of erasing the winner", async ({ context }) => {
  test.setTimeout(240_000);

  const tabA = await context.newPage();
  await startAWalk(tabA, "Richmond");

  // Same anonymous session, second tab. It loads the draft tab A has saved.
  const tabB = await context.newPage();
  await tabB.goto("/estimate");
  await expect(tabB.locator("[data-quick-step]")).toBeVisible({ timeout: 30_000 });

  // B answers and saves first.
  const conflicts: number[] = [];
  tabA.on("response", (r) => { if (r.url().includes("/api/wizard/draft")) conflicts.push(r.status()); });

  await quickNext(tabB).catch(() => undefined);
  await tabB.waitForTimeout(4000);   // past the 2.5s autosave debounce

  // Now A writes against the version it read before B moved.
  await quickNext(tabA).catch(() => undefined);
  await tabA.waitForTimeout(4000);

  // A's write lost the race and was answered 409 — not 200-and-overwrite.
  expect(conflicts.some((s) => s === 409)).toBe(true);

  // And A is still usable: it merged rather than resetting or erroring. The
  // customer is never shown the conflict.
  await expect(tabA.locator(".wz-err, [data-testid='wz-error']")).toHaveCount(0);
  await expect(tabA.locator("[data-quick-step]")).toBeVisible();
});

test("refresh mid-walk resumes in place", async ({ page }) => {
  test.setTimeout(180_000);
  await startAWalk(page, "Hawthorn");
  await page.waitForTimeout(4000);            // let the autosave land

  const stepBefore = await page.locator("[data-quick-step]").getAttribute("data-quick-step");
  await page.reload();
  await expect(page.locator("[data-quick-step]")).toBeVisible({ timeout: 30_000 });
  expect(await page.locator("[data-quick-step]").getAttribute("data-quick-step")).toBe(stepBefore);
});

test("the draft route answers 409 rather than silently winning", async ({ context }) => {
  // The contract, exercised directly: two writes, the second carrying a stale
  // version, must not both succeed.
  const page = await context.newPage();
  await startAWalk(page, "Kew");
  await page.waitForTimeout(4000);

  const post = async (version: number | null, suburb: string) => page.evaluate(async ({ version, suburb }) => {
    const res = await fetch("/api/wizard/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: { customer: { suburb }, title: "x" }, page: 2,
        ...(version != null ? { version } : {}),
      }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { version, suburb });

  const first = await post(null, "Kew");            // no version: writes against current
  expect(first.status).toBe(200);
  const v = (first.body as { version?: number } | null)?.version;
  expect(typeof v).toBe("number");

  const stale = await post((v as number) - 1, "Somewhere else");
  expect(stale.status).toBe(409);
  expect((stale.body as { conflict?: boolean } | null)?.conflict).toBe(true);
  // and it hands back the server's copy so the client can merge
  expect((stale.body as { state?: unknown } | null)?.state).toBeTruthy();
});
