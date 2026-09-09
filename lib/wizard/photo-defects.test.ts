import { describe, expect, it } from "vitest";
import { MIN_CONFIDENCE, suggestFromDefects, suggestionLine, type ObservedDefect } from "./photo-defects";

const d = (over: Partial<ObservedDefect> = {}): ObservedDefect =>
  ({ type: "water_damage", severity: 2, qty: 3, confidence: 0.9, ...over });

describe("the model's vocabulary becomes the customer's", () => {
  it("maps a defect type onto the tag they would have tapped", () => {
    expect(suggestFromDefects([d({ type: "water_damage" })])?.tag).toBe("water");
    expect(suggestFromDefects([d({ type: "plaster_cracks" })])?.tag).toBe("crack");
    expect(suggestFromDefects([d({ type: "timber_rot" })])?.tag).toBe("rot");
  });

  /**
   * Two axes, not one (Tom's question of 9 Sep exposed the conflation):
   * QTY is how much of it — the customer's words. SEVERITY is how bad per
   * unit — the model's judgement, which a customer is never asked for.
   */
  it("maps the observed QUANTITY onto the extent words", () => {
    expect(suggestFromDefects([d({ qty: 1 })])?.extent).toBe("spots");
    expect(suggestFromDefects([d({ qty: 3 })])?.extent).toBe("patches");
    expect(suggestFromDefects([d({ qty: 9 })])?.extent).toBe("most");
  });

  it("carries the model's severity through untouched", () => {
    expect(suggestFromDefects([d({ severity: 1 })])?.severity).toBe(1);
    expect(suggestFromDefects([d({ severity: 3 })])?.severity).toBe(3);
  });

  it("says nothing about a defect type the customer has no word for", () => {
    // efflorescence and nicotine_staining are real defect types with no tag.
    expect(suggestFromDefects([d({ type: "efflorescence" })])).toBeNull();
  });
});

describe("when it stays quiet", () => {
  it("says nothing on an empty read — which is the normal answer", () => {
    expect(suggestFromDefects([])).toBeNull();
  });

  it("says nothing below the confidence bar", () => {
    expect(suggestFromDefects([d({ confidence: MIN_CONFIDENCE - 0.01 })])).toBeNull();
    expect(suggestFromDefects([d({ confidence: MIN_CONFIDENCE })])).not.toBeNull();
  });

  it("says nothing about a defect it saw none of", () => {
    expect(suggestFromDefects([d({ qty: 0 })])).toBeNull();
  });
});

describe("one suggestion, and it is the one that matters", () => {
  /**
   * A customer who photographed a damp patch is telling us about that patch.
   * Handing back four checkboxes turns a helpful gesture into a form.
   */
  it("returns a single suggestion, never a list", () => {
    const out = suggestFromDefects([d({ type: "plaster_cracks", severity: 1 }), d({ type: "mould", severity: 3 })]);
    expect(out?.tag).toBe("mould");
  });

  /**
   * Severity first, then confidence: a confident scuff matters less than a
   * probable case of rot, and the estimator would rather be pointed at the
   * worse thing.
   */
  it("prefers the worse defect over the more certain one", () => {
    const out = suggestFromDefects([
      d({ type: "holes_dents", severity: 1, confidence: 0.99 }),
      d({ type: "timber_rot", severity: 3, confidence: 0.72 }),
    ]);
    expect(out?.tag).toBe("rot");
  });

  it("breaks a severity tie on confidence", () => {
    const out = suggestFromDefects([
      d({ type: "mould", severity: 2, confidence: 0.75 }),
      d({ type: "flaking", severity: 2, confidence: 0.95 }),
    ]);
    expect(out?.tag).toBe("flaking");
  });
});

describe("how it is put to the customer", () => {
  /**
   * Phrased as something to CONFIRM, never as a finding. Told "we found
   * flaking", a customer will not argue; asked "does that look right?", they
   * will happily say no — and their answer is what we price.
   */
  it("asks rather than announces", () => {
    const line = suggestionLine({ tag: "flaking", extent: "patches", severity: 2, confidence: 0.9 });
    expect(line).toMatch(/does that look right\?$/);
    expect(line).toMatch(/looks like flaking in patches here and there/i);
    expect(line).not.toMatch(/we found|we have detected|confirmed/i);
  });

  it("says how much of it in the customer's own words", () => {
    expect(suggestionLine({ tag: "water", extent: "most", severity: 2, confidence: 0.9 })).toMatch(/across most of it/);
    expect(suggestionLine({ tag: "water", extent: "spots", severity: 2, confidence: 0.9 })).toMatch(/in a couple of spots/);
  });
});
