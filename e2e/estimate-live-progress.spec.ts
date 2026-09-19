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

async function seed(withPresentation: boolean, extra: { source?: string; account_id?: string; property_id?: string } = {}): Promise<{ id: string; token: string }> {
  const token = `live${withPresentation ? "p" : "n"}${run}${randomBytes(8).toString("hex")}`;
  const r = await db!.from("estimates").insert({
    title: `Live progress ${run}`, status: "sent", source: extra.source ?? "manual", level_of_finish: 3, share_token: token,
    account_id: extra.account_id ?? null, property_id: extra.property_id ?? null,
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
  let trade = { id: "", token: "" };
  let wizard = { id: "", token: "" };
  let accountId = "";
  let propertyId = "";
  let websiteBefore: unknown = undefined;
  const DEMO = { name: `Demo Painter ${run}`, specialty: "", since: "", quote: "", photoPath: `site/e2e-demo-${run}.jpg` };

  test.beforeAll(async () => {
    // F1: the Demo painter is a Settings → Website value. Save what is there, set ours, restore after.
    const cur = await db!.from("settings").select("value").eq("key", "website_content").maybeSingle();
    if (cur.error) throw new Error(cur.error.message);
    websiteBefore = cur.data?.value ?? null;
    const base = (websiteBefore && typeof websiteBefore === "object" ? websiteBefore : {}) as Record<string, unknown>;
    const painters = (Array.isArray(base.painters) ? base.painters : []).slice(0, 2) as unknown[];
    const up = await db!.from("settings").upsert({ key: "website_content", value: { ...base, painters: [...painters, DEMO], demoPainter: DEMO.name } }, { onConflict: "key" });
    if (up.error) throw new Error(up.error.message);

    // F5: a trade account with a property carrying a PO reference → the commercial set.
    const a = await db!.from("accounts").insert({ email: `pg.e2e.live-${run}@example.com`, name: `Sample Property Group ${run}`, account_type: "trade" }).select("id").single();
    if (a.error) throw new Error(a.error.message);
    accountId = a.data.id;
    const pr = await db!.from("properties").insert({ account_id: accountId, address: "210 High Street", suburb: "Northcote", postcode: "3070", address_norm: `210 high street northcote 3070 ${run}` }).select("id").single();
    if (pr.error) throw new Error(pr.error.message);
    propertyId = pr.data.id;
    const ref = await db!.from("property_references").insert({ property_id: propertyId, label: "PO", value: `4471-${run}`, sort: 10 });
    if (ref.error) throw new Error(ref.error.message);

    withPres = await seed(true);
    without = await seed(false);
    trade = await seed(true, { account_id: accountId, property_id: propertyId });
    wizard = await seed(true, { source: "wizard" });
  });
  test.afterAll(async () => {
    for (const e of [withPres, without, trade, wizard]) if (e.id) await db!.from("estimates").delete().eq("id", e.id);
    if (propertyId) await db!.from("properties").delete().eq("id", propertyId);
    if (accountId) await db!.from("accounts").delete().eq("id", accountId);
    if (websiteBefore !== undefined) {
      if (websiteBefore === null) await db!.from("settings").delete().eq("key", "website_content");
      else await db!.from("settings").upsert({ key: "website_content", value: websiteBefore }, { onConflict: "key" });
    }
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

    // The suite sets a Demo painter in beforeAll (F1), so the residential text names them.
    await expect(page.getByTestId("pp-sms1")).toContainText(`Good morning Casey. ${DEMO.name} and the team have arrived at 12 Progress Street.`);
    await expect(sec.locator(".pp-addr")).toHaveText("12 Progress Street");
    await expect(sec.locator(".pp-sub")).toHaveText("Alphington · for Casey Livesey");
    // 6b / F2: every photo in the feed is the estimate's own. The ONLY other
    // image in the section is the demo painter's avatar, which F1 takes from
    // Settings → Website (this suite sets one in beforeAll).
    const feedSrcs = await sec.locator(".pp-feed img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).getAttribute("src") ?? ""));
    expect(feedSrcs.length).toBeGreaterThanOrEqual(2);
    for (const s of feedSrcs) expect(s).toContain(`estimate-media/e2e-live-${run}-`);
    const otherSrcs = await sec.locator("img:not(.pp-feed img)").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).getAttribute("src") ?? ""));
    expect(otherSrcs).toEqual([expect.stringMatching(new RegExp(`showcase-media/${DEMO.photoPath}$`))]);
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

    // §8 tracking: started, completed and replayed landed on the estimate's events (and the CRM log) — once each.
    await page.getByTestId("see-how-you-follow").click();
    await expect.poll(async () => {
      const { data } = await db!.from("estimate_events").select("type").eq("estimate_id", withPres.id).like("type", "progress_preview_%");
      return ((data ?? []) as Array<{ type: string }>).map((r) => r.type).sort();
    }, { timeout: 15_000 }).toEqual(["progress_preview_completed", "progress_preview_cta_clicked", "progress_preview_replayed", "progress_preview_started"]);
    const { data: crm } = await db!.from("crm_events").select("payload").eq("estimate_id", withPres.id).eq("type", "estimate_progress_preview");
    expect(((crm ?? []) as Array<{ payload: { event: string; set: string } }>).map((r) => r.payload.event).sort()).toEqual(["completed", "cta_clicked", "replayed", "started"]);
    expect(((crm ?? []) as Array<{ payload: { set: string } }>).every((r) => r.payload.set === "residential")).toBe(true);

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

  test("demo painter from Settings → Website shows by name and photo (F1)", async ({ page }) => {
    await openEstimate(page, withPres.token);
    const lead = page.getByTestId("live-progress").locator(".pp-lead");
    await expect(lead).toContainText(DEMO.name);
    await expect(lead).toContainText("Your lead painter");
    await expect(lead.locator("img")).toHaveAttribute("src", new RegExp(`showcase-media/${DEMO.photoPath.replace(/\//g, "\\/")}$`));
    await expect(page.getByTestId("pp-sms1")).toContainText(`${DEMO.name} and the team have arrived`);
  });

  test("a trade account gets the commercial set: organisation, PO on the estimate, stage rail, site photos (F5, acceptance 9)", async ({ page }) => {
    await openEstimate(page, trade.token);
    const sec = page.getByTestId("live-progress");
    await expect(sec).toHaveAttribute("data-set", "commercial");
    await expect(page.getByTestId("pp-sms1")).toContainText(`12 Progress Street (PO 4471-${run}): Paint Group signed in on site`);
    // The phone reads the ESTIMATE's address (snapshot), not the property row — so its suburb, plus the property's PO.
    await expect(sec.locator(".pp-sub")).toHaveText(`Alphington · PO 4471-${run}`);
    await expect(sec.locator(".pp-brand")).toContainText(`Sample Property Group ${run}`);
    await expect(sec.locator(".pp-rail span")).toHaveCount(5);
    await expect(sec.locator(".pp-lead")).toContainText("Site supervisor");
    await expect(sec.locator(".pp-feed .cap").first()).toHaveText("Before · site photo");
    await expect(page.getByTestId("pp-line")).toContainText("not your actual programme");
    // 13b in the page: none of the residential room words in the commercial wording (area names are the estimate's).
    const feedText = await sec.locator(".pp-feed .card h3, .pp-feed .card .sub").allTextContents();
    for (const t of feedText) expect(t.replace(/Lounge|Dining|Study/g, "")).not.toMatch(/\b(bedroom|bed|bathroom|bath|kitchen|lounge|laundry|home)\b/i);
  });

  test("a wizard self-built estimate never shows it, presentation or not (F9)", async ({ page }) => {
    await openEstimate(page, wizard.token);
    await expect(page.getByTestId("live-progress")).toHaveCount(0);
    await expect(page.getByTestId("see-how-you-follow")).toHaveCount(0);
  });

  test("with a presentation: the hero button and the step-4 link point at the section", async ({ page }) => {
    await openEstimate(page, withPres.token);
    await expect(page.getByTestId("see-how-you-follow")).toHaveAttribute("href", "#live-progress");
    await expect(page.getByTestId("step-live-progress-link")).toHaveAttribute("href", "#live-progress");
  });
});
