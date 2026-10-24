import { describe, expect, it } from "vitest";
import { PAINTHOME_COPY } from "./painthome";
import { CONTENT_FIELDS } from "./schema";
import { BRAND_DEFAULTS } from "../brand";

/**
 * Paint Home brief §1a + §4 AC — the words themselves:
 *  - no string contains "business", "commercial", "agent", "PO", "portfolio"
 *    or "trade" outside the big-job FAQ answer;
 *  - "Paint Group" appears in exactly ONE place in the copy (the end of
 *    "Who is Paint Home?"). The other three mentions are the brand chrome
 *    (nav small print, reviews credit, footer), so the page carries four.
 *  - the voice: no exclamation marks, no rhetorical questions in headings,
 *    none of Paint Group's system words or the banned slang.
 */
const every = () => CONTENT_FIELDS.map((f) => ({ id: `${f.section}.${f.key}`, v: PAINTHOME_COPY[f.section][f.key] ?? "" })).filter((x) => x.v);

describe("Paint Home copy (brief §1a, §4)", () => {
  it("never says business, commercial, agent, PO, portfolio or trade, except the big-job answer", () => {
    const banned = /\b(business|businesses|commercial|agent|agents|PO|portfolio|trade)\b/i;
    for (const { id, v } of every()) {
      if (id === "faq.a_5") { expect(v).toMatch(/commercial property/); continue; }
      expect(v, id).not.toMatch(banned);
    }
  });
  it("names Paint Group exactly once, at the end of 'Who is Paint Home?'", () => {
    const hits = every().filter(({ v }) => v.includes("Paint Group"));
    expect(hits.map((h) => h.id)).toEqual(["faq.a_1"]);
    expect(PAINTHOME_COPY.faq.a_1).toMatch(/Paint Home is powered by Paint Group\. Enlvn Pty Ltd trading as Paint Home\.$/);
    // the chrome supplies the other three
    expect(BRAND_DEFAULTS.painthome.poweredBy).toBe("Paint Group");
  });
  it("the voice: statements, no exclamation marks, no system words or slang", () => {
    const slang = /\b(ring|lock it in|turn up|pop in|mateship)\b/i;
    const system = /\b(estimate builder|variation request|work order|scope of works)\b/i;
    for (const { id, v } of every()) {
      expect(v, id).not.toMatch(/!/);
      expect(v, id).not.toMatch(slang);
      expect(v, id).not.toMatch(system);
    }
    for (const h of [PAINTHOME_COPY.how_it_works.h2, PAINTHOME_COPY.jobs.h2, PAINTHOME_COPY.painters.h2, PAINTHOME_COPY.cta.h2, PAINTHOME_COPY.reviews.h2]) expect(h).not.toMatch(/\?/);
    expect(PAINTHOME_COPY.hero.h1).toBe("Your qualified\nlocal painters.");
  });
  it("the structural differences the brief lists: Inside / Outside chips, ten FAQs, no trade lane, no other-site link, four phone-close examples", () => {
    expect(PAINTHOME_COPY.hero.chip_interior).toBe("Inside");
    expect(PAINTHOME_COPY.hero.chip_exterior).toBe("Outside");
    expect(PAINTHOME_COPY.hero.chip_business).toBe("");
    expect(PAINTHOME_COPY.faq.q_1).toBe("Who is Paint Home?");
    expect(PAINTHOME_COPY.faq.q_10).toBeTruthy();
    expect(Object.values(PAINTHOME_COPY.trade).every((v) => v === "")).toBe(true);
    expect(PAINTHOME_COPY.nav.other_audience_label).toBe("");
    expect(PAINTHOME_COPY.nav.link_3_href).toBe("#painters");
    for (const n of [1, 2, 3, 4]) {
      expect(PAINTHOME_COPY.estimator_examples[`example_${n}_scope`]).toMatch(/^(interior|exterior)$/);
      // every example sits under the default phone-close ceiling ($12,000)
      const top = Number(PAINTHOME_COPY.estimator_examples[`example_${n}_price`].split("–")[1].replace(/[^\d]/g, ""));
      expect(top).toBeLessThanOrEqual(12_000);
    }
  });
});
