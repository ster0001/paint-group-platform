/**
 * C16 (a) — "describe it" behind the chat bubble, on the TEST stack.
 *
 * Tom's check: describe a job in the chat — the filled fields show as
 * assumed (amber) until you confirm them. A tap on a field confirms that
 * field; Continue on a screen confirms the screen's fields. The assistant
 * writes nothing itself: the answers ride the wizard's own autosave through
 * the versioned draft, and the draft row carries the attribution.
 */
import { test, expect } from "@playwright/test";
import { fillQuickAddress, openQuickLook, quickNext } from "./drive";
import { serviceClient } from "../fixtures/woLoop";

test("describe a job in the bubble → amber until confirmed; a tap and Continue confirm; the draft carries the attribution", async ({ page }) => {
  test.setTimeout(180_000);
  await openQuickLook(page);

  // The bubble, and the describe box behind it (only on the quick look).
  await page.getByTestId("wz-chat-bubble").click();
  await expect(page.getByTestId("wz-describe")).toBeVisible({ timeout: 20_000 });
  // The chat's own start proves the anonymous session is up before we describe.
  await expect(page.getByTestId("wz-chat-text")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("wz-describe-text").fill("Two storey house, 4 bedrooms, walls and ceilings throughout in a new colour, a few cracks in the hallway. The place is vacant.");
  await page.getByTestId("wz-describe-go").click();
  await expect(page.getByTestId("wz-describe-reply")).toContainText(/Filled in \d+ answers?/, { timeout: 30_000 });
  await page.getByTestId("wz-chat-bubble").click(); // minimise

  // Screen 1: the job type is amber (assistant-written).
  await expect(page.getByTestId("assumed-jobType")).toBeVisible();
  await fillQuickAddress(page);
  await quickNext(page); // Continue confirms screen 1's field

  // Screen 2: the place — bedrooms and storeys came from the description.
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("assumed-bedrooms")).toBeVisible();
  await expect(page.getByTestId("assumed-storeys")).toBeVisible();
  await expect(page.getByTestId("ql-bedrooms-4")).toHaveClass(/\bon\b/);
  // A tap on the field confirms it — the tag goes; the other stays.
  await page.getByTestId("ql-bedrooms-4").click();
  await expect(page.getByTestId("assumed-bedrooms")).toHaveCount(0);
  await expect(page.getByTestId("assumed-storeys")).toBeVisible();
  await quickNext(page); // Continue confirms the rest of the screen
  await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 30_000 });

  // The attribution rides the versioned draft — read the row the autosave wrote.
  const db = serviceClient();
  if (db) {
    await expect.poll(async () => {
      const { data } = await db.from("wizard_drafts").select("state, version").is("converted_at", null).order("last_seen_at", { ascending: false }).limit(20);
      const mine = (data ?? []).map((r) => r.state as { assistant?: { wrote?: string[]; source?: string } | null; quickLook?: { bedrooms?: number } }).find((s) => s.assistant?.source === "describe" && s.quickLook?.bedrooms === 4);
      return mine ? { wrote: mine.assistant?.wrote ?? [] } : null;
    }, { timeout: 30_000 }).not.toBeNull();
  }
});
