import { describe, expect, it } from "vitest";
import {
  ceilingHeightFrom,
  clampAddress,
  coatsFor,
  defaultWizardState,
  pageForPath,
  wizardStateSchema,
  type WizardState,
} from "./state";

const valid = (): WizardState => ({
  ...defaultWizardState(),
  noPlan: true,
  basics: { bedrooms: 3, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: true },
});

describe("wizardStateSchema", () => {
  it("accepts a complete no-plan internal state", () => {
    expect(wizardStateSchema.safeParse(valid()).success).toBe(true);
  });

  it("rejects the default state until a plan or the basics exist", () => {
    const r = wizardStateSchema.safeParse(defaultWizardState());
    expect(r.success).toBe(false);
  });

  it("no-plan requires the basics", () => {
    const r = wizardStateSchema.safeParse({ ...valid(), basics: null });
    expect(r.success).toBe(false);
  });

  it("an interior job with a plan run needs no basics", () => {
    const s = { ...valid(), noPlan: false, basics: null, planRunIds: ["6b8f9e7c-1111-4222-8333-444455556666"] };
    expect(wizardStateSchema.safeParse(s).success).toBe(true);
  });

  it("dark to light needs at least one surface, and only ticked ones", () => {
    const none = { ...valid(), condition: { tier: "dark_to_light" as const, darkToLightSurfaces: [] } };
    expect(wizardStateSchema.safeParse(none).success).toBe(false);

    const unticked = {
      ...valid(),
      surfaces: ["walls" as const],
      condition: { tier: "dark_to_light" as const, darkToLightSurfaces: ["ceilings" as const] },
    };
    expect(wizardStateSchema.safeParse(unticked).success).toBe(false);

    const ok = {
      ...valid(),
      condition: { tier: "dark_to_light" as const, darkToLightSurfaces: ["walls" as const] },
    };
    expect(wizardStateSchema.safeParse(ok).success).toBe(true);
  });

  it("damage tier 2+ needs photos or a note (internal mode)", () => {
    const bare = { ...valid(), details: { ...valid().details, damageTier: 2 } };
    expect(wizardStateSchema.safeParse(bare).success).toBe(false);

    const noted = { ...valid(), details: { ...valid().details, damageTier: 2, damageNote: "cracked hall ceiling" } };
    expect(wizardStateSchema.safeParse(noted).success).toBe(true);

    const photographed = { ...valid(), details: { ...valid().details, damageTier: 3, damagePhotoCount: 2 } };
    expect(wizardStateSchema.safeParse(photographed).success).toBe(true);
  });

  it("exterior without a listing needs two facade photos", () => {
    const bare = { ...valid(), jobType: "both" as const };
    expect(wizardStateSchema.safeParse(bare).success).toBe(false);

    const listed = { ...valid(), jobType: "both" as const, listingUrl: "https://www.realestate.com.au/x" };
    expect(wizardStateSchema.safeParse(listed).success).toBe(true);

    const photographed = {
      ...valid(),
      jobType: "both" as const,
      facadeRunIds: ["6b8f9e7c-1111-4222-8333-444455556666", "6b8f9e7c-1111-4222-8333-444455556667"],
    };
    expect(wizardStateSchema.safeParse(photographed).success).toBe(true);
  });

  it("water-based only demands the oil-trims answer", () => {
    const s = { ...valid(), paint: { ...valid().paint, waterBasedOnly: true, trimsOilBased: null } };
    expect(wizardStateSchema.safeParse(s).success).toBe(false);
    const answered = { ...valid(), paint: { ...valid().paint, waterBasedOnly: true, trimsOilBased: "unsure" as const } };
    expect(wizardStateSchema.safeParse(answered).success).toBe(true);
  });
});

