import { describe, expect, it } from "vitest";
import { validateGenerated } from "./ai";
import type { Template } from "./blocks";

const draft = (body: string, over: Partial<Template> = {}): Template => ({
  subject: "Your exterior is due",
  preheader: "",
  blocks: [{ kind: "text", body }],
  ...over,
});

describe("validateGenerated — the claim check", () => {
  it("catches an invented warranty, which is the expensive one", () => {
    // The brief's own risk: one invented warranty term in one email to 63
    // people outweighs a hundred bland ones.
    const w = validateGenerated(draft("Backed by our seven-year warranty."));
    expect(w.join(" ")).toMatch(/warranty length/);
  });

  it("catches prices, discounts, timeframes, awards and 'free'", () => {
    expect(validateGenerated(draft("From $2,400 a room."))).toHaveLength(1);
    expect(validateGenerated(draft("20% off this month."))).not.toHaveLength(0);
    expect(validateGenerated(draft("We start same-day."))).not.toHaveLength(0);
    expect(validateGenerated(draft("Melbourne's number one painters."))).not.toHaveLength(0);
    expect(validateGenerated(draft("Free colour consult."))).not.toHaveLength(0);
    expect(validateGenerated(draft("Over 20 years painting Melbourne homes."))).not.toHaveLength(0);
  });

  it("allows a claim the business actually gave it", () => {
    // The point is not to ban claims — it is to ban INVENTED ones.
    const w = validateGenerated(draft("Backed by our seven-year warranty."), ["Seven-year warranty on exterior work"]);
    expect(w).toEqual([]);
  });

  it("reads the whole email, not just the body", () => {
    const t: Template = {
      subject: "20% off exteriors",
      preheader: "",
      blocks: [{ kind: "text", body: "Time for a repaint." }],
    };
    expect(validateGenerated(t)).not.toHaveLength(0);
  });

  it("says nothing about honest, plain copy", () => {
    const t = draft("It's been a couple of years since we painted your hallway. Worth a look at the outside before summer?", {
      blocks: [
        { kind: "hero", headline: "Time for a look outside", sub: "", imageUrl: null },
        { kind: "text", body: "It's been a couple of years since we painted inside for you." },
        { kind: "button", label: "Get an estimate", url: "https://paintgroup.com.au/estimate", note: "" },
      ],
    });
    expect(validateGenerated(t)).toEqual([]);
  });

  it("reports each kind of claim once, not once per sentence", () => {
    const w = validateGenerated(draft("Free quote. Free colour consult. Free parking."));
    expect(w).toHaveLength(1);
  });
});
