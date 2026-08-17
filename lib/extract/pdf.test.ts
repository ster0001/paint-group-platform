/**
 * The PDF half of stage 1, against a real (tiny) PDF.
 *
 * The fixture is a hand-built two-page document — page 1 reads like a floor
 * plan, page 2 like an elevation — carrying no customer data. It exists so the
 * rasteriser, the text layer and the page routing are all proven together
 * without needing a real customer's plan in the repo.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readPdf, RENDER_DPI } from "./pdf.ts";

const pdf = new Uint8Array(readFileSync(new URL("./__fixtures__/two-page-plan.pdf", import.meta.url)));

test("counts pages and renders every one", async () => {
  const r = await readPdf(pdf);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.pageCount).toBe(2);
  expect(r.pages).toHaveLength(2);
});

test("renders A4 at the DPI we asked for, not whatever the PDF says", async () => {
  const r = await readPdf(pdf);
  if (!r.ok) throw new Error(r.message);
  const page = r.pages[0];
  // 595pt wide at 200 DPI = 595/72*200 ≈ 1653 px.
  expect(page.widthPx).toBe(Math.round((595 / 72) * RENDER_DPI));
  expect(page.heightPx).toBeGreaterThan(page.widthPx); // portrait
});

test("both renditions are real PNGs, and the thumbnail is the smaller one", async () => {
  const r = await readPdf(pdf);
  if (!r.ok) throw new Error(r.message);
  const { png, thumbPng } = r.pages[0];
  const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  expect(isPng(png)).toBe(true);
  expect(isPng(thumbPng)).toBe(true);
  expect(thumbPng.length).toBeLessThan(png.length);
});

test("lifts the text layer exactly — this is what removes the OCR guesswork", async () => {
  const r = await readPdf(pdf);
  if (!r.ok) throw new Error(r.message);
  // The dimension string comes back as characters, not pixels to be read.
  expect(r.pages[0].text).toContain("3.60 x 4.20");
  expect(r.pages[1].text).toContain("ELEVATION");
});

test("routes each page by what it actually is", async () => {
  const r = await readPdf(pdf);
  if (!r.ok) throw new Error(r.message);
  expect(r.pages[0].classification.pageClass).toBe("floorplan_interior");
  expect(r.pages[1].classification.pageClass).toBe("elevation");
  expect(r.pages[0].classification.fromTextLayer).toBe(true);
});

test("honours a page cap rather than rendering a whole vendor's statement", async () => {
  const r = await readPdf(pdf, { maxPages: 1 });
  if (!r.ok) throw new Error(r.message);
  expect(r.pageCount).toBe(2);   // still reports the truth about the document
  expect(r.pages).toHaveLength(1); // but only renders what it was told to
});

test("a file that isn't a PDF is refused with something a person can act on", async () => {
  const r = await readPdf(new TextEncoder().encode("this is not a pdf"));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toMatch(/couldn't be opened|password/i);
});