describe("helpers", () => {
  it("coats follow the tier", () => {
    expect(coatsFor("fresh", false)).toBe(1);
    expect(coatsFor("change", false)).toBe(2);
    expect(coatsFor("dark_to_light", true)).toBe(3);
    expect(coatsFor("dark_to_light", false)).toBe(2);
  });

  it("unsure ceiling height assumes 2.4 and says so", () => {
    expect(ceilingHeightFrom("2.7")).toEqual({ heightM: 2.7, assumed: false });
    expect(ceilingHeightFrom("unsure")).toEqual({ heightM: 2.4, assumed: true });
  });

  it("errors route back to their page", () => {
    expect(pageForPath(["basics"])).toBe(1);
    expect(pageForPath(["surfaces"])).toBe(2);
    expect(pageForPath(["condition", "darkToLightSurfaces"])).toBe(3);
    expect(pageForPath(["details", "damageTier"])).toBe(4);
    expect(pageForPath(["paint", "trimsOilBased"])).toBe(5);
  });

  it("clampAddress keeps any stored address submittable (the East-Riding lesson)", () => {
    const clamped = clampAddress({
      street: "2 Beech Rise", suburb: "Paull, Hull",
      state: "East Riding of Yorkshire", postcode: "HU128QF  ",
      formatted: "x".repeat(400),
    });
    expect(clamped.state.length).toBeLessThanOrEqual(10);
    expect(clamped.postcode).toBe("HU128QF");
    expect(clamped.formatted.length).toBeLessThanOrEqual(250);
    // Clamped output always passes the schema's address rules.
    const parsed = wizardStateSchema.safeParse({ ...valid(), address: clamped });
    expect(parsed.success).toBe(true);
  });
});

// ---- audit-fix pins (19 Aug) ------------------------------------------------
import { defaultCustomer, isAllowedListingUrl } from "./state";

it("pageForPath strips the route's 'state' prefix and maps customer fields to page 6", () => {
  expect(pageForPath(["state", "planRunIds"])).toBe(1);
  expect(pageForPath(["state", "details", "damageTier"])).toBe(4);
  expect(pageForPath(["state", "customer", "email"])).toBe(6);
  expect(pageForPath(["surfaces"])).toBe(2); // unprefixed still works
});

it("customer-mode damage tiers 2+ demand photos - a note is not evidence", () => {
  const s = { ...valid(), mode: "customer" as const, customer: { ...defaultCustomer(), email: "a@b.co", postcode: "3070", suburb: "Northcote", heritageListed: "no" as const, builtPre1970: "no" as const },
    details: { ...valid().details, damageTier: 3, damagePhotoCount: 0, damageNote: "old walls" } };
  const r = wizardStateSchema.safeParse(s);
  expect(r.success).toBe(false);
  if (!r.success) expect(r.error.issues.some((i) => /needs photos/.test(i.message))).toBe(true);
  // internal mode still accepts the note
  const internal = { ...s, mode: "internal" as const, customer: null };
  expect(wizardStateSchema.safeParse(internal).success).toBe(true);
});

it("junk listing text neither validates nor waives the facade photos", () => {
  expect(isAllowedListingUrl("don't have one")).toBe(false);
  expect(isAllowedListingUrl("https://evil.example.com/x")).toBe(false);
  expect(isAllowedListingUrl("https://www.realestate.com.au/property-house-vic-1")).toBe(true);
  const s = { ...valid(), jobType: "exterior" as const, listingUrl: "no idea", facadeRunIds: [] };
  const r = wizardStateSchema.safeParse(s);
  expect(r.success).toBe(false);
});

// ---- Tom, 29 Aug: the staff path always asks who it is for -----------------

describe("the staff contact block", () => {
  it("defaults to empty, and survives an older saved state", () => {
    expect(defaultWizardState().contact).toEqual({ name: "", email: "", phone: "" });
    const legacy: Record<string, unknown> = { ...valid() };
    delete legacy.contact;
    const r = wizardStateSchema.safeParse(legacy);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contact).toEqual({ name: "", email: "", phone: "" });
  });

  it("carries the details the account is built from", () => {
    const s = { ...valid(), contact: { name: "Bianca Rossi", email: "bianca@example.com", phone: "0412 345 678" } };
    const r = wizardStateSchema.safeParse(s);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contact.email).toBe("bianca@example.com");
  });
});
