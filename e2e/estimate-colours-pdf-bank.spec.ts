import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 18 Sep 2026:
 *  - "if all colours are entered, remove 'Colour consultation included' from
 *    the bar at the top of the estimate";
 *  - "in the download PDF on the estimate, attach our ABN and bank details".
 * As the anonymous customer, on the token page: one snapshot with every colour
 * decided (no callout), one with a TBC (callout stays); the print document
 * carries the ABN and the bank details from Settings.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");

const paint = (over: Record<string, unknown>) => ({
  name: "Expressions", brand: "Haymes", category: "Interior walls", role: "Walls", finish: "Matt",
  colourName: "", colourHex: "", blurb: "", properties: [], guarantee: "", photoUrl: "",
  customerVisible: true, isPrep: false, usage: ["Walls · 1 area"], colours: [], ...over,
});
const snapshot = (paints: unknown[]) => ({
  version: 1,
  company: { name: "Paint Group", addressLine1: "1 Test St", addressLine2: "", phone: "03 9000 0000", abn: "12 345 678 901", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: "Colour Customer", contactEmail: "", jobTitle: "Interior repaint", jobAddress: `9 Swatch St ${run}`, gstRatePct: 10, depositPct: 10,
  baseSubtotalCents: 100000,
  areas: [{ id: "1", title: "Living room", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "Expressions" }], photos: [] }],
  lineItems: [], options: [], paints, inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
});

test.describe("colour consultation callout + the PDF's payment details", () => {
  test.skip(!db, "service key needed for the fixtures");
  const ids: string[] = [];
  const doneToken = `col${run}done${randomBytes(6).toString("hex")}`;
  const tbcToken = `col${run}tbc${randomBytes(6).toString("hex")}`;
  let bank: Record<string, string> = {};

  test.beforeAll(async () => {
    const fixtures: [string, unknown[]][] = [
      [doneToken, [paint({ colourName: "Natural White", colours: [{ name: "Natural White", hex: "#eee", match: false, areas: ["Living room"] }] }), paint({ name: "Sealer", category: "Prep", isPrep: true })]],
      [tbcToken, [paint({ colourName: "" })]],
    ];
    for (const [token, paints] of fixtures) {
      const r = await db!.from("estimates").insert({
        title: `Colours ${run}`, status: "sent", source: "manual", level_of_finish: 3, share_token: token,
        sent_at: new Date().toISOString(), total_cents: 110000,
        builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
        sent_snapshot: snapshot(paints),
      }).select("id").single();
      if (r.error) throw new Error(r.error.message);
      ids.push(r.data.id);
    }
    const { data } = await db!.from("settings").select("value").eq("key", "invoicing_bank").maybeSingle();
    bank = ((data as { value?: Record<string, string> } | null)?.value ?? {}) as Record<string, string>;
  });
  test.afterAll(async () => { for (const id of ids) await db!.from("estimates").delete().eq("id", id); });

  test("every colour decided → no callout; a TBC → the callout stays", async ({ page }) => {
    await page.goto(`/e/${doneToken}`);
    await expect(page.locator("details.room").first()).toBeVisible();
    await expect(page.getByTestId("colour-consultation")).toHaveCount(0);
    await page.goto(`/e/${tbcToken}`);
    await expect(page.locator("details.room").first()).toBeVisible();
    await expect(page.getByTestId("colour-consultation")).toBeVisible();
    await expect(page.getByTestId("colour-consultation")).toContainText("Colour consultation included");
  });

  test("the print document carries the ABN and the bank details from Settings", async ({ page }) => {
    test.skip(!bank.bsb && !bank.acc && !bank.accountName, "the test project has no invoicing_bank setting");
    await page.goto(`/e/${doneToken}`);
    await expect(page.locator("details.room").first()).toBeVisible();
    // The paper quote is print-only (display:none on screen) — read its DOM.
    const pay = page.getByTestId("print-payment-details");
    await expect(pay).toHaveCount(1);
    const text = (await pay.innerText().catch(() => "")) || (await pay.textContent()) || "";
    expect(text).toContain("ABN 12 345 678 901");
    if (bank.accountName) expect(text).toContain(bank.accountName);
    if (bank.bsb) expect(text).toContain(bank.bsb);
    if (bank.acc) expect(text).toContain(bank.acc);
    // And it really prints: emulate print media and the block is visible.
    await page.emulateMedia({ media: "print" });
    await expect(pay).toBeVisible();
    await expect(page.getByTestId("colour-consultation")).toHaveCount(0);
  });
});
