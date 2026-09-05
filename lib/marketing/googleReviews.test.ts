import { test, expect } from "vitest";
import { trimReview } from "./googleReviews";

test("short reviews pass through untouched; long ones are cut at a sentence and flagged", () => {
  expect(trimReview("Very friendly team at paint group")).toEqual({ text: "Very friendly team at paint group", trimmed: false });
  const long = "First sentence here. ".repeat(40);
  const r = trimReview(long, 200);
  expect(r.trimmed).toBe(true);
  expect(r.text.length).toBeLessThanOrEqual(200);
  expect(r.text.endsWith(".")).toBe(true);
  expect(long.startsWith(r.text)).toBe(true); // never rewritten
});

test("with no sentence end in reach it cuts at a word, never mid-word", () => {
  const r = trimReview("one two three four five six seven eight nine ten eleven twelve thirteen", 40);
  expect(r.trimmed).toBe(true);
  expect(r.text).toBe("one two three four five six seven eight");
});
