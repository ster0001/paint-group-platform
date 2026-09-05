import { test, expect } from "vitest";
import { EMPTY_WEBSITE_CONTENT, parseWebsiteContent, websiteContentSchema } from "./siteContent";

test("a partial or missing row renders the defaults, never throws", () => {
  expect(parseWebsiteContent(undefined)).toEqual(EMPTY_WEBSITE_CONTENT);
  expect(parseWebsiteContent({ painters: [{ name: "Felipe M.", specialty: "Interiors, heritage", since: "2024" }] }).painters[0]).toMatchObject({ name: "Felipe M.", since: "2024", quote: "", photoPath: null });
  expect(parseWebsiteContent({ painters: [{ name: "" }] })).toEqual(EMPTY_WEBSITE_CONTENT); // invalid → defaults
});

test("no ratings or job counts can be stored — the shape has no field for them", () => {
  const p = parseWebsiteContent({ painters: [{ name: "Adi S.", rating: 4.9, jobs: 120 }] }).painters[0];
  expect(p).not.toHaveProperty("rating");
  expect(p).not.toHaveProperty("jobs");
});

test("a pasted testimonial video must be a YouTube or Vimeo link (Tom, 6 Sep); empty means none", () => {
  expect(websiteContentSchema.safeParse({ featuredVideo: { url: "https://youtu.be/dQw4w9WgXcQ", caption: "Sarah, Malvern East" } }).success).toBe(true);
  expect(websiteContentSchema.safeParse({ featuredVideo: { url: "https://example.com/video.mp4" } }).success).toBe(false);
  expect(parseWebsiteContent({ featuredVideo: { url: "" } }).featuredVideo).toEqual({ url: "", caption: "", transcript: "", posterPath: null });
});
