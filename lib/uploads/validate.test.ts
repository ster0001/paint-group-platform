import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUpload, acceptAttr, UPLOAD_RULES } from "./validate.ts";

const MB = 1024 * 1024;

test("accepts an ordinary certificate", () => {
  assert.equal(checkUpload({ name: "coc.pdf", size: 400_000, type: "application/pdf" }, "document"), null);
});

test("accepts a phone photo of a certificate", () => {
  assert.equal(checkUpload({ name: "IMG_0421.HEIC", size: 3 * MB, type: "image/heic" }, "document"), null);
});

test("refuses an oversized file and says how big it was", () => {
  const msg = checkUpload({ name: "site.mp4", size: 800 * MB, type: "video/mp4" }, "video");
  assert.match(String(msg), /800 MB/);
  assert.match(String(msg), /200 MB/);
});

test("refuses HTML dressed as a certificate", () => {
  assert.notEqual(checkUpload({ name: "cert.html", size: 900, type: "text/html" }, "document"), null);
});

test("refuses SVG everywhere — it can carry script", () => {
  for (const kind of ["image", "document", "video"] as const) {
    assert.notEqual(checkUpload({ name: "logo.svg", size: 2_000, type: "image/svg+xml" }, kind), null);
  }
});

test("refuses an empty file", () => {
  assert.match(String(checkUpload({ name: "cert.pdf", size: 0, type: "application/pdf" }, "document")), /empty/);
});

test("falls back to the extension when the browser gives no type", () => {
  assert.equal(checkUpload({ name: "photo.jpg", size: 1_000, type: "" }, "image"), null);
  assert.notEqual(checkUpload({ name: "notes.txt", size: 1_000, type: "" }, "image"), null);
  assert.notEqual(checkUpload({ name: "mystery", size: 1_000 }, "image"), null);
});

test("a video is not an image, and an image is not a video", () => {
  assert.notEqual(checkUpload({ name: "clip.mp4", size: 1 * MB, type: "video/mp4" }, "image"), null);
  assert.notEqual(checkUpload({ name: "shot.png", size: 1 * MB, type: "image/png" }, "video"), null);
});

test("accept= lists exactly the kind's own MIME types", () => {
  assert.equal(acceptAttr("image"), UPLOAD_RULES.image.mimes.join(","));
  assert.ok(!acceptAttr("image").includes("application/pdf"));
});
