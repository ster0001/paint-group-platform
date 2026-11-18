import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { drawSignature, test } from "../helpers";

/**
 * Success URLs for paid marketing (Tom, 17 Nov 2026), as an anonymous customer.
 *
 *   1 · /thanks/<moment> says thank you, records our own success_page event,
 *       and returns to `back`; a path only — another site is never a target;
 *       an unknown moment is a 404; the hidden-frame visit shows nothing.
 *   2 · Accepting an estimate counts /thanks/accepted behind the page; the
 *       customer stays on their signed estimate.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");

test.describe("Success URLs", () => {
  test("1 · the thanks page: thank you, our own event, back; no open redirect; 404 on an unknown moment", async ({ page }) => {
    const events: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/events") && r.method() === "POST") events.push(r.postData() ?? ""); });
    await page.goto("/thanks/visit?back=%2Fwork");
    await expect(page.getByTestId("thanks-title")).toHaveText("Thanks — we have your visit");
    await expect(page.getByTestId("thanks-back")).toHaveAttribute("href", "/work");
    await page.waitForURL(/\/work$/, { timeout: 10_000 });
    expect(events.some((e) => e.includes("success_page") && e.includes("visit"))).toBe(true);
    // 18 Nov 2026: five more moments — the details given, saved for later, the quote range settled, sent to the estimator, fixed online
    for (const [m, title] of [["lead", "Thanks — we have your details"], ["saved", "Your estimate is saved"], ["quote", "Your quote range is ready"], ["sent", "Thanks — your estimate is with your estimator"], ["fixed", "Your price is fixed"]] as const) {
      await page.goto(`/thanks/${m}?back=%2Fwork`);
      await expect(page.getByTestId("thanks-title")).toHaveText(title);
    }

    await page.goto("/thanks/message?back=%2F%2Fevil.example");
    await expect(page.getByTestId("thanks-back")).toHaveAttribute("href", "/");

    expect((await page.goto("/thanks/nope"))?.status()).toBe(404);

    await page.goto("/thanks/range?bg=1");
    await expect(page.getByTestId("thanks-title")).toHaveCount(0);
    await page.waitForTimeout(2_500);
    expect(new URL(page.url()).pathname).toBe("/thanks/range");
  });

  test("2 · accepting an estimate counts /thanks/accepted behind the page", async ({ page }) => {
    test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
    test.setTimeout(120_000);
    const card = await db!.from("rate_cards").select("id, version").eq("is_active", true).single();
    if (card.error) throw new Error(card.error.message);
    const token = `thanksacc${run}${randomBytes(10).toString("hex")}`;
    const est = await db!.from("estimates").insert({
      title: `Thanks e2e ${run}`, status: "sent", sent_at: new Date().toISOString(), level_of_finish: 3,
      share_token: token, rate_card_id: card.data.id, rate_card_version: card.data.version, total_cents: 110000,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" } },
      sent_snapshot: {
        version: 1,
        company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
        estRef: `EST-THX${run}`, contactName: "Robin Thanks", contactEmail: "",
        totals: { totalCents: 110000 }, depositPct: 10, jobAddress: `7 Thanks St ${run}`, jobTitle: "Interior repaint", gstRatePct: 10, baseSubtotalCents: 100000,
        areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
        lineItems: [], options: [], paints: [], inclusions: [], exclusions: [],
        proof: { rating: 4.9, reviews: 100, liability: "$20m", warrantyYears: 2 }, terms: "",
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    try {
      await page.goto(`/e/${token}`);
      await page.getByRole("button", { name: "Accept this estimate" }).first().click();
      await page.getByPlaceholder("Your full name").fill("Robin Thanks");
      await page.getByTestId("signature-canvas").scrollIntoViewIfNeeded();
      await drawSignature(page);
      await page.getByRole("button", { name: "Accept & continue" }).click();
      await expect(page.locator(".resultbanner.accepted").first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('iframe[data-testid="thanks-bg-accepted"]')).toHaveAttribute("src", "/thanks/accepted?bg=1", { timeout: 10_000 });
      expect(new URL(page.url()).pathname).toBe(`/e/${token}`);
    } finally {
      const id = est.data.id as string;
      await db!.from("invoices").delete().eq("estimate_id", id);
      await db!.from("work_orders").delete().eq("estimate_id", id);
      await db!.from("follow_ups").delete().eq("estimate_id", id);
      await db!.from("estimate_events").delete().eq("estimate_id", id);
      await db!.from("messages").delete().eq("estimate_id", id);
      await db!.from("crm_events").delete().eq("estimate_id", id);
      await db!.from("estimates").delete().eq("id", id);
    }
  });
});
