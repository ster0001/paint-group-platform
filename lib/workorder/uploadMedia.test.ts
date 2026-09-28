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
