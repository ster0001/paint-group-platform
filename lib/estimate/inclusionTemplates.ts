// Reusable "What's included" templates. Managed in Settings and applied to an
// estimate's inclusions from the builder. Stored in settings under the key
// `inclusion_templates`; these two ship as the built-in defaults.

export type InclusionTemplate = { id: string; name: string; items: string[] };

export const INCLUSION_TEMPLATES_KEY = "inclusion_templates";
export const EXCLUSION_TEMPLATES_KEY = "exclusion_templates";

export const DEFAULT_INCLUSION_TEMPLATES: InclusionTemplate[] = [
  {
    id: "interior-standard",
    name: "Interior — standard preparation",
    items: [
      "Floors, furniture, fixtures and surrounding areas will be protected using drop sheets, plastic sheeting and appropriate masking materials.",
      "Furniture will be moved away from work areas where practical and returned upon completion.",
      "Loose, peeling or flaking paint will be scraped away, and affected areas will be sanded.",
      "Glossy surfaces, woodwork and trim will be sanded and cleaned as required to promote paint adhesion.",
      "Minor gaps around woodwork, trim, cornices and other junctions will be filled using a suitable interior gap sealant.",
      "Minor cracks, nail holes and surface imperfections will be filled and sanded.",
      "Minor damage to walls and ceilings will be patched or skim-coated using suitable compounds.",
      "Minor damage and nail holes in timber will be filled using interior-grade timber filler and sanded.",
      "Bare, repaired or stained areas will be spot-primed where required.",
      "Surfaces will be prepared and painted using the coating system specified in the estimate.",
      "Daily Setup and Cleanup — Our team will keep the work areas tidy throughout the project. At the end of each day, job-related debris will be removed or contained, and painting materials and equipment will be safely organised.",
      "Final Walkthrough — As the project approaches completion, the job lead will conduct a final walkthrough with you to review the completed work and identify any reasonable touch-ups covered by the agreed scope. Any required touch-ups will be completed or scheduled promptly.",
    ],
  },
  {
    id: "exterior-standard",
    name: "Exterior — standard preparation",
    items: [
      "Surrounding surfaces, windows, doors, paving, landscaping and fixtures will be protected using drop sheets, plastic sheeting and appropriate masking materials.",
      "Exterior surfaces will be pressure washed where appropriate to remove dirt, dust and loose surface contaminants.",
      "Loose, peeling or flaking paint will be scraped away, and affected areas will be sanded.",
      "Glossy surfaces, timber and trim will be sanded and cleaned as required to promote paint adhesion.",
      "Minor gaps and joints will be sealed using a suitable exterior grade gap sealant.",
      "Minor cracks, holes and surface imperfections will be filled using products appropriate for the substrate.",
      "Minor damage and imperfections in timber will be filled and sanded in preparation for painting.",
      "Larger holes in timber will be repaired using a suitable builder's or epoxy filler and sanded to achieve the closest practical match to the existing profile.",
      "Weathered timber considered salvageable may be treated with a suitable timber hardener.",
      "Bare, repaired, stained or rust affected areas will be spot primed using an appropriate primer.",
      "Surfaces will be prepared and painted using the exterior coating system specified in the estimate.",
      "Daily Setup and Cleanup — Our team will keep the work areas tidy throughout the project. At the end of each day, job-related debris will be removed or contained, and painting materials and equipment will be safely organised.",
      "Final Walkthrough — As the project approaches completion, the job lead will conduct a final walkthrough with you to review the completed work and identify any reasonable touch-ups covered by the agreed scope. Any required touch-ups will be completed or scheduled promptly.",
    ],
  },
];

export const DEFAULT_EXCLUSION_TEMPLATES: InclusionTemplate[] = [
  {
    id: "exterior-standard-exclusions",
    name: "Exterior — standard exclusions",
    items: [
      "Masonry, roofing or structural repairs.",
      "Repairs to structural cracks, movement cracks or recurring building defects.",
      "Waterproofing or rectification of active leaks, moisture ingress, rising damp or drainage problems.",
      "Mould, algae or contamination remediation beyond standard surface cleaning.",
      "Removal or replacement of silicone sealants, glazing compounds or window glass.",
      "Roof repairs, gutter replacement, plumbing, electrical or other trade related work.",
      "Removal, relocation or reinstatement of fixtures, signage, awnings, shutters, solar panels, antennas or external equipment.",
      "Removal or treatment of lead based paint, asbestos or other hazardous materials.",
      "Removal of existing coatings where complete coating removal is required.",
      "Rectification of coating failure caused by moisture, substrate movement, contamination or an unsuitable existing coating system.",
      "Painting of surfaces or items not specifically listed in the estimate.",
      "Painting behind fixed structures or equipment that cannot be safely accessed.",
      "Council permits, footpath permits, road permits, engineering documentation or neighbour access costs unless specified.",
      "Removal or reinstatement of vegetation, landscaping, outdoor furniture or stored items obstructing access.",
      "Protection or relocation of vehicles left within the work area.",
      "Professional window cleaning, landscaping or removal of pre existing rubbish and debris.",
      "Repairs to damage caused by pests, termites, birds or other animals.",
      "Work delayed or damaged by weather, environmental conditions or events outside our reasonable control.",
    ],
  },
  {
    id: "interior-standard-exclusions",
    name: "Interior — standard exclusions",
    items: [
      "Removal or installation of furniture, appliances, window furnishings, artwork, televisions or other fixtures.",
      "Moving excessively heavy, fragile or valuable items.",
      "Removal or replacement of carpets, flooring, cabinetry, benchtops or fixed joinery.",
      "Full surface skim coating or achieving a Level 5 plaster finish.",
      "Repairs resulting from active water leaks, moisture ingress, rising damp or condensation.",
      "Mould identification, treatment or remediation.",
      "Removal or replacement of silicone sealants.",
      "Painting inside cupboards, wardrobes, cabinetry, drawers or other enclosed areas unless specified.",
      "Painting behind fixed appliances, cabinetry or fixtures that cannot be safely accessed.",
      "Painting of items or surfaces not specifically listed in the estimate.",
      "Rectification of previous poor workmanship or coating failure beyond normal preparation.",
      "Removal or treatment of lead based paint, asbestos or other hazardous materials.",
      "Disconnecting or reconnecting electrical, plumbing, security or data equipment.",
      "Professional cleaning or removal of pre existing rubbish and building debris.",
      "Accommodation, storage or relocation costs while work is underway.",
    ],
  },
];
