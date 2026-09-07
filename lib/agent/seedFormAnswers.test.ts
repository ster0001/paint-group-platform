import { describe, expect, it } from "vitest";
import { docAnswers, docFacts, seedFormAnswers, type ScopeDoc } from "./scope-doc";

/**
 * Tom, 7 Sep (evening): the describe path asks the form's condition / details
 * questions, and their answers seed the agent draft BEFORE the paragraph
 * builds. An anonymous run carries no verified email, so the typed contact
 * email rides along too — without it the customer block never validated and
 * every anonymous "Describe it" build was refused.
 */
const blank = (): ScopeDoc => ({ estimateId: "e1", status: "draft", requiresSiteCheck: false, builderState: { blocks: [], agent: { answers: {}, facts: { accountType: null, email: null } } } });

describe("seedFormAnswers", () => {
  it("lands condition, details, the flags and the photos on the draft, and turns the flags/occupancy into facts", () => {
    const doc = seedFormAnswers(blank(), {
      condition: { tier: "dark_to_light", darkToLightSurfaces: ["walls"] },
      details: { damageTier: 2, damagePhotoCount: 1, occupied: "yes", damageNote: "cracks" },
      customer: { propertyKind: "townhouse", builtPre1970: "no", heritageListed: "no", bodyCorporate: "yes", asbestosSuspected: "unsure" },
      conditionSourceIds: ["11111111-1111-4111-8111-111111111111"],
    }, { email: "Someone@Example.com" });
    const a = docAnswers(doc);
    expect(a.condition?.tier).toBe("dark_to_light");
    expect(a.details?.damageTier).toBe(2);
    expect(a.customer?.propertyKind).toBe("townhouse");
    expect(a.customer?.bodyCorporate).toBe("yes");
    expect(a.customer?.email).toBe("someone@example.com");
    expect(a.conditionSourceIds).toHaveLength(1);
    const f = docFacts(doc);
    expect(f.occupied).toBe(true);
    expect(f.flagsAssumed).toBe(false);
    expect(f.photoCount).toBe(1);
    expect(f.email).toBe("someone@example.com");
  });

  it("never overwrites a verified email with a typed one, and leaves the flags 'assumed' when any is missing", () => {
    const base = blank();
    (base.builderState.agent as { facts: Record<string, unknown> }).facts.email = "member@paintgroup.test";
    const doc = seedFormAnswers(base, { customer: { builtPre1970: "no" } }, { email: "typed@example.com" });
    expect(docFacts(doc).email).toBe("member@paintgroup.test");
    expect(docFacts(doc).flagsAssumed).toBe(false); // the default facts value; nothing asserted it
    expect(docAnswers(doc).customer?.email).toBe("typed@example.com");
  });
});
