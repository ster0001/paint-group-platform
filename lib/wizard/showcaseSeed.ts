import {
  defaultCustomer, defaultExterior, defaultWizardState, exteriorSurfaceKeys, wizardStateShapeSchema,
  type WizardState,
} from "./state";
import type { JobType } from "@/lib/showcase/schema";

/**
 * "Get a price like this" (homepage brief §4.4c block 8): a visitor arrives
 * at /estimate from a showcase job. Two seeds, both pure so they are tested:
 *
 *  - applyScopeIntent: no linked estimate → the wizard opens on the job's
 *    type (interior/exterior) with the property answers the type implies;
 *  - sanitiseClonedState: a linked estimate → its REAL scope tree becomes
 *    the visitor's draft, with everything that belongs to the original
 *    customer stripped: identity, contact, address, suburb/postcode,
 *    listing, uploaded plans/photos, damage notes. What survives is the job
 *    (rooms, surfaces, condition tier, details, paint) — the "same scope".
 *
 * The estimate id NEVER travels on the URL; the page resolves it from the
 * PUBLISHED showcase row's `estimate_id` (session 4).
 */

export function applyScopeIntent(state: WizardState, scope: JobType, propertyKind: "commercial" | null): WizardState {
  const customer = { ...(state.customer ?? defaultCustomer()) };
  if (propertyKind) customer.propertyKind = propertyKind;
  let next: WizardState = { ...state, mode: "customer", customer };
  switch (scope) {
    case "exterior": {
      const ext = state.exterior ?? defaultExterior();
      next = { ...next, jobType: "exterior", exterior: ext, surfaces: exteriorSurfaceKeys(ext) };
      break;
    }
    case "interior":
      next = { ...next, jobType: "interior", exterior: null };
      break;
    case "commercial":
      next = { ...next, customer: { ...customer, propertyKind: "commercial" } };
      break;
    case "heritage":
      next = { ...next, customer: { ...customer, heritageListed: "yes" } };
      break;
    case "body_corporate":
      next = { ...next, customer: { ...customer, bodyCorporate: "yes", propertyKind: customer.propertyKind === "house" ? "unit_apartment" : customer.propertyKind } };
      break;
  }
  return wizardStateShapeSchema.parse(next);
}

/** The seed for a job with no linked estimate. */
export function scopeSeed(scope: JobType, propertyKind: "commercial" | null): WizardState {
  return applyScopeIntent(defaultWizardState(), scope, propertyKind);
}

/** Strip the original customer out of a stored wizard state. Null when the stored value isn't a valid state. */
export function sanitiseClonedState(stored: unknown, propertyKind: "commercial" | null): WizardState | null {
  // Shape only: a stored state passed the full rules when it was submitted;
  // the copy has its email blanked, which the full rules would refuse.
  const parsed = wizardStateShapeSchema.safeParse(stored);
  if (!parsed.success) return null;
  const s = parsed.data;
  const customer = { ...(s.customer ?? defaultCustomer()), email: "", suburb: "", postcode: "" };
  if (propertyKind) customer.propertyKind = propertyKind;
  const cleaned: WizardState = {
    ...s,
    mode: "customer",
    customer,
    title: "",
    address: null,
    listingUrl: "",
    planRunIds: [],
    facadeRunIds: [],
    conditionSourceIds: [],
    contact: { name: "", email: "", phone: "" },
    details: { ...s.details, damageNote: "", damagePhotoCount: 0 },
  };
  // Re-validate: a state that only made sense with its plan attached fails here, and the caller falls back.
  const again = wizardStateShapeSchema.safeParse(cleaned);
  return again.success ? again.data : null;
}
