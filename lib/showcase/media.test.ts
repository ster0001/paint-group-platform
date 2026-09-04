import { test, expect } from "vitest";
import { showcasePathFor } from "./media";

test("photo paths are one folder per job, safe characters, jpg", () => {
  const p = showcasePathFor("abc-123", "IMG 0042 (final).HEIC");
  expect(p).toMatch(/^jobs\/abc-123\/\d+-IMG-0042-final-\.jpg$|^jobs\/abc-123\/\d+-IMG-0042-final\.jpg$/);
  expect(showcasePathFor("k", "....")).toMatch(/^jobs\/k\/\d+-photo\.jpg$/);
  expect(showcasePathFor("k", "x".repeat(200) + ".png").length).toBeLessThan(80);
});
