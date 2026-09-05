import { test, expect } from "vitest";
import { parseVideoUrl } from "./video";

test("YouTube in its usual shapes → privacy-enhanced embed", () => {
  for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ?si=x"]) {
    const v = parseVideoUrl(u)!;
    expect(v.provider).toBe("youtube");
    expect(v.id).toBe("dQw4w9WgXcQ");
    expect(v.embedUrl.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe(true);
    expect(v.thumbnailUrl).toContain("i.ytimg.com");
  }
});

test("Vimeo → dnt player; junk → null", () => {
  const v = parseVideoUrl("https://vimeo.com/123456789")!;
  expect(v.provider).toBe("vimeo");
  expect(v.embedUrl).toBe("https://player.vimeo.com/video/123456789?dnt=1&autoplay=1");
  expect(parseVideoUrl("https://example.com/video.mp4")).toBeNull();
  expect(parseVideoUrl("not a url")).toBeNull();
  expect(parseVideoUrl("")).toBeNull();
});
