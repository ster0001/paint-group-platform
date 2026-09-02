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
  });

  it("[TOM TO WRITE] entries import as needs_content — never a served placeholder", () => {
    const caulking = entries.find((e) => e.slug === "caulking-gaps")!;
    expect(caulking.needsContent).toBe(true);
    expect(caulking.marker).toBe("tom_to_write");
    const oneLiner = entries.find((e) => e.slug === "occupied")!;
    expect(oneLiner.needsContent).toBe(true);
    const deposit = entries.find((e) => e.slug === "deposit")!;
    expect(deposit.needsContent).toBe(false);
    expect(deposit.marker).toBe("platform");
    expect(deposit.answerMd).toMatch(/^A deposit is payable/);
    expect(deposit.answerMd).not.toContain("[PLATFORM]");
  });

  it("Settings-backed figures become tokens that render the live value", () => {
    const validity = tokeniseSeedAnswer("price-validity", entries.find((e) => e.slug === "price-validity")!.answerMd);
    expect(validity).toContain("{{validity_days}} days");
    const deposit = tokeniseSeedAnswer("deposit", "A deposit is payable when you accept.");
    expect(renderBrainAnswer(deposit, liveValuesFrom([{ key: "invoicing", value: { depositPct: 25 } }]))).toContain("The deposit is 25% of the estimate total.");
    expect(renderBrainAnswer("Held for {{validity_days}} days.", liveValuesFrom([]))).toBe("Held for 60 days.");
    expect(renderBrainAnswer("Unknown {{nope}} stays visible.", liveValuesFrom([]))).toContain("{{nope}}");
  });
});
