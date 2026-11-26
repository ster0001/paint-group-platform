import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { fillQuickAddress, gateDoor, openQuickLook, passOtpIfShown, quickNext } from "./drive";

/**
 * Tom, 20 Nov 2026 — seven quote-stage items, as an anonymous customer on a PHONE (390 × 780), a two-bedroom house:
 *   · 1 — the robe card counts the robe doors (a − / + counter);
 *   · 2 — the walls inside the robe can be ticked with NO doors;
 *   · 3 — Bed 2's size card offers "Same as Bed 1": its measurements are kept, Bed 1's surfaces and robe answers are
 *         copied, and the stage skips straight to the next room;
 *   · 4 — the robe card is asked in bedrooms only (never the kitchen, the bathroom, the laundry or the hall);
 *   · 5 — "+ Add a surface" offers Cupboard doors in a room that is not a bedroom, with a − / + counter.
 * Items 6 and 7 (hallway 5 × 1.25 m, ensuite 2 × 1.5 m) are the typical-size table: `lib/wizard/quote-stage-20nov.test.ts`
 * and migration 20270318.
 */
const FLAG_ON = process.env.NEXT_PUBLIC_QUOTE_STAGE_V10 !== "0";
const db = serviceClient();
type Block = { id: number; name?: string; roomType?: string; L?: number; W?: number; surfaces?: Array<{ code?: string; count?: number; sharePct?: number }>; customer?: { cup?: boolean | null; cupInterior?: boolean | null } };

