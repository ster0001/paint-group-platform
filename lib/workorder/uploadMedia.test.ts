import { describe, expect, it } from "vitest";
import { declaredType, isVideoFile } from "./uploadMedia";

describe("what an upload declares itself as", () => {
  it("uses the browser's type when it has one", () => {
    expect(declaredType({ type: "image/heic", name: "IMG_1.HEIC" })).toBe("image/heic");
    expect(declaredType({ type: "video/quicktime", name: "clip.mov" })).toBe("video/quicktime");
  });
  it("falls back to the extension when the type is blank — the Android HEIC case", () => {
    expect(declaredType({ type: "", name: "IMG_2.heic" })).toBe("image/heic");
    expect(declaredType({ type: "application/octet-stream", name: "shot.PNG" })).toBe("image/png");
    expect(declaredType({ type: "", name: "walk.mp4" })).toBe("video/mp4");
  });
  it("a photo with nothing to go on is sent as JPEG — the server still reads the bytes", () => {
    expect(declaredType({ type: "", name: "blob" })).toBe("image/jpeg");
  });
  it("knows a video from a photo", () => {
    expect(isVideoFile({ type: "", name: "a.mov" })).toBe(true);
    expect(isVideoFile({ type: "image/jpeg", name: "a.jpg" })).toBe(false);
  });
});

describe("stuck-upload hardening (Tom, 30 Sep)", () => {
  it("shrinks a big photo, never a video or a small photo", async () => {
    const { shouldShrink, SHRINK_ABOVE_BYTES } = await import("./uploadMedia");
    expect(shouldShrink({ type: "image/heic", name: "a.heic", size: SHRINK_ABOVE_BYTES + 1 })).toBe(true);
    expect(shouldShrink({ type: "image/jpeg", name: "a.jpg", size: 400_000 })).toBe(false);
    expect(shouldShrink({ type: "video/mp4", name: "a.mp4", size: 50_000_000 })).toBe(false);
  });
  it("caps the long edge at 2000 px and never upscales", async () => {
    const { fitWithin } = await import("./uploadMedia");
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
  });
  it("the button says how far along the photo is", async () => {
    const { uploadingLabel } = await import("./uploadMedia");
    expect(uploadingLabel(null)).toBe("Uploading…");
    expect(uploadingLabel(0.42)).toBe("Uploading… 42%");
    expect(uploadingLabel(1)).toBe("Uploading… filing it");
  });
  it("every step has a deadline, and the store step is a stall timer under a minute", async () => {
    const { UPLOAD_DEADLINES } = await import("./uploadMedia");
    expect(UPLOAD_DEADLINES.sign).toBeGreaterThan(0);
    expect(UPLOAD_DEADLINES.ingest).toBeGreaterThan(0);
    expect(UPLOAD_DEADLINES.storeStall).toBeLessThanOrEqual(60_000);
  });
});
