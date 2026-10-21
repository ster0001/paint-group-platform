import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contractorIdForEmail, rpcAs, serviceClient, type LoopFixture } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn, test, userIdFor } from "../helpers";
import { DESK, INTERIOR_AREAS, PHONE, caption, createHelpJob, destroyHelpJob, installCaptions, startRecording, writeGif } from "./rig";

/**
 * Walkthrough GIFs for docs/help/movements — pc and contractor. Not a gate. Each test
 * performs its help file's first steps with a caption per step while frames are captured,
 * then writes media/<role>-walkthrough.gif. Test data only.
 *
 *   ./scripts/c1/run-e2e.sh e2e/help-capture/gif-movements.spec.ts
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const F = "movements";
const RUN = Math.random().toString(36).slice(2, 8);
const BRAND = `Dulux Help ${RUN}`;
let contractorId = "";
let staffProfileId = "";
let job: LoopFixture | null = null;
let productId = "";
let branchId = "";
let settingsBefore: unknown = undefined;
let settingsExisted = false;
const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
function addDays(iso: string, n: number): string { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function nextMonday(): string { const t = melbourne.format(new Date()); const dow = new Date(`${t}T12:00:00Z`).getUTCDay(); return addDays(t, ((8 - dow) % 7) || 7); }
const MON = nextMonday();

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 14, from.y + ((to.y - from.y) * i) / 14); await page.waitForTimeout(50); }
  await page.mouse.up();
}
const centreOf = async (page: Page, selector: string) => { const box = await page.locator(selector).first().boundingBox(); if (!box) throw new Error(`no box for ${selector}`); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!db || !staff || !contractor) return;
  contractorId = (await contractorIdForEmail(db, contractor.email)) ?? "";
  staffProfileId = (await userIdFor(staff)) ?? "";
  const { data: pr } = await db.from("products").insert({ name: `Weathershield Help ${RUN}`, brand: BRAND, coverage: 12, price_per_litre: 2500, wastage_pct: 10 }).select("id").single();
  productId = (pr as { id: string }).id;
  const { data: b } = await db.from("supplier_branches").insert({ brand: BRAND, branch: "Preston", kind: "paint", suburb: "Preston", address: "148 Bell St", postcode: "3072", lat: -37.74, lng: 145.0, delivers_to_site: true, opens_weekday: "06:00", active: true }).select("id").single();
  branchId = (b as { id: string }).id;
  const { data: s } = await db.from("settings").select("value").eq("key", "movements").maybeSingle();
  settingsExisted = Boolean(s); settingsBefore = s?.value ?? null;
  const base = (settingsBefore && typeof settingsBefore === "object" ? settingsBefore : {}) as Record<string, unknown>;
  const people = Array.isArray(base.boardPeople) ? (base.boardPeople as { id: string }[]).filter((p) => p.id !== staffProfileId) : [];
  await db.from("settings").upsert({ key: "movements", value: { ...base, boardPeople: [...people, { id: staffProfileId, slots: "hour", colour: "#0E8C9C" }], showHowItWorks: true } }, { onConflict: "key" });
  job = await createHelpJob(db, { title: "Weatherboard repaint — Preston", address: "14 Bellair Street, Preston VIC 3072", contactFirstName: "Mira", paymentCents: 612_000, areas: INTERIOR_AREAS, assigned: { contractorId, startDate: addDays(MON, 1), stage: "pre_start" } });
  const { data: w } = await db.from("work_orders").select("wo_snapshot").eq("id", job.workOrderId).single();
  await db.from("work_orders").update({
    wo_snapshot: { ...((w as { wo_snapshot: Record<string, unknown> }).wo_snapshot), materials: [{ product: `Weathershield Help ${RUN}`, colourKey: "ws||Lexicon", photoUrl: "", litres: 20, coverageMissing: false, colourName: "Lexicon Quarter", colourHex: "#EEEEEE", colourStatus: "confirmed" }] },
    end_date: addDays(MON, 4), colours: { [`Weathershield Help ${RUN}`]: { status: "confirmed", name: "Lexicon Quarter", hex: "#EEEEEE" } },
  }).eq("id", job.workOrderId);
  await rpcAs(staff, "material_line_add", { p_work_order_id: job.workOrderId, p_text: "Gap filler × 2, masking tape × 4", p_source: "estimate" });
});

test.afterAll(async () => {
  if (!db) return;
  await destroyHelpJob(db, job);
  if (branchId) await db.from("supplier_branches").delete().eq("id", branchId);
  await db.from("vendors").delete().eq("name", BRAND);
  if (productId) await db.from("products").delete().eq("id", productId);
  if (settingsExisted) await db.from("settings").update({ value: settingsBefore }).eq("key", "movements");
  else await db.from("settings").delete().eq("key", "movements");
});

test("movements · pc walkthrough", async ({ browser }) => {
  test.skip(!db || !staff || !contractor, missingCreds("CONTRACTOR"));
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: DESK });
  const c = await ctx.newPage();
  await signIn(c, staff!, /\/(home|estimates)/);
  await c.goto(`/pc/movements?view=week&week=${MON}`);
  await expect(c.getByTestId("movements-board")).toBeVisible({ timeout: 30_000 });
  await installCaptions(c);
  const rec = startRecording(c);
  await caption(c, "1 · The tray: every chip came from a job — paint per brand, a chip per materials line, the rubbish question.");
  await c.waitForTimeout(1800);
  const paint = c.locator('[data-testid="tray-chip"]').filter({ hasText: BRAND }).first();
  await paint.hover(); await c.waitForTimeout(600);
  await caption(c, "2 · Drag the paint chip onto Supplier delivers, Tuesday AM. The lane decides who and how; the column decides when.");
  const target = `[data-testid="lane"][data-lane="supplier"] .bgc[data-day="${addDays(MON, 1)}"] .slot[data-slot="am"]`;
  await c.locator(target).scrollIntoViewIfNeeded();
  await dragTo(c, await centreOf(c, `[data-testid="tray-chip"]:has-text("${BRAND}")`), await centreOf(c, target));
  await c.waitForTimeout(1600);
  await caption(c, "3 · The card says Not ordered yet. Tick Ordered ✓ once the shop has the order — that is what tells the painter.");
  const card = c.locator('[data-testid="movement-card"]').filter({ hasText: BRAND }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: /Ordered ✓/ }).click();
  await c.waitForTimeout(1800);
  await caption(c, "4 · Day: each person's run from the warehouse, numbered, with km. ▲▼ reorder; Send to phone.");
  await c.goto(`/pc/movements?view=day&day=${addDays(MON, 1)}&who=${contractorId}`);
  await expect(c.getByTestId("day-view")).toBeVisible({ timeout: 30_000 });
  await c.waitForTimeout(2000);
  await caption(c, "5 · Gear: where every item is, from the last ticked movement that carried it. Never typed.");
  await c.goto("/pc/movements?view=gear");
  await expect(c.getByTestId("gear-view")).toBeVisible({ timeout: 30_000 });
  await c.waitForTimeout(2000);
  const frames = await rec.stop();
  console.log("gif:", JSON.stringify(await writeGif(frames, F, "pc-walkthrough", { width: 960, maxSeconds: 30 })));
  await ctx.close();
});

test("movements · contractor walkthrough", async ({ browser }) => {
  test.skip(!db || !staff || !contractor, missingCreds("CONTRACTOR"));
  test.setTimeout(300_000);
  // The painter's pickup for Tuesday 07:00, ordered by the office.
  const { data } = await db!.from("movements").select("id, source_key").eq("work_order_id", job!.workOrderId).like("source_key", "matline:%").limit(1);
  const line = (data ?? [])[0] as { id: string };
  await rpcAs(staff!, "movement_update", { p_id: line.id, p: { from_branch_id: branchId } });
  await rpcAs(staff!, "movement_place", { p_id: line.id, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: addDays(MON, 1), p_half: "AM", p_time: "07:00" });
  await rpcAs(staff!, "movement_mark_ordered", { p_id: line.id });
  const ctx = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true });
  const c = await ctx.newPage();
  await signIn(c, contractor!, /\/portal/);
  await c.goto(`/portal?day=${addDays(MON, 1)}`);
  await expect(c.getByTestId("movements-card")).toBeVisible({ timeout: 30_000 });
  await installCaptions(c);
  const rec = startRecording(c);
  await caption(c, "1 · Your pickups and drop-offs today: the shop, its address, from what time, and the order number.");
  await c.getByTestId("movements-card").scrollIntoViewIfNeeded();
  await c.waitForTimeout(2200);
  await caption(c, "2 · Navigate opens the shop in Maps; Call rings them. Quote the order number at the counter.");
  await c.waitForTimeout(1800);
  await caption(c, "3 · Tap Picked up ✓ once it is in the van — the office sees it the same moment.");
  await c.getByTestId("movements-tick").first().click();
  await c.waitForTimeout(1800);
  await caption(c, "4 · On the job sheet, Getting it to site says what is delivered, what you collect, and how the rubbish goes.");
  await c.goto(`/portal/jobs/${job!.workOrderId}#logistics`);
  await expect(c.getByTestId("wo-logistics")).toBeVisible({ timeout: 30_000 });
  await c.getByTestId("wo-logistics").scrollIntoViewIfNeeded();
  await c.waitForTimeout(2200);
  const frames = await rec.stop();
  console.log("gif:", JSON.stringify(await writeGif(frames, F, "contractor-walkthrough", { width: 390, maxSeconds: 30 })));
  await ctx.close();
});
