import type { DraftArea } from "@/lib/extract/draft";
import { substrateKeyForRateCode } from "@/lib/estimate/substrates";
import { clampAddress, defaultCustomer, defaultWizardState, type WizardState } from "./state";
import { applySpec, type SavedSpec } from "./saved-specs";
import { seedFromMeasuredTree, type MeasuredTree } from "./measured-tree";

/**
 * C15 — a TRADE QUOTE from the file (walk A, screen A2).
 *
 * "Because the property is measured and the spec is saved, a range renders
 * before the sheet is opened." This module builds the two things that makes
 * possible: the blocks the range is priced on (the measured tree, filtered to
 * the spec's surfaces) and the wizard state the sheet is opened with. No
 * money is computed here — the page hands the blocks to `editorPayload` and
 * `customerRange`, the same two calls every other range goes through.
 */

export type TradeProperty = {
  id: string;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
};

/** The measured tree as a NEW estimate's seed, keeping only the spec's surfaces. */
export function blocksForSpec(tree: MeasuredTree, spec: Pick<SavedSpec, "surfaces"> | null): DraftArea[] {
  let next = 1;
  const seeded = seedFromMeasuredTree(tree, () => next++);
  if (!spec) return seeded;
  const wanted = new Set<string>(spec.surfaces);
  return seeded.map((a) => ({
    ...a,
    surfaces: (a.surfaces ?? []).filter((s) => wanted.has(substrateKeyForRateCode(String(s.code ?? "")) ?? "")),
  }));
}

/**
 * The state the sheet opens with: customer mode (a trade member is a
 * customer actor with the trade relaxation — ⚑11 makes every trade quote a
 * confirmation), the property's address, the spec's answers over the
 * defaults, and `propertyId` so the submit route seeds from the file and
 * links the estimate to the property (the fixed price then lands on it).
 */
export function tradeQuoteState(property: TradeProperty, spec: SavedSpec | null, contact: { name: string; email: string; phone: string }): WizardState {
  const base = spec ? applySpec(defaultWizardState(), spec) : defaultWizardState();
  const address = property.address
    ? clampAddress({
        street: property.address,
        suburb: property.suburb ?? "",
        state: property.state ?? "",
        postcode: property.postcode ?? "",
        formatted: [property.address, property.suburb, property.postcode].filter(Boolean).join(", "),
      })
    : null;
  return {
    ...base,
    mode: "customer",
    // Customer mode wants the customer block (the schema's own rule); the
    // property answers the suburb and postcode, the rest are the defaults.
    customer: {
      ...defaultCustomer(),
      email: contact.email,
      suburb: property.suburb ?? "",
      postcode: property.postcode ?? "",
      propertyKind: "unit_apartment",
    },
    jobType: "interior",
    noPlan: true,
    propertyId: property.id,
    address,
    title: property.address ?? "",
    contact: { name: contact.name, email: contact.email, phone: contact.phone },
  };
}

/** The file's one-line facts for the property card. */
export function fileFacts(tree: MeasuredTree | null): { areas: number; measuredLabel: string | null } {
  if (!tree) return { areas: 0, measuredLabel: null };
  const t = Date.parse(tree.measuredAt);
  return {
    areas: tree.blocks.filter((b) => b?.kind === "area" && b.type !== "Exterior").length,
    measuredLabel: Number.isFinite(t)
      ? new Date(t).toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "Australia/Melbourne" })
      : null,
  };
}
