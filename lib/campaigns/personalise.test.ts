import { describe, expect, it } from "vitest";
import { fillTokens, firstNameOf, personaliseTemplate, tokenValues } from "./personalise";

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
    expect(v).toEqual({ first_name: "", name: "", suburb: "", estimate_total: "", last_job_date: "", estimator: "Paint Group", company: "Paint Group" });
    expect(values.last_job_date).toBe("March 2024");
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
