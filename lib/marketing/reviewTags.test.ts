import { describe, it, expect } from "vitest";
import { pickReviews, reviewKey, suggestAudience } from "./reviewTags";

const r = (author: string, rating: number, text: string, publishedAt = "2026-08-01T00:00:00Z") => ({ author, rating, text, publishedAt });
const tag = (x: ReturnType<typeof r>, audience: "home" | "business" | null) => ({ review_key: reviewKey(x), audience, audience_suggested: null });

describe("review tagging (session 8 §5)", () => {
  it("guesses business from the words that only businesses use, home from home words, else nothing", () => {
    expect(suggestAudience("Painted our office over a weekend")).toBe("business");
    expect(suggestAudience("The tenants were happy, PO 4471 on the invoice")).toBe("business");
    expect(suggestAudience("Our home looks brand new, every bedroom")).toBe("home");
    expect(suggestAudience("Great work, on time")).toBeNull();
  });
  it("home shows tagged-home and untagged; business shows tagged-business", () => {
    const a = r("A", 5, "office"), b = r("B", 5, "home"), c = r("C", 4, "x"), d = r("D", 5, "y"), e = r("E", 3, "z");
    const tags = [tag(a, "business"), tag(b, "home"), tag(c, "business"), tag(d, "business")];
    expect(pickReviews([a, b, c, d, e], tags, "home").reviews.map((x) => x.author)).toEqual(["B", "E"]);
    const biz = pickReviews([a, b, c, d, e], tags, "business");
    expect(biz.fallback).toBe(false);
    expect(biz.reviews.map((x) => x.author)).toEqual(["A", "C", "D"]);
  });
  it("fewer than three business: the best untagged fill in and the header changes", () => {
    const a = r("A", 5, "office"), b = r("B", 5, "home"), c = r("C", 4, "x"), d = r("D", 5, "y", "2026-09-01T00:00:00Z"), e = r("E", 3, "z");
    const tags = [tag(a, "business"), tag(b, "home")];
    const biz = pickReviews([a, b, c, d, e], tags, "business");
    expect(biz.fallback).toBe(true);
    expect(biz.reviews.map((x) => x.author)).toEqual(["A", "D", "C"]); // business first, then best untagged (5 newest, then 4)
    expect(biz.reviews).not.toContainEqual(b);
  });
});
