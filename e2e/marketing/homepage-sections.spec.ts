import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";

/**
 * Homepage v2 · session 5 — sections 3–12 as an ANONYMOUS visitor (brief
 * §7.1: all thirteen sections render on desktop and 375px with the
 * prototype copy; §4.5, §4.12, §4.13 ACs; §4.4 "the three featured jobs
 * are the three lowest featured_rank and nothing else").
 */
const db: SupabaseClient | null = serviceClient();

async function captureEvents(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __pgEvents?: unknown[] };
    w.__pgEvents = [];
    window.addEventListener("pg:track", (e) => { w.__pgEvents!.push((e as CustomEvent).detail); });
  });
}
type Captured = { name: string; props: Record<string, unknown> };
const events = (page: Page) => page.evaluate(() => (window as Window & { __pgEvents?: Captured[] }).__pgEvents ?? []);

const SECTION_IDS = ["top", "how", "jobs", "promise", "story", "live", "painters", "trade", "reviews", "faq", "cta"];

test.describe("homepage sections (brief §3, §4.3–4.13)", () => {
  test("every section renders with the prototype copy — desktop", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    for (const id of SECTION_IDS) await expect(page.locator(`#${id}`)).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Four steps. You’re in charge of every one." })).toBeVisible();
    await expect(page.getByText("Rather talk to a person first?")).toBeVisible();
    await expect(page.locator("#how").getByText("03 8840 9414")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("—"); // Tom, 5 Sep: no em dashes anywhere on the page
    await expect(page.getByRole("heading", { name: "What Melbourne properties actually cost to paint." })).toBeVisible();
    await expect(page.getByRole("link", { name: "All jobs →" })).toHaveAttribute("href", "/work");
    await expect(page.getByRole("heading", { name: "Four things we put in writing before we start." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Watch it happen from wherever you are." })).toBeVisible();
    await expect(page.getByTestId("story-captions").getByRole("listitem")).toHaveCount(8);
    await expect(page.getByText("Live from the Paint Group platform")).toBeVisible();
    await expect(page.getByText("updated 2 min ago")).toBeVisible();
    await expect(page.getByText("Prices honoured")).toHaveCount(0); // removed (Tom, 5 Sep)
    await expect(page.getByRole("heading", { name: "Who’ll be painting." })).toBeVisible();
    await expect(page.locator('.pc[data-todo="9.3"]')).toHaveCount(3);
    await expect(page.getByRole("heading", { name: "Every property. One login. No chasing." })).toBeVisible();
    await expect(page.getByText("[Agency name] · 11 properties")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What people say once the tape comes off." })).toBeVisible();
    expect(await page.locator("#reviews .rev").count()).toBeGreaterThanOrEqual(3); // live Google reviews on the slider, or 3 placeholders where the key is absent
    await expect(page.getByRole("heading", { name: "Questions people ask before they type their address." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "See what it costs to paint your home or business. Now." })).toBeVisible();
    // No start-date TILE in the live strip (ruled a future feature); FAQPage JSON-LD present
    await expect(page.locator("#live").getByText(/start date|next available/i)).toHaveCount(0);
    await expect(page.locator("#live .tile")).toHaveCount(3);
    const lds = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(lds.some((t) => t.includes('"FAQPage"'))).toBe(true);
  });

  test("every section renders at 375px and the phone number never hides", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    for (const id of SECTION_IDS) await expect(page.locator(`#${id}`)).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Call us" })).toBeVisible();
    // the four steps stack; the phone line keeps its number on one line
    const cards = page.locator("#how .card");
    await expect(cards).toHaveCount(4);
    const boxes = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    expect(new Set(boxes.map((b) => Math.round(b))).size).toBe(1);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollW).toBeLessThanOrEqual(375);
  });

  test("promise explorer: default row 0, arrow keys move, events fire, approving flips the variation", async ({ page }) => {
    await captureEvents(page);
    await page.goto("/");
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toContainText("Your painter finds rotten timber behind the fascia.");

    await tabs.nth(0).focus();
    await page.keyboard.press("ArrowDown");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toContainText("Confirm my price. Book a call");
    await page.keyboard.press("End");
    await expect(tabs.nth(3)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toContainText("Public liability certificate · $20M");
    await expect(page.getByRole("tabpanel")).not.toContainText(/remote/i);

    await tabs.nth(0).click();
    await page.getByTestId("approve-variation").click();
    await expect(page.getByTestId("approve-variation")).toBeDisabled();
    await expect(page.getByTestId("approve-variation")).toHaveText("Approved ✓");
    await expect(page.getByTestId("variation-pill")).toHaveText("Approved");
    await expect(page.getByRole("status")).toContainText("$486 is added to your fixed price");

    const names = (await events(page)).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["promise_1", "promise_3", "promise_0"]));
  });

  test("FAQ: several answers open at once; faq_open carries the index", async ({ page }) => {
    await captureEvents(page);
    await page.goto("/");
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    const faq = page.getByTestId("faq");
    await expect(faq.locator("details")).toHaveCount(8);
    await faq.getByText("When do I pay?").click();
    await faq.getByText("What does the warranty cover?").click();
    await expect(faq.locator("details[open]")).toHaveCount(2);
    // <details> dispatches `toggle` as a queued task after `open` flips — poll for the second event.
    await expect.poll(async () => (await events(page)).filter((e) => e.name === "faq_open").map((e) => e.props.index)).toEqual([6, 7]);
  });

  test("closing CTA fires see_price with where: bottom and lands in the wizard", async ({ page }) => {
    await captureEvents(page);
    await page.route("**/api/places/autocomplete", (route) => route.fulfill({ json: { suggestions: [] } }));
    await page.goto("/#cta");
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    const cta = page.locator("#cta");
    await cta.getByRole("textbox", { name: "Address" }).fill("9 Clarke Street, Thornbury");
    await cta.getByRole("button", { name: "See my price →" }).click();
    await expect(page).toHaveURL(/\/estimate\?/);
    const u = new URL(page.url());
    expect(u.searchParams.get("address")).toBe("9 Clarke Street, Thornbury");
    expect(u.searchParams.get("mode")).toBe("home");
    const sp = (await events(page)).find((e) => e.name === "see_price");
    expect(sp?.props).toEqual({ where: "bottom", mode: "home", address: "9 Clarke Street, Thornbury" });
  });

  test("Real jobs: the featured cards are the published ranks 1–3 and nothing else; empty slots are visible placeholders", async ({ page }) => {
    test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
    test.setTimeout(240_000); // waits out an ISR window
    const sb = db!;
    const run = randomBytes(3).toString("hex");
    // Park whatever holds ranks 1–3 (the seeded drafts on a test stack), then publish two featured fixtures.
    const { data: holders } = await sb.from("showcase_jobs").select("id, featured_rank").not("featured_rank", "is", null);
    for (const h of holders ?? []) await sb.from("showcase_jobs").update({ featured_rank: null }).eq("id", h.id);
    const base = { job_type: "interior", property_type: "home", suburb: "Northcote", completed_on: "2026-07-01", days_on_site: 4,
      price_low_cents: 840000, price_high_cents: 960000, scope_line: "e2e", summary: "", what_we_did: [], gallery: [], colours: [],
      condition_notes: "", review_quote: null, review_name: null, estimate_id: null, hero_path: `e2e/${run}/h.png`, consent_confirmed: true };
    const ins = await sb.from("showcase_jobs").insert([
      { ...base, slug: `e2e-feat-1-${run}`, title: `E2E featured one ${run}`, featured_rank: 1, published: true },
      { ...base, slug: `e2e-feat-2-${run}`, title: `E2E featured two ${run}`, featured_rank: 2, published: true },
      { ...base, slug: `e2e-feat-3-${run}`, title: `E2E draft three ${run}`, featured_rank: 3, published: false },
    ]);
    expect(ins.error).toBeNull();
    try {
      const deadline = Date.now() + 150_000;
      for (;;) {
        await page.goto("/");
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
        if (await page.getByText(`E2E featured one ${run}`).count()) break;
        if (Date.now() > deadline) throw new Error("/ never picked up the fixtures within two ISR windows");
        await page.waitForTimeout(5_000);
      }
      const grid = page.getByTestId("featured-jobs");
      await expect(grid.getByText(`E2E featured one ${run}`)).toBeVisible();
      await expect(grid.getByText(`E2E featured two ${run}`)).toBeVisible();
      await expect(grid.getByText(`E2E draft three ${run}`)).toHaveCount(0); // a draft never shows, rank or not
      await expect(grid.getByTestId("featured-placeholder")).toHaveCount(1); // the third slot is a visible placeholder
      await expect(grid.locator(".job")).toHaveCount(3);
    } finally {
      await sb.from("showcase_jobs").delete().ilike("slug", `e2e-feat-%-${run}`);
      for (const h of holders ?? []) await sb.from("showcase_jobs").update({ featured_rank: h.featured_rank }).eq("id", h.id);
    }
  });
});
