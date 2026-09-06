import { describe, expect, it } from "vitest";
import { searchIn, searchTerms } from "./search";

const docs = [
  { key: "work-orders/contractor", title: "Run a job from the first tick to the customer's signature", summary: "Photos before ticks, variations, sign-off.", text: "Before you can tick anything in an area, that area needs a before photo. Tap the amber button. The customer signs on your phone." },
  { key: "scheduling/contractor", title: "Answer a job offer", summary: "The 24-hour clock.", text: "An offer lands on Home. Accept — lock it in. Proposed dates go to the office." },
  { key: "self-invoicing/contractor", title: "Invoice Paint Group for a job", summary: "Progress claims and the sign-off invoice.", text: "Pick 25%. Submit invoice — the figures lock." },
];

describe("help search", () => {
  it("splits terms, folds case and dashes, drops one-letter noise", () => {
    expect(searchTerms("Before Photo")).toEqual(["before", "photo"]);
    expect(searchTerms("Accept — lock it in")).toEqual(["accept", "lock", "it", "in"]);
    expect(searchTerms("a")).toEqual([]);
  });

  it("requires every term and ranks title hits above body hits, with a sentence that explains the match", () => {
    const hits = searchIn("before photo", docs);
    expect(hits.map((h) => h.key)).toEqual(["work-orders/contractor"]);
    expect(hits[0].snippet).toContain("needs a before photo");
    const byTitle = searchIn("invoice", docs);
    expect(byTitle[0].key).toBe("self-invoicing/contractor");
  });

  it("returns nothing for an empty query or a term nobody has", () => {
    expect(searchIn("", docs)).toEqual([]);
    expect(searchIn("payables", docs)).toEqual([]);
  });
});