test.describe("Quote stage — robe doors counted, walls inside alone, Same as Bed 1, cupboard doors anywhere", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!FLAG_ON, "quote stage v10 is switched off in this environment");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const run = randomBytes(3).toString("hex");
  const suburb = `E2E Q20 ${run}`;
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows, error } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    if (error) throw new Error(`clean-up read failed: ${error.message}`);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
  });
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 20_000 });
  const stage = (page: Page) => page.getByTestId("quote-stage");
  const cardId = (page: Page) => stage(page).getAttribute("data-quote-card");
  const settle = (page: Page) => expect(stage(page)).toHaveAttribute("data-busy", "0", { timeout: 60_000 });
  const left = async (page: Page, id: string) => { await expect.poll(() => cardId(page), { timeout: 30_000 }).not.toBe(id); await settle(page); };
  const blocksOf = async (estimateId: string): Promise<Block[]> => {
    const { data, error } = await db!.from("estimates").select("builder_state").eq("id", estimateId).single();
    if (error) throw new Error(`estimate read failed: ${error.message}`);
    return ((data.builder_state as { blocks?: Block[] }).blocks ?? []).filter((b) => b.roomType);
  };

  test("items 1–5 through the quote stage", async ({ page }) => {
    test.setTimeout(420_000);
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb });
    await at(page, "what");
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "beds");
    await page.getByTestId("ql-bedrooms-2").tap();
    await at(page, "storeys");
    await page.getByTestId("ql-storeys-single").tap();
    await at(page, "job");
    await page.getByTestId("ql-scope-whole").tap();
    await at(page, "surfaces");
    await quickNext(page);
    await at(page, "rooms");
    await quickNext(page);
    await at(page, "colours");
    await page.getByTestId("ql-colours-same").tap();
    await at(page, "condition");
    await page.getByTestId("ql-condition-good").tap();
    await at(page, "living");
    await page.getByTestId("ql-occupied-no").tap();
    await at(page, "details");
    await page.getByTestId("gate-name").fill("Sam Lee");
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await page.getByTestId("gate-email").fill(`q20.${run}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    await passOtpIfShown(page);
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`submit failed: ${await bounced.first().innerText()}`);
    await gateDoor(page).tap();
    await expect(page).toHaveURL(/\/estimate\/quote\?id=/, { timeout: 60_000 });
    await expect(stage(page)).toBeVisible({ timeout: 30_000 });
    const estimateId = new URL(page.url()).searchParams.get("id")!;

    // the whole-house questions: the first answer to each
    for (let i = 0; i < 20; i++) {
      await settle(page);
      const id = (await cardId(page))!;
      if (!id.startsWith("g:")) break;
      await page.locator('[data-testid^="q-opt-"]').first().tap();
      await left(page, id);
    }

    // ── Bed 1 ────────────────────────────────────────────────────────────────────────────────────────────────────
    const bed1 = (await cardId(page))!;
    expect(bed1).toMatch(/^measure:\d+$/);
    const a1 = Number(bed1.split(":")[1]);
    await expect(page.getByTestId("wzm-h1")).toContainText(/bed 1/i);
    await expect(page.getByTestId("q-same-as"), "the first bedroom has nothing to be the same as").toHaveCount(0);
    await page.getByTestId("q-size-typical").tap();
    await left(page, bed1);
    expect(await cardId(page)).toBe(`surfaces:${a1}`);
    await page.getByTestId("q-walls-share-50").tap();
    await settle(page);
    // item 5 — a bedroom's cupboard doors are its robe card's, so the add panel does not offer them here
    await page.getByTestId("q-add-surface").tap();
    await expect(page.getByTestId("q-add-panel")).toBeVisible();
    await expect(page.getByTestId("q-add-cupboard-doors")).toHaveCount(0);
    await page.getByTestId("q-add-surface").tap();
    await page.getByTestId("q-next").tap();
    await left(page, `surfaces:${a1}`);
    expect(await cardId(page), "a bedroom asks about its robes").toBe(`robe:${a1}`);
    await expect(page.getByTestId("wzm-h1")).toHaveText("Any built-in robes being painted?");
    // item 2 — the walls inside, with no doors
    await page.getByTestId("q-robe-inside").tap();
    await expect(page.getByTestId("q-robe-inside")).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await expect(page.getByTestId("q-robe-doors")).toHaveAttribute("aria-pressed", "false");
    await settle(page);
    let blocks = await blocksOf(estimateId);
    expect(blocks.find((b) => b.id === a1)!.surfaces!.some((s) => s.code === "Robe Interior"), "the walls inside are on the estimate").toBe(true);
    expect(blocks.find((b) => b.id === a1)!.surfaces!.some((s) => s.code === "Robe Door"), "with no robe doors").toBe(false);
    // item 1 — the doors, counted
    await page.getByTestId("q-robe-doors").tap();
    await expect(page.getByTestId("q-robe-doors")).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await settle(page);
    const counter = page.getByTestId("q-robe-doors-count");
    await expect(counter.locator("b")).toHaveText("2");
    await counter.getByLabel("More").tap();
    await expect(counter.locator("b")).toHaveText("3", { timeout: 30_000 });
    await settle(page);
    await page.getByTestId("q-next").tap();
    await left(page, `robe:${a1}`);
    expect(await cardId(page)).toBe(`attention:${a1}`);
    await page.getByTestId("q-next").tap();
    await left(page, `attention:${a1}`);

    // ── Bed 2: its own measurements, then "Same as Bed 1" (item 3) ───────────────────────────────────────────────
    const bed2 = (await cardId(page))!;
    expect(bed2).toMatch(/^measure:\d+$/);
    const a2 = Number(bed2.split(":")[1]);
    await expect(page.getByTestId("wzm-h1")).toContainText(/bed 2/i);
    await expect(page.getByTestId("q-same-as")).toContainText("Same as Bed 1");
    await page.getByTestId("q-measure-w").fill("3");
    await page.getByTestId("q-measure-l").fill("4.2");
    await page.getByTestId("q-same-as").tap();
    await left(page, bed2);
    const after = (await cardId(page))!;
    expect(after, "the stage skips Bed 2's other cards").toMatch(/^measure:\d+$/);
    expect(Number(after.split(":")[1])).not.toBe(a2);
    blocks = await blocksOf(estimateId);
    const one = blocks.find((b) => b.id === a1)!; const two = blocks.find((b) => b.id === a2)!;
    expect([two.W, two.L], "Bed 2 keeps the size that was typed").toEqual([3, 4.2]);
    const shape = (b: Block) => (b.surfaces ?? []).map((s) => `${s.code}×${s.count ?? 1}${s.sharePct ? `@${s.sharePct}` : ""}`).sort();
    expect(shape(two), "Bed 2 carries what Bed 1 carries").toEqual(shape(one));
    expect(shape(two)).toContain("Robe Door×3");
    expect(shape(two).some((s) => s.endsWith("@50")), "the walls share came across").toBe(true);
    expect([two.customer?.cup, two.customer?.cupInterior]).toEqual([true, true]);

    // ── every other room: no robe card (item 4); cupboard doors from "+ Add a surface" in the first of them (item 5) ──
    const seen: string[] = [];
    let cupboardDone = false;
    for (let i = 0; i < 60; i++) {
      await settle(page);
      const id = (await cardId(page))!;
      if (id === "rooms" || id === "done") break;
      seen.push(id);
      if (id.startsWith("measure:")) await page.getByTestId("q-size-typical").tap();
      else if (id.startsWith("surfaces:") && !cupboardDone) {
        await page.getByTestId("q-add-surface").tap();
        await page.getByTestId("q-add-cupboard-doors").tap();
        const chip = page.getByTestId("q-surf-cupboard-doors");
        await expect(chip).toBeVisible({ timeout: 30_000 });
        await settle(page);
        const n = page.getByTestId("q-count-cupboard-doors");
        const start = Number(await n.locator("b").innerText());
        await n.getByLabel("More").tap();
        await expect(n.locator("b")).toHaveText(String(start + 1), { timeout: 30_000 });
        await settle(page);
        await n.getByLabel("Fewer").tap();
        await expect(n.locator("b")).toHaveText(String(start), { timeout: 30_000 });
        await settle(page);
        cupboardDone = true;
        await page.getByTestId("q-next").tap();
      }
      else await page.getByTestId("q-next").tap();
      await left(page, id);
    }
    expect(cupboardDone, "a room after the bedrooms offered cupboard doors").toBe(true);
    expect(seen.filter((id) => id.startsWith("robe:")), "no robe card outside the bedrooms").toEqual([]);
    expect(seen.filter((id) => id.startsWith("measure:")).length, "the other rooms were all walked").toBeGreaterThanOrEqual(3);
  });
});
