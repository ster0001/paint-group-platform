import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Tom, 18 Sep 2026: "add a separate attachment in the estimate to that
 * particular job with a SWMS sheet — when the customer sees it in their
 * estimate, they can click to download the SWMS next to where our public
 * liability policy is". Staff attach a PDF in Job settings; the anonymous
 * customer downloads it from the trust cards.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
// The smallest valid PDF there is.
const PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

test.describe("SWMS attached to an estimate", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  let id = "";
  const token = `swms${run}${randomBytes(8).toString("hex")}`;
  let path = "";

  test.beforeAll(async () => {
    const r = await db!.from("estimates").insert({
      title: `SWMS ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: token,
      builder_state: {
        blocks: [{ id: 1, kind: "area", name: "Office", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4, isOption: false, description: "", open: false, media: [],
          surfaces: [{ id: 11, code: "Walls", coats: 2, count: 0, prepHr: 0, internalLabel: "Walls", clientLabel: "Walls", measureL: null, measureH: null, qtyOverride: null, rateOverride: null, paintingHrOverride: null, priceOverride: null, productName: null, color: "", colorHex: "", coverageOverride: null, volumeOverride: null, unitPriceOverride: null, crewNote: "", hideQty: false, showCoats: true, showPrice: false, useCustomRate: false, customRate: null, open: false, media: [], hidden: false }] }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {},
      },
    }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    id = r.data.id;
  });
  test.afterAll(async () => {
    if (path) await db!.storage.from("presentation-docs").remove([path]);
    if (id) await db!.from("estimates").delete().eq("id", id);
  });

  test("staff attach the PDF in Job settings; it saves to the state and the customer's copy", async ({ page }) => {
    await signIn(page, staff!, /\/(estimates|crm|quote|$)/);
    await page.goto(`/quote?id=${id}`);
    await page.waitForLoadState("networkidle");
    const box = page.getByTestId("swms-attachment");
    await expect(box).toBeVisible();
    await expect(box).toContainText("None attached");
    await page.getByTestId("swms-file").setInputFiles({ name: `SWMS-${run}.pdf`, mimeType: "application/pdf", buffer: PDF });
    await expect(page.getByTestId("swms-current")).toContainText(`SWMS-${run}.pdf`, { timeout: 30_000 });
    await page.getByTestId("builder-save").click();
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("builder_state").eq("id", id).single();
      return (data?.builder_state as { swms?: { path: string; name: string } | null } | null)?.swms?.name ?? null;
    }, { timeout: 20_000 }).toBe(`SWMS-${run}.pdf`);
    const { data } = await db!.from("estimates").select("builder_state, sent_snapshot").eq("id", id).single();
    path = (data!.builder_state as { swms: { path: string } }).swms.path;
    expect(path).toMatch(new RegExp(`^swms/${id}/`));
    const snap = data!.sent_snapshot as { swms: { url: string; label: string } };
    expect(snap.swms.label).toBe(`SWMS-${run}.pdf`);
    expect(snap.swms.url).toContain(`/storage/v1/object/public/presentation-docs/${path}`);
    // The file is really there and really a PDF.
    const { data: blob, error } = await db!.storage.from("presentation-docs").download(path);
    expect(error).toBeNull();
    expect(Buffer.from(await blob!.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("the customer downloads it beside the public liability card", async ({ page }) => {
    await db!.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", id);
    await page.goto(`/e/${token}`);
    await expect(page.locator("details.room").first()).toBeVisible();
    const card = page.getByTestId("swms-card");
    await expect(card).toBeVisible();
    const link = page.getByTestId("swms-download");
    await expect(link).toHaveAttribute("href", new RegExp(`presentation-docs/${path.replace(/\//g, "\\/")}$`));
    // Next to the insurance card: same row of trust cards, right after it.
    const cards = page.locator(".trust .tcard");
    const labels = await cards.locator(".tlab").allTextContents();
    const liability = labels.findIndex((t) => /public liability/i.test(t));
    expect(labels[liability + 1]).toMatch(/Safe Work Method Statement/);
    // The link serves the PDF.
    const res = await page.request.get((await link.getAttribute("href"))!);
    expect(res.ok()).toBeTruthy();
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("removed in the builder → gone from the customer's copy", async ({ page }) => {
    await signIn(page, staff!, /\/(estimates|crm|quote|$)/);
    await page.goto(`/quote?id=${id}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("swms-remove").click();
    await expect(page.getByTestId("swms-attachment")).toContainText("None attached");
    await page.getByTestId("builder-save").click();
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("sent_snapshot").eq("id", id).single();
      const snap = data?.sent_snapshot as { swms?: unknown } | null;
      return snap && "swms" in snap ? snap.swms : "unset";
    }, { timeout: 20_000 }).toBeNull();
    await page.goto(`/e/${token}`);
    await expect(page.locator("details.room").first()).toBeVisible();
    await expect(page.getByTestId("swms-card")).toHaveCount(0);
  });
});
