import { describe, expect, it } from "vitest";
import { imagesOnly, isVideoUrl, videoExtensionForMime } from "./video";

describe("isVideoUrl — the extension is the record", () => {
  it("names a video by its extension, any case, with or without a query string", () => {
    expect(isVideoUrl("https://x.supabase.co/storage/v1/object/public/estimate-media/abc.mp4")).toBe(true);
    expect(isVideoUrl("https://x.supabase.co/storage/v1/object/public/estimate-media/abc.MOV")).toBe(true);
    expect(isVideoUrl("wo/123/1700000000-abcd1234.webm")).toBe(true);
    expect(isVideoUrl("https://x.test/estimate-media/clip.m4v?t=1#x")).toBe(true);
  });
  it("leaves photos alone — image extensions, bare work-order paths, data URLs", () => {
    expect(isVideoUrl("https://x.test/estimate-media/abc.jpg")).toBe(false);
    expect(isVideoUrl("https://x.test/estimate-media/abc.heic")).toBe(false);
    expect(isVideoUrl("wo/123/1700000000-abcd1234")).toBe(false);
    expect(isVideoUrl("data:image/svg+xml;utf8,<svg/>")).toBe(false);
    // The query string is not the path: a photo served with ?v=1.mp4 is still a photo.
    expect(isVideoUrl("https://x.test/estimate-media/abc.jpg?name=clip.mp4")).toBe(false);
  });
});

describe("imagesOnly — what a surface that cannot play video keeps", () => {
  it("drops the videos and keeps order", () => {
    expect(imagesOnly(["a.jpg", "b.mp4", "c.png", "d.mov"])).toEqual(["a.jpg", "c.png"]);
    expect(imagesOnly([])).toEqual([]);
  });
});

describe("videoExtensionForMime", () => {
  it("maps the three types the buckets allow, plus m4v, and nothing else", () => {
    expect(videoExtensionForMime("video/mp4")).toBe("mp4");
    expect(videoExtensionForMime("video/quicktime")).toBe("mov");
    expect(videoExtensionForMime("video/webm")).toBe("webm");
    expect(videoExtensionForMime("VIDEO/X-M4V")).toBe("m4v");
    expect(videoExtensionForMime("image/jpeg")).toBeNull();
    expect(videoExtensionForMime(undefined)).toBeNull();
  });
});
