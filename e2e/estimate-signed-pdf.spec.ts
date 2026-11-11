import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, drawSignature, missingCreds, signIn, test } from "./helpers";

/**
 * Tom, 11 Nov 2026: "when a customer signs an estimate, and I download the
 * estimate from the estimates tab, I am unable to see their signature".
 *
 * The drawn signature was stored on acceptance (estimates.accepted_signature)
 * and read by nothing — the printed estimate drew three blank lines.
 *
 *  1. AS AN ANONYMOUS CUSTOMER: sign and accept; the download straight after
 *     carries the signature, and so does the page opened again later (the
 *     stored one, through estimate_signature_by_token), name and date filled.
 *  2. AS STAFF: the builder's ESTIMATE tab — the copy downloaded from the
 *     Estimates tab — prints the same signature.
 *  3. save_estimate_signature writes only to an accepted estimate.
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const run = `${Math.abs(Date.now() % 1e10)}${process.pid}`;
const ids: string[] = [];

async function seedSent(sb: SupabaseClient, tag: string): Promise<{ id: string; token: string }> {
  const { data: card, error: cardErr } = await sb.from("rate_cards").select("id, version").eq("is_active", true).single();
  if (cardErr || !card) throw new Error(`no active rate card — run scripts/c1/seed.mjs (${cardErr?.message ?? "none"})`);
  const token = `signedpdf${tag}${run}xxxxxxxx`;
  const { data, error } = await sb.from("estimates").insert({
    title: `Signed PDF e2e ${tag}`, status: "sent", sent_at: new Date().toISOString(), level_of_finish: 3,
    share_token: token, rate_card_id: card.id, rate_card_version: card.version, total_cents: 110000,
    builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" } },
    sent_snapshot: {
      version: 1,
      company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
      estRef: `EST-SIG${tag}`, contactName: "Robin Signer", contactEmail: "",
      totals: { totalCents: 110000 }, depositPct: 10,
      jobAddress: `7 Signature St ${run}`, jobTitle: "Interior repaint", gstRatePct: 10,
      baseSubtotalCents: 100000,
      areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
      lineItems: [], options: [], paints: [], inclusions: [], exclusions: [],
      proof: { rating: 4.9, reviews: 100, liability: "$20m", warrantyYears: 2 },
      terms: "",
    },
  }).select("id").single();
  if (error) throw new Error(`fixture estimate: ${error.message}`);
  const id = (data as { id: string }).id;
  ids.push(id);
  return { id, token };
}

test.describe.configure({ mode: "serial" });

test.describe("the signed estimate downloads with the customer's signature", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");
  let est = { id: "", token: "" };

  test.beforeAll(async () => { est = await seedSent(db!, "a"); });

  test.afterAll(async () => {
    if (!db) return;
    for (const id of ids) {
      await db.from("invoices").delete().eq("estimate_id", id);
      await db.from("work_orders").delete().eq("estimate_id", id);
      await db.from("follow_ups").delete().eq("estimate_id", id);
      await db.from("estimate_events").delete().eq("estimate_id", id);
      await db.from("estimates").delete().eq("id", id);
    }
  });

  test("customer: sign, accept, and the PDF carries the signature — then and on a later visit", async ({ page }) => {
    await page.goto(`/e/${est.token}`);
    const sign = page.getByTestId("print-signature");
    await expect(sign).toHaveAttribute("data-signed", "0");

    await page.getByRole("button", { name: "Accept this estimate" }).first().click();
    await page.getByPlaceholder("Your full name").fill("Robin Signer");
    await page.getByTestId("signature-canvas").scrollIntoViewIfNeeded();
    await drawSignature(page);
    await page.getByRole("button", { name: "Accept & continue" }).click();
    await expect(page.locator(".resultbanner.accepted").first()).toBeVisible({ timeout: 20_000 });

    // Straight after signing: the download prints what was just drawn.
    await expect(sign).toHaveAttribute("data-signed", "1");
    await expect(page.getByTestId("print-signature-image")).toHaveAttribute("src", /^data:image\/png;base64,/);

    // Stored, not just remembered by the tab.
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("accepted_signature").eq("id", est.id).single();
      return ((data as { accepted_signature: string | null }).accepted_signature ?? "").slice(0, 22);
    }, { timeout: 15_000 }).toBe("data:image/png;base64,");

    // A later visit, printed: the stored signature, the name and the date on the sheet.
    await page.goto(`/e/${est.token}`);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("print-signature")).toBeVisible();
    await expect(page.getByTestId("print-signature")).toHaveAttribute("data-signed", "1");
    await expect(page.getByTestId("print-signature-image")).toBeVisible();
    await expect(page.getByTestId("print-signature-image")).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(page.getByTestId("print-signature")).toContainText("Robin Signer");
    const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Melbourne" });
    await expect(page.getByTestId("print-signature")).toContainText(today);
    const drawn = await page.getByTestId("print-signature-image").evaluate((img) => (img as HTMLImageElement).naturalWidth);
    expect(drawn).toBeGreaterThan(0);
  });

  test("staff: the builder's ESTIMATE tab prints the same signature", async ({ page }) => {
    test.skip(!staff, missingCreds("STAFF"));
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${est.id}&view=customer`);
    const sign = page.getByTestId("print-signature");
    await expect(sign).toHaveAttribute("data-signed", "1", { timeout: 30_000 });
    await expect(page.getByTestId("print-signature-image")).toHaveAttribute("src", /^data:image\/png;base64,/);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("print-signature-image")).toBeVisible();
    await expect(sign).toContainText("Robin Signer");
  });

  test("a signature is only written to an accepted estimate", async () => {
    const unsigned = await seedSent(db!, "b");
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const r = await db!.rpc("save_estimate_signature", { p_token: unsigned.token, p_signature: png });
    expect(r.error).toBeNull();
    expect(r.data).toBe("not_accepted");
    const read = await db!.rpc("estimate_signature_by_token", { p_token: unsigned.token });
    expect(read.error).toBeNull();
    expect(read.data).toBeNull();
    const bad = await db!.rpc("save_estimate_signature", { p_token: est.token, p_signature: "https://example.test/x.png" });
    expect(bad.data).toBe("bad_signature");
  });
});
