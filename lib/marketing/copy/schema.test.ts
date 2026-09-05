import { describe, it, expect } from "vitest";
import { CONTENT_FIELDS, missingKeys } from "./schema";
import { HOME_COPY } from "./home";
import { BUSINESS_COPY } from "./business";
import { mergeCopy } from "./index";

describe("site copy sets (session 8 §3)", () => {
  it("both sets carry every field in the schema", () => {
    expect(missingKeys(HOME_COPY)).toEqual([]);
    expect(missingKeys(BUSINESS_COPY)).toEqual([]);
  });
  it("no em dashes anywhere (Tom, 5 Sep) and no semicolons in headings", () => {
    for (const set of [HOME_COPY, BUSINESS_COPY]) {
      for (const f of CONTENT_FIELDS) expect(set[f.section][f.key], `${f.section}.${f.key}`).not.toMatch(/—/);
    }
  });
  it("the home H1 is the one the skeleton spec asserts, line-broken", () => {
    expect(HOME_COPY.hero.h1).toBe("Transforming spaces.\nRedefining painting.");
  });
  it("rows lay over the defaults; blanks and unknown sections are ignored", () => {
    const c = mergeCopy("business", [
      { section: "faq", key: "a_1", value: "Yes, most weeks." },
      { section: "faq", key: "a_2", value: "  " },
      { section: "nope", key: "x", value: "y" },
    ]);
    expect(c.faq.a_1).toBe("Yes, most weeks.");
    expect(c.faq.a_2).toBe(BUSINESS_COPY.faq.a_2);
    expect(c.hero.h1).toBe(BUSINESS_COPY.hero.h1);
  });
});
