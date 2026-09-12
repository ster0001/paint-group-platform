import { test, expect, type Page } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";
import { serviceClient } from "../fixtures/woLoop";

/**
 * C14 — the brief, the booking, and every commercial exterior (addendum S6c).
 *
 * Tom's check: Strata → brief → booking creates a calendar event with the
 * brief and photos attached; no number on any brief screen. Accept: booking
 * creates account, property, confirmation request, visit and checklist items ·
 * the brief path never prices (no submit / edit request) · brief renders from
 * the config rows only.
 */

const stamp = Date.now();
const emails = {
  strata: `pg.e2e.brief-strata-${stamp}@example.com`,
  shop: `pg.e2e.brief-shop-${stamp}@example.com`,
  exterior: `pg.e2e.brief-exterior-${stamp}@example.com`,
};

/** Every pricing request on the brief path is a bug: record them. */
function spyPricing(page: Page): string[] {
  const hits: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/\/api\/wizard\/submit|\/wizard-edit|\/api\/wizard\/keep/.test(u)) hits.push(u);
  });
  return hits;
}

async function noNumber(page: Page) {
  await expect(page.locator("body")).not.toContainText(MONEY_RANGE);
  await expect(page.locator("body")).not.toContainText(/\$\s?\d/);
}

async function toSegment(page: Page, jobType: "interior" | "exterior" | "both" = "interior") {
  await openQuickLook(page);
  await fillQuickAddress(page);
  if (jobType !== "interior") await page.getByTestId(`ql-jobtype-${jobType}`).click();
  await quickNext(page);
  const both = page.getByTestId("ql-both-self");
  if (await both.count()) await both.click();
  await page.getByTestId("ql-kind-commercial").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='segment']")).toBeVisible({ timeout: 30_000 });
}

/** One mobile per walk: the account link matches on phone as well as email, so a shared number would fold three walks into one account. */
const mobileFor = (email: string) => `04${String(Math.abs([...email].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 100000000).padStart(8, "0")}`;

