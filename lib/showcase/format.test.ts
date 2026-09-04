import { test, expect } from "vitest";
import { formatPriceRange, formatCompletedOn, slugify, showcaseMediaUrl } from "./format";

test("price range is AUD whole dollars with an en dash and comma thousands", () => {
  expect(formatPriceRange(840000, 960000)).toBe("$8,400 – $9,600");
  expect(formatPriceRange(1420000, 1580000)).toBe("$14,200 – $15,800");
  expect(formatPriceRange(190050, 230000)).toBe("$1,901 – $2,300"); // rounds, never shows cents
});

test("completed-on is parsed from the DATE text, not through a Date object", () => {
  expect(formatCompletedOn("2026-07-14")).toBe("Jul 2026");
  expect(formatCompletedOn("2026-01-01")).toBe("Jan 2026");
  expect(formatCompletedOn("nonsense")).toBe("");
});

test("slug from title + suburb", () => {
  expect(slugify("Exterior weatherboard", "Thornbury")).toBe("exterior-weatherboard-thornbury");
  expect(slugify("Interior Victorian", "Fitzroy North")).toBe("interior-victorian-fitzroy-north");
  expect(slugify("Café & bar refit!", "St Kilda")).toBe("cafe-and-bar-refit-st-kilda");
  expect(slugify("x".repeat(100), "y").length).toBeLessThanOrEqual(80);
  expect(slugify("", "")).toBe("job-job");
});

test("media url points at the public bucket", () => {
  expect(showcaseMediaUrl("jobs/abc/hero.jpg", "https://x.supabase.co/"))
    .toBe("https://x.supabase.co/storage/v1/object/public/showcase-media/jobs/abc/hero.jpg");
});
