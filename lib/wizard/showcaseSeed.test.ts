import { test, expect } from "vitest";
import { applyScopeIntent, sanitiseClonedState, scopeSeed } from "./showcaseSeed";
import { defaultCustomer, defaultWizardState } from "./state";

test("exterior scope opens the wizard on exterior with the exterior tick list", () => {
  const s = scopeSeed("exterior", null);
  expect(s.mode).toBe("customer");
  expect(s.jobType).toBe("exterior");
  expect(s.exterior).not.toBeNull();
  expect(s.surfaces.length).toBeGreaterThan(0);
});

test("commercial / heritage / body corporate set the property answers", () => {
  expect(scopeSeed("commercial", null).customer?.propertyKind).toBe("commercial");
  expect(scopeSeed("heritage", null).customer?.heritageListed).toBe("yes");
  const bc = scopeSeed("body_corporate", null).customer;
  expect(bc?.bodyCorporate).toBe("yes");
  expect(bc?.propertyKind).toBe("unit_apartment");
  // the business chip wins over the type's default
  expect(scopeSeed("interior", "commercial").customer?.propertyKind).toBe("commercial");
});

test("a cloned estimate keeps the scope and loses the customer", () => {
  const stored = {
    ...defaultWizardState(),
    mode: "customer",
    jobType: "interior",
    noPlan: true,
    title: "6/31 Westgarth St",
    address: { street: "6/31 Westgarth St", suburb: "Northcote", state: "VIC", postcode: "3070", formatted: "6/31 Westgarth St, Northcote VIC 3070" },
    listingUrl: "https://www.realestate.com.au/x",
    planRunIds: ["8b6b0b0e-0d5e-4c4a-9c3e-4a9f2e3b1c11"],
    basics: { bedrooms: 3, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: true },
    customer: { ...defaultCustomer(), email: "sarah@example.com", suburb: "Northcote", postcode: "3070", heritageListed: "yes" },
    contact: { name: "Sarah", email: "sarah@example.com", phone: "0400 000 000" },
    details: { ...defaultWizardState().details, damageNote: "cracks above the door at 6/31", damagePhotoCount: 3 },
  };
  const out = sanitiseClonedState(stored, null);
  expect(out).not.toBeNull();
  expect(out!.basics).toEqual(stored.basics);
  expect(out!.noPlan).toBe(true);
  expect(out!.customer?.heritageListed).toBe("yes"); // a fact about the property stays
  expect(out!.customer?.email).toBe("");
  expect(out!.customer?.suburb).toBe("");
  expect(out!.customer?.postcode).toBe("");
  expect(out!.contact).toEqual({ name: "", email: "", phone: "" });
  expect(out!.address).toBeNull();
  expect(out!.title).toBe("");
  expect(out!.listingUrl).toBe("");
  expect(out!.planRunIds).toEqual([]);
  expect(out!.details.damageNote).toBe("");
  expect(out!.details.damagePhotoCount).toBe(0);
  expect(JSON.stringify(out)).not.toMatch(/sarah|westgarth|0400/i);
});

test("garbage in the stored column falls back to null, never throws", () => {
  expect(sanitiseClonedState({ nope: true }, null)).toBeNull();
  expect(sanitiseClonedState(null, null)).toBeNull();
  expect(applyScopeIntent(defaultWizardState(), "interior", null).jobType).toBe("interior");
});