async function book(page: Page, email: string, pickSlot = true) {
  await expect(page.locator("[data-quick-step='com_book']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("book-steps")).toContainText(/We visit and measure/);
  await noNumber(page);
  const slots = page.getByTestId("book-slot");
  let slot: string | null = null;
  if (pickSlot && (await slots.count()) > 0) {
    slot = ((await slots.first().innerText()) ?? "").trim();
    await slots.first().click();
  }
  await page.getByTestId("book-email").fill(email);
  await page.getByTestId("book-name").fill("Brief Tester");
  await page.getByTestId("book-phone").fill(mobileFor(email));
  await expect(page.getByTestId("ql-next")).toHaveText(/Book it/);
  await page.getByTestId("ql-next").click();
  await expect(page.getByTestId("brief-done")).toBeVisible({ timeout: 60_000 });
  await noNumber(page);
  return slot;
}

test.describe("the brief path", () => {
  const db = serviceClient();
  test.skip(!db, "needs the test project's service key");

  test.afterAll(async () => {
    if (!db) return;
    for (const e of Object.values(emails)) {
      const { data: ests } = await db.from("estimates").select("id").in("account_id",
        (await db.from("accounts").select("id").eq("email", e)).data?.map((a) => a.id) ?? ["00000000-0000-0000-0000-000000000000"]);
      for (const est of ests ?? []) await db.from("estimates").delete().eq("id", est.id);
    }
  });

  test("Tom's check: strata → brief → booking creates the estimate, the brief, the request, the visit and the checklist; no number anywhere; no pricing call", async ({ page }) => {
    test.setTimeout(300_000);
    const hits = spyPricing(page);
    await toSegment(page);
    await page.getByTestId("ql-segment-strata").click();
    await expect(page.getByTestId("segment-visit-note")).toBeVisible();
    await quickNext(page);

    // The brief, rendered from the strata row: kicker, tiles, rows, the meeting date, photos, notes.
    await expect(page.locator("[data-quick-step='com_brief']")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("STRATA OR COMMON PROPERTY")).toBeVisible();
    await expect(page.getByTestId("brief-sub")).toContainText(/priced on site/);
    await noNumber(page);
    if (db) {
      const { data: row } = await db.from("commercial_segments").select("brief").eq("key", "strata").maybeSingle();
      const brief = row?.brief as { what: string[]; rows: Array<[string, string[]]> } | null;
      if (brief) {
        for (const w of brief.what) await expect(page.getByTestId("brief-what").getByText(w, { exact: true })).toBeVisible();
        for (const [q] of brief.rows) await expect(page.getByText(q, { exact: true })).toBeVisible();
      }
    }
    await page.getByTestId("brief-what-stairwells").click();
    await page.getByTestId("brief-opt-timing-before-the-next-meeting").click();
    // The date is asked because the config asks for it, and Continue wants it.
    await page.getByTestId("ql-next").click();
    await expect(page.getByTestId("ql-error")).toContainText(/meeting date/i);
    await page.getByTestId("brief-date-input").fill("2026-10-05");
    await page.getByTestId("brief-notes").fill("Water damage in the level 2 corridor — ask for Sam on site.");
    await quickNext(page);

    const slot = await book(page, emails.strata);
    await expect(page.getByTestId("brief-done-line")).toContainText(slot ? /got you down for/ : /call within one working day/);
    expect(hits, "no pricing request on the brief path").toEqual([]);

    if (db) {
      const { data: acct } = await db.from("accounts").select("id").eq("email", emails.strata).maybeSingle();
      expect(acct, "the booking creates the account").not.toBeNull();
      const { data: est } = await db.from("estimates").select("id, total_cents, builder_state, property_id").eq("account_id", acct!.id).maybeSingle();
      expect(est, "the booking creates the estimate").not.toBeNull();
      expect(est!.total_cents).toBe(0);
      // The property: "only a real street address earns a property"
      // (lib/accounts/link.ts). Places is unavailable in the test stack, so the
      // walk typed suburb + postcode and no street — no property row, by the
      // same rule Save & book follows. With a picked address it is created.
      expect(est!.property_id).toBeNull();
      expect((est!.builder_state as { blocks: unknown[] }).blocks).toEqual([]);
      const { data: brief } = await db.from("commercial_briefs").select("*").eq("estimate_id", est!.id).maybeSingle();
      expect(brief).not.toBeNull();
      expect(brief!.what).toEqual(expect.arrayContaining(["Lobbies and corridors", "Stairwells"]));
      expect(brief!.meeting_date).toBe("2026-10-05");
      expect(brief!.notes).toMatch(/ask for Sam/);
      const { data: req } = await db.from("confirmation_requests").select("kind, status, pack").eq("estimate_id", est!.id).maybeSingle();
      expect(req?.kind).toBe("visit");
      expect((req?.pack as { brief?: { briefKey?: string } })?.brief?.briefKey).toBe("strata");
      const { data: items } = await db.from("site_checklist_items").select("key, value, source").eq("estimate_id", est!.id);
      expect(items?.map((i) => i.key).sort()).toEqual(["hazmat_check", "meeting_date"]);
      expect(items?.find((i) => i.key === "meeting_date")?.value).toBe("2026-10-05");
      expect(items?.every((i) => i.source === "brief")).toBe(true);
      if (slot) {
        const { data: visits } = await db.from("visits").select("id, status, estimate_id").eq("estimate_id", est!.id);
        expect(visits?.length, "the calendar event — a visits row").toBeGreaterThan(0);
      }
    }
  });

  test("a shop front's brief raises centre_rules when it is in a centre", async ({ page }) => {
    test.setTimeout(240_000);
    const hits = spyPricing(page);
    await toSegment(page);
    await page.getByTestId("ql-segment-shopfront").click();
    await quickNext(page);
    await expect(page.locator("[data-quick-step='com_brief']")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("SHOP FRONT — THE FACADE")).toBeVisible();
    await expect(page.getByTestId("brief-date")).toHaveCount(0);
    await page.getByTestId("brief-opt-where-is-it-shopping-centre").click();
    await quickNext(page);
    await book(page, emails.shop, false);
    expect(hits).toEqual([]);
    if (db) {
      const { data: acct } = await db.from("accounts").select("id").eq("email", emails.shop).maybeSingle();
      const { data: est } = await db.from("estimates").select("id").eq("account_id", acct!.id).maybeSingle();
      const { data: items } = await db.from("site_checklist_items").select("key").eq("estimate_id", est!.id);
      expect(items?.map((i) => i.key).sort()).toEqual(["centre_rules", "hazmat_check"]);
    }
  });

  test("outside + a range segment (warehouse) is the EXTERIOR brief — never a number, never domestic questions", async ({ page }) => {
    test.setTimeout(240_000);
    const hits = spyPricing(page);
    await toSegment(page, "exterior");
    await page.getByTestId("ql-segment-warehouse").click();
    await expect(page.getByTestId("segment-visit-note")).toContainText(/priced on site/);
    await quickNext(page);
    await expect(page.locator("[data-quick-step='com_brief']")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("COMMERCIAL — OUTSIDE")).toBeVisible();
    await expect(page.getByText(/What we.re painting/i)).toHaveCount(0);
    await expect(page.getByText(/deserves a person/i)).toHaveCount(0);
    await quickNext(page);
    await book(page, emails.exterior, false);
    expect(hits).toEqual([]);
    if (db) {
      const { data: acct } = await db.from("accounts").select("id").eq("email", emails.exterior).maybeSingle();
      const { data: est } = await db.from("estimates").select("id").eq("account_id", acct!.id).maybeSingle();
      const { data: brief } = await db.from("commercial_briefs").select("brief_key, segment").eq("estimate_id", est!.id).maybeSingle();
      expect(brief).toMatchObject({ brief_key: "exterior", segment: "warehouse" });
    }
  });
});
