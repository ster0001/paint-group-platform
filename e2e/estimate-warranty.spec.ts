import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 19 Sep 2026: "I would also like them to see it in the estimate view as
 * well along with the SWMS and public liability etc" — the two-year
 * workmanship warranty, promised on the estimate the customer is deciding on,
 * not first met after the job is signed off. Same ruling: the warranty is
 * active for everybody, and it does NOT transfer to a new owner.
 *
 * Anonymous customer throughout: this is the surface a buyer reads.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");

/** A warrantor with its details filled in — clauses 1 and 5 render these. */
const COMPANY = {
  name: "Paint Group Pty Ltd", addressLine1: "1 Example St", addressLine2: "Melbourne VIC",
  phone: "(03) 9000 0000", abn: "11 222 333 444", email: "hello@example.com",
  estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "",
};

const SNAPSHOT = {
  version: 1,
  company: COMPANY,
  contactName: "Warranty Customer", contactEmail: "", jobTitle: "Interior repaint",
  gstRatePct: 10, depositPct: 10,
  lineItems: [], options: [], paints: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 100000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
};

test.describe("the warranty on the customer's estimate", () => {
  test.skip(!db, "needs the service key");
  let id = "";
  const token = `warr${run}${randomBytes(8).toString("hex")}`;

  test.beforeAll(async () => {
    const r = await db!.from("estimates").insert({
      title: `Warranty ${run}`, status: "sent", source: "manual", level_of_finish: 3, share_token: token,
      sent_at: new Date().toISOString(), total_cents: 110000,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
      sent_snapshot: { ...SNAPSHOT, estRef: `EST-W${run}`, jobAddress: `7 Warranty St ${run}` },
    }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    id = r.data.id;
  });
  test.afterAll(async () => { if (id) await db!.from("estimates").delete().eq("id", id); });

  test("the warranty card sits in the trust row with public liability", async ({ page }) => {
    await page.goto(`/e/${token}`);
    await expect(page.locator("details.room").first()).toBeVisible();

    const card = page.getByTestId("warranty-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText(/workmanship warranty/i);

    // Beside the insurance, in the same row of trust cards.
    const labels = await page.locator(".trust .tcard .tlab").allTextContents();
    const liability = labels.findIndex((t) => /public liability/i.test(t));
    expect(liability).toBeGreaterThanOrEqual(0);
    expect(labels.findIndex((t) => /workmanship warranty/i.test(t))).toBeGreaterThan(liability);
  });

  test("the card opens the warranty in full, and nothing is a draft", async ({ page }) => {
    await page.goto(`/e/${token}`);
    await expect(page.locator("details.room").first()).toBeVisible();

    await page.getByTestId("warranty-read").click();
    const terms = page.getByTestId("warranty-terms");
    await expect(terms).toBeVisible();

    // The clauses a warranty against defects must carry (ACL reg 90) —
    // including WHO gives it: a blank ABN or address in Settings is the
    // failure mode that would publish an unnamed warrantor.
    await expect(terms).toContainText(/Who gives this warranty/i);
    await expect(terms).toContainText("Paint Group Pty Ltd");
    await expect(terms).toContainText("11 222 333 444");
    await expect(terms).toContainText("1 Example St");
    await expect(terms).toContainText("(03) 9000 0000");
    await expect(terms).toContainText(/How to make a claim/i);
    await expect(terms).toContainText(/Making a claim costs you nothing/i);
    await expect(terms).toContainText(/Australian Consumer Law/i);

    // Approved 19 Sep 2026 — no watermark anywhere on a customer's estimate.
    await expect(page.locator(".draftwrap")).toHaveCount(0);
    await expect(page.getByText(/AWAITING LEGAL REVIEW/i)).toHaveCount(0);
  });

  test("the warranty does not transfer to a new owner, and no clause is unfinished", async ({ page }) => {
    await page.goto(`/e/${token}`);
    await page.getByTestId("warranty-read").click();
    const terms = page.getByTestId("warranty-terms");

    await expect(terms).toContainText(/does not transfer/i);
    // The clause that used to say the decision was still open.
    await expect(terms).not.toContainText(/being finalised/i);
  });

  test("the printed quote carries the warranty too", async ({ page }) => {
    await page.goto(`/e/${token}`);
    await expect(page.locator("details.room").first()).toBeVisible();
    const block = page.getByTestId("print-warranty");
    await expect(block).toHaveCount(1);
    await expect(block).toContainText(/two years/i);
    await expect(block).toContainText(/Australian Consumer Law/i);
  });
});
