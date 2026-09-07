import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { liveValuesFrom, parseBrainSeed, renderBrainAnswer, tokeniseSeedAnswer } from "./parse";

const seed = readFileSync(new URL("../../docs/brain/brain-v1.md", import.meta.url), "utf8");

describe("the Brain seed parser (D14 import notes)", () => {
  const entries = parseBrainSeed(seed);

  it("reads every ### entry with its slug, question and audience", () => {
    const slugs = entries.map((e) => e.slug);
    expect(slugs).toEqual(expect.arrayContaining(["caulking-gaps", "coats-standard", "deposit", "price-range", "price-validity", "warranty", "service-area", "charge-out-vs-rev", "occupied", "who-comes"]));
    expect(entries.find((e) => e.slug === "deposit")?.audience).toBe("customer");
    expect(entries.find((e) => e.slug === "caulking-gaps")?.audience).toBe("both");
    expect(entries.find((e) => e.slug === "charge-out-vs-rev")?.audience).toBe("staff");
    expect(entries.find((e) => e.slug === "deposit")?.topic).toBe("Money & process");
    // A slug containing the audience word must not leak the heading into the answer.
    for (const slug of ["customer-prep", "customer-supplied-paint"]) {
      const e = entries.find((x) => x.slug === slug)!;
      expect(e.answerMd).not.toContain("·");
      expect(e.answerMd).not.toMatch(/^-/);
    }
    expect(entries.find((e) => e.slug === "customer-prep")?.answerMd).toMatch(/^Please remove artwork/);
  });

  it("[TOM TO WRITE] entries import as needs_content — never a served placeholder", () => {
    const caulking = entries.find((e) => e.slug === "caulking-gaps")!;
    expect(caulking.needsContent).toBe(true);
    expect(caulking.marker).toBe("tom_to_write");
    const oneLiner = entries.find((e) => e.slug === "occupied")!;
    expect(oneLiner.needsContent).toBe(true);
    const deposit = entries.find((e) => e.slug === "deposit")!;
    expect(deposit.needsContent).toBe(false);
    expect(deposit.marker).toBe("plain"); // Tom's wording (v2 seed), not a platform draft
    expect(deposit.answerMd).toMatch(/^A deposit is payable/);
    expect(deposit.answerMd).toContain("{{deposit_pct}}%");
    const range = entries.find((e) => e.slug === "price-range")!;
    expect(range.marker).toBe("platform");
    expect(range.answerMd).not.toContain("[PLATFORM]");
  });

  it("Settings-backed figures become tokens that render the live value", () => {
    const validity = tokeniseSeedAnswer("price-validity", entries.find((e) => e.slug === "price-validity")!.answerMd);
    expect(validity).toContain("{{validity_days}} days");
    const deposit = tokeniseSeedAnswer("deposit", "A deposit is payable when you accept.");
    expect(renderBrainAnswer(deposit, liveValuesFrom([{ key: "invoicing", value: { depositPct: 25 } }]))).toContain("The deposit is 25% of the estimate total.");
    // A seed answer that already carries the token is not double-stated.
    expect(tokeniseSeedAnswer("deposit", "A deposit of {{deposit_pct}}% is payable.")).toBe("A deposit of {{deposit_pct}}% is payable.");
    expect(tokeniseSeedAnswer("warranty", "We warrant our work for two years.")).toBe("We warrant our work for {{warranty_years}} years.");
    expect(renderBrainAnswer("Held for {{validity_days}} days.", liveValuesFrom([]))).toBe("Held for 60 days.");
    expect(renderBrainAnswer("Unknown {{nope}} stays visible.", liveValuesFrom([]))).toContain("{{nope}}");
  });
});
