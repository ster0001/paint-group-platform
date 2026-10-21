/**
 * The crew's copy of a work order — what a contractor's painters may see.
 *
 * A WHITELIST, not a blacklist. Every field the crew view carries is copied
 * here by name; anything not named does not exist on the crew document, so a
 * money field added to the snapshot next month defaults to hidden, not leaked.
 * (A blacklist would default the other way, and nobody remembers to update the
 * blacklist.)
 *
 * What the crew gets: the scope — areas, surfaces, coats, prep, hours, colours,
 * materials, finish levels, access notes, crew notes, exclusions, the address
 * they are driving to. What they never get: the contractor's payment (that is
 * the contractor's contract, not the crew's business) and the customer's phone
 * (site questions go through the contractor, not around them).
 *
 * This runs in the server component, so the stripped fields never reach the
 * browser at all — the same rule as the suburb redaction in
 * lib/contractor/jobs.ts: redaction in the markup is not redaction.
 */
import type { WOArea, WOMaterial, WorkOrderDoc, WOSurface } from "./snapshot";

/** A variation as the crew sees it: the work, never the money. */
export type CrewVariation = {
  category: string;
  comment: string;
  estHours: number | null;
  status: string;
};

const crewSurface = (s: WOSurface): WOSurface => ({
  key: s.key,
  label: s.label,
  ...(s.code ? { code: s.code } : {}),
  // A count is scope, not money: the crew needs to know it is four doors.
  ...(typeof s.count === "number" ? { count: s.count } : {}),
  // So is a measurement: the crew needs to know it is 38 m² of walls.
  ...(typeof s.qty === "number" && s.unit ? { qty: s.qty, unit: s.unit } : {}),
  coats: s.coats,
  product: s.product,
  // Paint is scope, not money: the per-area materials breakdown (13 Oct 2026)
  // groups a surface's litres by its product × colour, and the surface's own
  // paint line (21 Oct 2026) reads product · sheen · colour.
  ...(s.finish ? { finish: s.finish } : {}),
  ...(s.colourKey ? { colourKey: s.colourKey, colourName: s.colourName ?? "", colourHex: s.colourHex ?? "" } : {}),
  ...(typeof s.litres === "number" ? { litres: s.litres } : {}),
  prep: s.prep,
  hours: s.hours,
  status: s.status,
});

const crewArea = (a: WOArea): WOArea => ({
  id: a.id,
  title: a.title,
  ...(a.side ? { side: a.side } : {}),
  ...(a.dims ? { dims: { l: a.dims.l, w: a.dims.w, h: a.dims.h } } : {}),
  surfaces: (a.surfaces ?? []).map(crewSurface),
  photos: a.photos ?? [],
  finishCode: a.finishCode,
  finishOverridden: a.finishOverridden,
});

const crewMaterial = (m: WOMaterial): WOMaterial => ({
  product: m.product,
  // The sheen and the row's identity: the "where it goes" list under a paint
  // (21 Oct 2026) pairs the row with its surfaces by colourKey.
  ...(m.finish ? { finish: m.finish } : {}),
  ...(m.colourKey ? { colourKey: m.colourKey } : {}),
  photoUrl: m.photoUrl,
  litres: m.litres,
  ...(typeof m.estimatedLitres === "number" ? { estimatedLitres: m.estimatedLitres } : {}),
  coverageMissing: m.coverageMissing,
  colourName: m.colourName,
  colourHex: m.colourHex,
  colourStatus: m.colourStatus,
});

export function crewDoc(doc: WorkOrderDoc): WorkOrderDoc {
  return {
    version: 1,
    woRef: doc.woRef,
    status: doc.status,
    jobTitle: doc.jobTitle,
    jobAddress: doc.jobAddress,
    contactFirstName: doc.contactFirstName,
    contactPhone: "",                     // through the contractor, not around them
    startDate: doc.startDate,
    accessNotes: doc.accessNotes,
    crewNotes: doc.crewNotes,
    levelOfFinish: doc.levelOfFinish,
    finishCode: doc.finishCode,
    contractorName: doc.contractorName,
    contractorPaymentCents: 0,            // the renderer also hides the section; both on purpose
    materials: (doc.materials ?? []).map(crewMaterial),
    areas: (doc.areas ?? []).map(crewArea),
    exclusions: doc.exclusions ?? [],
    inclusions: doc.inclusions ?? [],
    company: {
      name: doc.company?.name ?? "",
      phone: doc.company?.phone ?? "",
      logoUrl: doc.company?.logoUrl ?? "",
    },
  };
}
