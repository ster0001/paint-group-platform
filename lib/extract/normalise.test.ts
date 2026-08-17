import { test, expect } from "vitest";
import { sniffKind, normaliseUpload, classifyPage, MAX_UPLOAD_BYTES } from "./normalise.ts";

const bytesOf = (...nums: number[]) => new Uint8Array([...nums, ...new Array(16).fill(0)]);
const PDF = bytesOf(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34);
const JPEG = bytesOf(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);

// ---- what the bytes say -----------------------------------------------------

test("recognises the formats a plan or photo actually arrives in", () => {
  expect(sniffKind(PDF)).toBe("pdf");
  expect(sniffKind(JPEG)).toBe("jpeg");
  expect(sniffKind(PNG)).toBe("png");
  expect(sniffKind(HEIC)).toBe("heic");
  expect(sniffKind(WEBP)).toBe("webp");
});

test("a text file renamed to .pdf is refused, whatever it claims to be", () => {
  const html = new TextEncoder().encode("<html><body>not a plan</body></html>");
  expect(sniffKind(html)).toBeNull();
  const r = normaliseUpload(html, "application/pdf", "floorplan.pdf");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toMatch(/doesn't look like a plan/i);
});

test("the declared type is never trusted over the bytes", () => {
  // A phone claiming a HEIC is a JPEG, which happens constantly.
  const r = normaliseUpload(HEIC, "image/jpeg", "IMG_0001.JPG");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.kind).toBe("heic");
});

test("refuses an empty file and one over 25 MB", () => {
  expect(normaliseUpload(new Uint8Array(0)).ok).toBe(false);
  const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  huge.set([0x25, 0x50, 0x44, 0x46]);
  const r = normaliseUpload(huge);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toMatch(/25 MB/);
});

test("a truncated header is refused rather than guessed at", () => {
  expect(sniffKind(new Uint8Array([0x25, 0x50]))).toBeNull();
});

// ---- what the page is -------------------------------------------------------

test("a dimensioned floorplan page is recognised from its text", () => {
  const c = classifyPage("GROUND FLOOR PLAN\nBED 1 3.60 x 4.20\nBATH\nKITCHEN\nMEALS\nGARAGE");
  expect(c.pageClass).toBe("floorplan_interior");
  expect(c.confidence).toBeGreaterThan(0.7);
  expect(c.fromTextLayer).toBe(true);
  expect(c.reasons.join(" ")).toMatch(/dimension pairs/);
});

test("an elevation sheet does not go down the room pipeline", () => {
  const c = classifyPage("NORTH ELEVATION\nSCALE 1:100\nEAST ELEVATION");
  expect(c.pageClass).toBe("elevation");
});

test("a site plan is told apart from a floor plan", () => {
  const c = classifyPage("SITE PLAN\nBOUNDARY 32.5m\nSETBACK 6.0m\nALLOTMENT 14");
  expect(c.pageClass).toBe("site_plan");
});

test("an elevation that mentions rooms in its title block is still an elevation", () => {
  const c = classifyPage("SOUTH ELEVATION\nBED 2 BEYOND\nSECTION A-A");
  expect(c.pageClass).toBe("elevation");
});

test("a scanned plan with no text layer is not guessed at", () => {
  const c = classifyPage("");
  expect(c.pageClass).toBe("other");
  expect(c.confidence).toBeLessThan(0.2);
  expect(c.fromTextLayer).toBe(false);
  expect(c.reasons.join(" ")).toMatch(/needs the model/);
});

test("an uploaded photo is a photo without reading anything", () => {
  const c = classifyPage(null, { isImageFile: true });
  expect(c.pageClass).toBe("photo");
  expect(c.fromTextLayer).toBe(false);
});

test("a vendor's statement bound into the same PDF is NOT an elevation", () => {
  // "Section 32" is the Victorian vendor's statement and is routinely in the
  // same file as the plan. A drawing section is "SECTION A-A", not "SECTION 32".
  const c = classifyPage("CONTRACT OF SALE\nVENDOR STATEMENT\nSECTION 32");
  expect(c.pageClass).toBe("other");
});

test("a real drawing section IS an elevation-family page", () => {
  expect(classifyPage("SECTION A-A\nSCALE 1:100").pageClass).toBe("elevation");
  expect(classifyPage("SECTION 1:100 THROUGH LIVING").pageClass).toBe("elevation");
});

test("room names alone, without floor wording, still read as a plan", () => {
  const c = classifyPage("BED 1\nBED 2\nENSUITE\nLIVING\nPANTRY\n3600 X 4200");
  expect(c.pageClass).toBe("floorplan_interior");
});

test("classification always explains itself", () => {
  for (const text of ["GROUND FLOOR PLAN BED KITCHEN BATH 3.6 x 4.2", "NORTH ELEVATION", "SITE PLAN BOUNDARY SETBACK", ""]) {
    expect(classifyPage(text).reasons.length).toBeGreaterThan(0);
  }
});
