import { test, expect } from "vitest";
import { parseWebsiteContent } from "./siteContent";

test("a partial or missing row renders the defaults, never throws", () => {
  expect(parseWebsiteContent(undefined)).toEqual({ painters: [], promisePhotos: [], storyPhotos: [], heroPhoto: null, featuredVideoJobId: null });
  expect(parseWebsiteContent({ painters: [{ name: "Felipe M.", specialty: "Interiors, heritage", since: "2024" }] }).painters[0]).toMatchObject({ name: "Felipe M.", since: "2024", quote: "", photoPath: null });
  expect(parseWebsiteContent({ painters: [{ name: "" }] })).toEqual({ painters: [], promisePhotos: [], storyPhotos: [], heroPhoto: null, featuredVideoJobId: null }); // invalid → defaults
});

test("no ratings or job counts can be stored — the shape has no field for them", () => {
  const p = parseWebsiteContent({ painters: [{ name: "Adi S.", rating: 4.9, jobs: 120 }] }).painters[0];
  expect(p).not.toHaveProperty("rating");
  expect(p).not.toHaveProperty("jobs");
});
