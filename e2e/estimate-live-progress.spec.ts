import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { drawSignature } from "./helpers";

/**
 * Live-progress phone on the customer estimate (brief v4, Tom 19 Sep 2026):
 * a phone, and nothing else, below the scope of works — only when a
 * presentation is attached. A text arrives, gets tapped, the customer's job
 * opens with their address, their rooms and their own before photos, and the
 * updates rise one by one until the "finished" text.
 *
 * Anonymous customer throughout. Two estimates: one with a presentation
 * attached (the phone), one without (nothing at all).
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");

const COMPANY = {
  name: "Paint Group Pty Ltd", addressLine1: "1 Example St", addressLine2: "Melbourne VIC",
  phone: "(03) 9000 0000", abn: "11 222 333 444", email: "hello@example.com",
  estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "",
};
// Public photo URLs the way the snapshot carries them. The bucket path is
// what matters to the assertions; the bytes need not exist.
const PHOTO = (n: number) => `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.test"}/storage/v1/object/public/estimate-media/e2e-live-${run}-${n}.jpg`;

const SNAPSHOT = {
  version: 1,
  company: COMPANY,
  contactName: "Casey Livesey", contactEmail: "", jobTitle: "Interior repaint",
  gstRatePct: 10, depositPct: 10,
  lineItems: [], options: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 300000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [
    { id: "1", title: "Lounge", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [PHOTO(1), PHOTO(2)] },
    { id: "2", title: "Dining", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [PHOTO(3)] },
    { id: "3", title: "Study", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Ceiling", coats: 2, product: "" }], photos: [] },
  ],
  paints: [{ name: "Wash & Wear", brand: "Dulux", category: "Interior walls", role: "Walls", finish: "Low sheen", colourName: "", colourHex: "", blurb: "", properties: [], guarantee: "", photoUrl: "", customerVisible: true, isPrep: false, usage: ["Walls · 2 areas"] }],
};
const PRESENTATION = { blocks: [{ kind: "capability_panel", content: { title: "Built for you", cards: [{ label: "Public liability", value: "$20M", note: "" }] } }] };

async function seed(withPresentation: boolean): Promise<{ id: string; token: string }> {
  const token = `live${withPresentation ? "p" : "n"}${run}${randomBytes(8).toString("hex")}`;
  const r = await db!.from("estimates").insert({
    title: `Live progress ${run}`, status: "sent", source: "manual", level_of_finish: 3, share_token: token,
    sent_at: new Date().toISOString(), total_cents: 330000,
    builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
    sent_snapshot: { ...SNAPSHOT, estRef: `EST-L${run}`, jobAddress: `12 Progress Street, Alphington VIC 3078`, presentation: withPresentation ? PRESENTATION : null },
  }).select("id").single();
  if (r.error) throw new Error(r.error.message);
  return { id: r.data.id, token };
}

async function openEstimate(page: Page, token: string) {
  await page.goto(`/e/${token}`);
  await expect(page.locator("details.room").first()).toBeVisible();
}

test.describe("the live-progress phone on the estimate", () => {
  test.skip(!db, "needs the service key");
  let withPres = { id: "", token: "" };
  let without = { id: "", token: "" };

  test.beforeAll(async () => {
    withPres = await seed(true);
    without = await seed(false);
  });
  test.afterAll(async () => {
    for (const e of [withPres, without]) if (e.id) await db!.from("estimates").delete().eq("id", e.id);
  });

  test("sits directly after the scope of works and before the paint section, and is only the phone", async ({ page }) => {
    await openEstimate(page, withPres.token);
    const sec = page.getByTestId("live-progress");
    await expect(sec).toBeVisible();
    // 12b: the next sibling after scope, before paint.
    const neighbours = await sec.evaluate((el) => ({
      prev: el.previousElementSibling?.querySelector("h2")?.textContent ?? "",
      next: el.nextElementSibling?.querySelector("h2")?.textContent ?? "",
    }));
    expect(neighbours.prev).toMatch(/Scope of works/);
    expect(neighbours.next).toMatch(/The paint we/);
    // 13: no headline, intro or bullet copy in the section — only the label, the phone, the button and the line.
    // (Headings INSIDE the phone are the portal feed's own card titles.)
    await expect(sec.locator(":scope > h2, :scope > h3, :scope > ul, :scope > ol, :scope > p:not(.pp-label):not(.pp-sr)")).toHaveCount(0);
    await expect(page.getByTestId("pp-label")).toHaveText("Example of your live updates");
    await expect(page.getByTestId("pp-line")).toContainText("For illustration only.");
    await expect(page.getByTestId("pp-phone")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByTestId("pp-summary")).toContainText("Text message:");
  });

  test("shows their name, address, rooms and own photos; plays to the last text; Play again restarts; then they accept", async ({ page }) => {
    await openEstimate(page, withPres.token);
    const sec = page.getByTestId("live-progress");
    await sec.scrollIntoViewIfNeeded();

    await expect(page.getByTestId("pp-sms1")).toContainText("Good morning Casey. The team have arrived at 12 Progress Street.");
    await expect(sec.locator(".pp-addr")).toHaveText("12 Progress Street");
    await expect(sec.locator(".pp-sub")).toHaveText("Alphington · for Casey Livesey");
    // Only the estimate's own photos, each tagged as theirs (6b, F2).
    const srcs = await sec.locator("img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).getAttribute("src") ?? ""));
    expect(srcs.length).toBeGreaterThanOrEqual(2);
    for (const s of srcs) expect(s).toContain(`estimate-media/e2e-live-${run}-`);
    await expect(sec.locator(".pp-feed .cap").first()).toHaveText("Before · your photo");
    await expect(sec.locator(".pp-feed .tl-item").first()).toContainText("Lounge and Dining");

    // The sequence ends on the finished text (~20 s).
    const last = page.getByTestId("pp-sms2");
    await expect(last).toHaveClass(/\bin\b/, { timeout: 45_000 });
    await expect(last).toContainText("12 Progress Street is finished.");
    await expect(sec.locator(".pp-feed .tl-item:visible")).toHaveCount(5);
    // The app pane followed the newest update down.
    expect(await sec.locator(".pp-app").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Play again: back to the lock screen, then the story runs again.
    await page.getByTestId("pp-replay").click();
    await expect(last).not.toHaveClass(/\bin\b/);
    await expect(page.getByTestId("pp-lock")).not.toHaveClass(/gone/);
    await expect(page.getByTestId("pp-lock")).toHaveClass(/gone/, { timeout: 15_000 });

    // Acceptance works exactly as before (16).
    await page.getByRole("button", { name: "Accept this estimate" }).click();
    await page.getByPlaceholder("Your full name").fill("Casey Livesey");
    await page.getByTestId("signature-canvas").scrollIntoViewIfNeeded();
    await drawSignature(page);
    await page.getByRole("button", { name: "Accept & continue" }).click();
    await expect(page.locator(".resultbanner.accepted").first()).toBeVisible({ timeout: 20_000 });
    const { data } = await db!.from("estimates").select("status").eq("id", withPres.id).single();
    expect((data as { status: string }).status).toBe("accepted");
  });

  test("reduced motion: nothing animates, the final state shows, label and line still present", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openEstimate(page, withPres.token);
    const sec = page.getByTestId("live-progress");
    await sec.scrollIntoViewIfNeeded();
    await expect(sec.locator(".pp-feed .tl-item:visible")).toHaveCount(5);
    await expect(page.getByTestId("pp-sms2")).toBeVisible();
    await expect(page.getByTestId("pp-lock")).toBeHidden();
    await expect(page.getByTestId("pp-label")).toBeVisible();
    await expect(page.getByTestId("pp-line")).toBeVisible();
  });

  test("360 px: no horizontal scroll and the phone fully visible", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openEstimate(page, withPres.token);
    await page.getByTestId("pp-phone").scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByTestId("pp-phone").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  });

  test("no presentation attached: no section, no hero button, no step-4 link, none of its images", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));
    await openEstimate(page, without.token);
    await expect(page.getByTestId("live-progress")).toHaveCount(0);
    await expect(page.locator("[class^='pp-'], [class*=' pp-']")).toHaveCount(0);
    await expect(page.getByTestId("see-how-you-follow")).toHaveCount(0);
    await expect(page.getByTestId("step-live-progress-link")).toHaveCount(0);
    // The demo's own script never loads (rule 2). Its stylesheet rides the
    // route's CSS bundle either way — a stylesheet is neither script nor image.
    expect(requested.some((u) => /ProgressPhone/.test(u) && /\.js(\?|$)/.test(u))).toBe(false);
  });

  test("with a presentation: the hero button and the step-4 link point at the section", async ({ page }) => {
    await openEstimate(page, withPres.token);
    await expect(page.getByTestId("see-how-you-follow")).toHaveAttribute("href", "#live-progress");
    await expect(page.getByTestId("step-live-progress-link")).toHaveAttribute("href", "#live-progress");
  });
});
