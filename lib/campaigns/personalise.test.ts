import { describe, expect, it } from "vitest";
import { TOKENS, exampleValues, fillTokens, firstNameOf, personaliseTemplate, tokenValues } from "./personalise";

const values = tokenValues({
  name: "Sarah Chen", suburb: "Kew", estimateTotalCents: 435_250, lastJobCompletedAt: "2024-03-14T02:00:00Z", estimator: "Tom", company: "Paint Group",
});

describe("tokens", () => {
  it("fills every word token and leaves the link tokens for the sender", () => {
    expect(fillTokens("Hi {{first_name}} — your {{ estimate_total }} estimate for {{suburb}} is here: {{estimate}} ({{estimator}}, {{company}})", values))
      .toBe("Hi Sarah — your $4,353 estimate for Kew is here: {{estimate}} (Tom, Paint Group)");
    expect(fillTokens("{{unsubscribe}} {{account}} {{made_up}}", values)).toBe("{{unsubscribe}} {{account}} {{made_up}}");
  });

  it("a first name is a word, never an email address or a couple", () => {
    expect(firstNameOf("Ben & Alice Turner")).toBe("Ben");
    expect(firstNameOf("Mrs O'Brien")).toBe("O'Brien");
    expect(firstNameOf("sarah@example.com")).toBe("");
    expect(firstNameOf("0412 345 678")).toBe("");
    expect(firstNameOf(null)).toBe("");
  });

  it("an estimator with no name signs as the company; a missing job date is blank", () => {
    const v = tokenValues({ name: null, suburb: null, estimateTotalCents: null, lastJobCompletedAt: null, estimator: null, company: "Paint Group" });
    expect(v).toEqual({ first_name: "there", name: "", suburb: "", estimate_total: "", last_job_date: "", estimator: "Paint Group", company: "Paint Group" });
    expect(values.last_job_date).toBe("March 2024");
  });

  it("no usable first name greets them as 'there', never as nobody", () => {
    // "Hi ," is how a customer finds out we do not know who they are.
    const v = (name: string | null) => tokenValues({
      name, suburb: null, estimateTotalCents: null, lastJobCompletedAt: null, estimator: null, company: "Paint Group",
    }).first_name;
    expect(v(null)).toBe("there");
    expect(v("sarah@example.com")).toBe("there");      // an email is not a name
    expect(v("0412 345 678")).toBe("there");
    expect(v("Sarah Chen")).toBe("Sarah");             // and a real one still wins
    expect(fillTokens("Hi {{first_name}},", tokenValues({
      name: null, suburb: null, estimateTotalCents: null, lastJobCompletedAt: null, estimator: null, company: "Paint Group",
    }))).toBe("Hi there,");
  });
});

describe("the example values behind the preview and the test send", () => {
  it("covers every token, so neither can show a raw {{brace}}", () => {
    // Tom, 11 Sep: a test send arrived with "{{first_name}}" in it. The studio
    // preview had the same hole. Both now fill with these.
    const v = exampleValues();
    for (const t of TOKENS) {
      expect(v[t.token]).toBe(t.example);
      expect(String(v[t.token]).trim().length).toBeGreaterThan(0);
    }
    const filled = fillTokens(TOKENS.map((t) => `{{${t.token}}}`).join(" "), v);
    expect(filled).not.toContain("{{");
  });

  it("takes the real company name when it is given, and signs as it", () => {
    const v = exampleValues("Acme Painting");
    expect(v.company).toBe("Acme Painting");
    expect(v.estimator).toBe("Acme Painting");
    expect(v.first_name).toBe("Sarah");
  });

  it("leaves the link tokens alone — the sender fills those with real URLs", () => {
    expect(fillTokens("{{estimate}} {{account}} {{unsubscribe}}", exampleValues()))
      .toBe("{{estimate}} {{account}} {{unsubscribe}}");
  });

  it("personalises wording fields and never a URL", () => {
    const t = personaliseTemplate({
      subject: "For {{first_name}}", preheader: "{{suburb}}",
      blocks: [
        { kind: "hero", headline: "Hello {{first_name}}", sub: "", imageUrl: null },
        { kind: "button", label: "Open it, {{first_name}}", url: "{{estimate}}", note: "" },
        { kind: "photo", imageUrl: "https://x/{{first_name}}.jpg", caption: "{{suburb}}" },
      ],
    }, values);
    expect(t.subject).toBe("For Sarah");
    expect(t.blocks[0]).toMatchObject({ headline: "Hello Sarah" });
    expect(t.blocks[1]).toMatchObject({ label: "Open it, Sarah", url: "{{estimate}}" });
    expect(t.blocks[2]).toMatchObject({ imageUrl: "https://x/{{first_name}}.jpg", caption: "Kew" });
  });
});
