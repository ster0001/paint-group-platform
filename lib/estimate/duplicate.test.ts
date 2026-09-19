import { describe, it, expect } from "vitest";
import { buildDuplicate, copyName, stripPhotoReferences, type DuplicateSource } from "./duplicate";

const source: DuplicateSource = {
  title: "12 Smith St, Clayton",
  builder_state: {
    blocks: [{ id: "b1", name: "Lounge" }],
    modSel: { "Level of Finish": "LOF-3" },
    contact: { first_name: "Sam", last_name: "Lee", email: "sam@example.com" },
    jobAddress: { address: "12 Smith St", city: "Clayton", state: "VIC", postal: "3168" },
    photoReview: { signedOffAt: "2026-09-01T00:00:00Z", photos: 7 },
    wizard: {
      state: {
        jobType: "interior",
        planRunIds: ["11111111-1111-4111-8111-111111111111"],
        facadeRunIds: ["22222222-2222-4222-8222-222222222222"],
        conditionSourceIds: ["33333333-3333-4333-8333-333333333333"],
        planPreviewUrl: "https://example.test/signed/plan.png",
        details: { damageTier: 2, damagePhotoCount: 3, damageNote: "" },
      },
      snapshot: { accuracyPct: 80, photos: 7 },
    },
  },
  rate_card_id: "card-1",
  rate_card_version: 4,
  level_of_finish: 3,
  size_band: "10_to_20k",
  subtotal_cents: 1000000,
  total_cents: 1100000,
  presentation_id: "pres-1",
  lead_source: "referral",
  job_kind: "residential",
  storey_heights: { ground: 2.7 },
  requires_site_check: true,
  source: "wizard",
};

describe("copyName", () => {
  it("appends (copy) once, then counts", () => {
    expect(copyName("12 Smith St", "")).toBe("12 Smith St (copy)");
    expect(copyName("12 Smith St (copy)", "")).toBe("12 Smith St (copy 2)");
    expect(copyName("12 Smith St (copy 2)", "")).toBe("12 Smith St (copy 3)");
  });
  it("falls back when there is no name", () => {
    expect(copyName(null, "Untitled quote")).toBe("Untitled quote (copy)");
    expect(copyName("   ", "Untitled quote")).toBe("Untitled quote (copy)");
  });
});

describe("buildDuplicate", () => {
  const copy = buildDuplicate(source, { createdBy: "user-1" });

  it("is a fresh draft with no customer history and no share token", () => {
    expect(copy.status).toBe("draft");
    expect(copy.share_token).toBeNull();
    expect(copy.sent_snapshot).toBeNull();
    expect(copy.sent_at).toBeNull();
    expect(copy.valid_until).toBeNull();
    expect(copy.created_by).toBe("user-1");
    // Nothing that would name the original row.
    expect("id" in copy).toBe(false);
    expect("customer_id" in copy).toBe(false);
    expect("property_id" in copy).toBe(false);
    expect("account_id" in copy).toBe(false);
  });

  it("marks the first line of the address as a copy and leaves the title alone", () => {
    expect(copy.title).toBe("12 Smith St, Clayton");
    const job = copy.builder_state.jobAddress as { address: string; city: string };
    expect(job.address).toBe("12 Smith St (copy)");
    expect(job.city).toBe("Clayton");
  });

  it("keeps the scope, the pricing inputs and the contact", () => {
    expect(copy.builder_state.blocks).toEqual([{ id: "b1", name: "Lounge" }]);
    expect(copy.builder_state.modSel).toEqual({ "Level of Finish": "LOF-3" });
    expect(copy.builder_state.contact).toEqual({ first_name: "Sam", last_name: "Lee", email: "sam@example.com" });
    expect(copy.rate_card_id).toBe("card-1");
    expect(copy.rate_card_version).toBe(4);
    expect(copy.level_of_finish).toBe(3);
    expect(copy.total_cents).toBe(1100000);
    expect(copy.job_kind).toBe("residential");
    expect(copy.requires_site_check).toBe(true);
    expect(copy.source).toBe("wizard");
  });

  it("drops every photo reference and zeroes the photo count, keeping the other answers", () => {
    expect("photoReview" in copy.builder_state).toBe(false);
    const wizard = copy.builder_state.wizard as { state: Record<string, unknown>; snapshot: unknown };
    expect(wizard.state.planRunIds).toEqual([]);
    expect(wizard.state.facadeRunIds).toEqual([]);
    expect(wizard.state.conditionSourceIds).toEqual([]);
    expect(wizard.state.planPreviewUrl).toBeNull();
    expect(wizard.state.jobType).toBe("interior");
    expect(wizard.state.details).toEqual({ damageTier: 2, damagePhotoCount: 0, damageNote: "" });
    expect(wizard.snapshot).toEqual({ accuracyPct: 80, photos: 7 });
  });

  it("never mutates the source", () => {
    const state = source.builder_state as Record<string, unknown>;
    expect(state.photoReview).toEqual({ signedOffAt: "2026-09-01T00:00:00Z", photos: 7 });
    expect((state.jobAddress as { address: string }).address).toBe("12 Smith St");
  });

  it("copes with an empty builder state and nulls", () => {
    const bare = buildDuplicate(
      { ...source, title: null, builder_state: null, subtotal_cents: null, total_cents: null, job_kind: null, requires_site_check: null, source: null },
      { createdBy: null },
    );
    expect(bare.title).toBe("Untitled quote");
    expect(bare.builder_state).toEqual({});
    expect(bare.subtotal_cents).toBe(0);
    expect(bare.job_kind).toBe("residential");
    expect(bare.source).toBe("manual");
    expect(bare.requires_site_check).toBe(false);
  });
});

describe("stripPhotoReferences", () => {
  it("leaves a state with no wizard alone apart from the sign-off", () => {
    expect(stripPhotoReferences({ blocks: [], photoReview: { signedOffAt: "x", photos: 1 } })).toEqual({ blocks: [] });
  });
});
