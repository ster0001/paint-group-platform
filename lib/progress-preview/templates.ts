/**
 * Live-progress phone on the customer estimate — ALL the wording.
 *
 * Brief: docs/briefs/claude-code-brief-estimate-live-progress-v4.md §6.
 * Two messaging sets (residential; commercial/trade), the label above the
 * phone, the "for illustration only" line under it, the photo tags and the
 * five updates. Everything the customer reads on or around the phone comes
 * from this file so it can move into Settings later (no editor in this build).
 *
 * Placeholders are filled by `buildProgressPreview` (build.ts). Every value is
 * PLAIN TEXT — nothing here is HTML, and the renderer places each string as a
 * text node, so a name containing `<script>` shows as literal characters.
 *
 * Commercial set rule (brief §6b, acceptance 13b): no residential room words
 * in this set's template wording. `COMMERCIAL_BANNED_WORDS` is what the unit
 * test checks the templates against; area names still come from the estimate.
 */

export type MessagingSet = "residential" | "commercial";

/** Above the phone, not fine print (Tom, 19 Sep — F4/F7). Same for both sets. */
export const EXAMPLE_LABEL = "Example of your live updates";

/** The line under the phone, one per set (replaces v3's preview line — F10). */
export const ILLUSTRATION_LINE: Record<MessagingSet, string> = {
  residential:
    "For illustration only. This is an example of the updates you'll receive, shown with your address and your own photos. The days, times, messages and the painter shown are examples, not your actual schedule.",
  commercial:
    "For illustration only. This is an example of the updates you and your team will receive, shown with your address and your own site photos. The days, times, messages, references and the supervisor shown are examples, not your actual programme.",
};

/** Every photo is the estimate's own before photo (F2/F13) and says so. */
export const PHOTO_TAG: Record<MessagingSet, string> = {
  residential: "Before · your photo",
  commercial: "Before · site photo",
};

/** The person card's role line, with and without a demo painter (F1). */
export const LEAD_ROLE: Record<MessagingSet, string> = {
  residential: "Your lead painter",
  commercial: "Site supervisor",
};

/** Words that may never appear in the commercial templates (acceptance 13b). */
export const COMMERCIAL_BANNED_WORDS = ["bedroom", "bed", "bathroom", "bath", "kitchen", "lounge", "laundry", "home"] as const;

/** The mockup's lock-screen clock and day. Illustrative (F3). */
export const LOCK_SCREEN = { time: "7:42", date: "Monday" } as const;

/** Commercial header extras (brief §6b "Header extras"). */
export const COMMERCIAL_STAGE_RAIL = ["Pre-start", "In progress", "Quality check", "Walkthrough", "Closed"] as const;
export const COMMERCIAL_DOC_CHIPS = ["Certificate of currency", "SWMS", "Daily reports"] as const;

/** Status pill wording on the phone header. */
export const STATUS_PILL = { inProgress: "In progress", done: "Ready for walkthrough" } as const;

/**
 * Placeholders: {first_name} {street_address} {lead} {areas_a} {areas_b}
 * {areas_c} {area} {ceiling_product} {wall_product} {po} {link}.
 * `withLead` / `noLead` are the F1 variants: a demo painter by name, or the
 * generic fallback when none is set (or they have no photo).
 */
export type TextTemplate = { withLead: string; noLead: string };

export type UpdateTemplate = {
  day: string;
  time: string;
  /** Interior / general wording. */
  title: string;
  body: TextTemplate;
  /** Exterior-only wording (brief §5 "Exterior job"). Falls back to the interior copy when absent. */
  exterior?: { title: string; body: TextTemplate };
  chips?: readonly string[];
  /** Progress bar percentage after this update. */
  pct: number;
  /** Index into COMMERCIAL_STAGE_RAIL (commercial only). */
  stage?: number;
  milestone?: boolean;
  /** Whether this update carries up to two of the customer's photos. */
  photos: boolean;
};

export type MessagingTemplates = {
  firstText: TextTemplate & { noName: string; noNameNoLead: string };
  lastText: TextTemplate & { noName: string; noNameNoLead: string };
  /** One interior update that mentions the exterior when the job is both (brief §5). */
  exteriorMention: string;
  updates: readonly UpdateTemplate[];
};

export const RESIDENTIAL: MessagingTemplates = {
  firstText: {
    withLead: "Good morning {first_name}. {lead} and the team have arrived at {street_address}. Follow today's progress: {link}",
    noLead: "Good morning {first_name}. The team have arrived at {street_address}. Follow today's progress: {link}",
    noName: "Good morning. {lead} and the team have arrived at {street_address}. Follow today's progress: {link}",
    noNameNoLead: "Good morning. The team have arrived at {street_address}. Follow today's progress: {link}",
  },
  lastText: {
    withLead: "{first_name}, {street_address} is finished. Your walkthrough with {lead} is at 2pm today.",
    noLead: "{first_name}, {street_address} is finished. Your walkthrough is at 2pm today.",
    noName: "{street_address} is finished. Your walkthrough with {lead} is at 2pm today.",
    noNameNoLead: "{street_address} is finished. Your walkthrough is at 2pm today.",
  },
  exteriorMention: "Outside, the {exterior_areas} washed down ready for priming.",
  updates: [
    {
      day: "Day 1", time: "8:05am", title: "Set-up and protection", photos: true, pct: 12,
      body: {
        withLead: "Floors covered, furniture moved to the centre of each room and wrapped. Filling and sanding under way in the {areas_a}.",
        noLead: "Floors covered, furniture moved to the centre of each room and wrapped. Filling and sanding under way in the {areas_a}.",
      },
      exterior: {
        title: "Wash-down and protection",
        body: {
          withLead: "Gardens, paths and windows covered. Wash-down under way on the {areas_a}.",
          noLead: "Gardens, paths and windows covered. Wash-down under way on the {areas_a}.",
        },
      },
    },
    {
      day: "Day 2", time: "4:40pm", title: "Preparation finished", photos: true, pct: 30,
      body: {
        withLead: "Cracks filled and sanded in the {areas_b}.",
        noLead: "Cracks filled and sanded in the {areas_b}.",
      },
      exterior: {
        title: "Preparation finished",
        body: {
          withLead: "Loose and flaking paint scraped back, gaps filled and sanded on the {areas_b}.",
          noLead: "Loose and flaking paint scraped back, gaps filled and sanded on the {areas_b}.",
        },
      },
    },
    {
      day: "Day 3", time: "4:15pm", title: "Ceilings and cornices", photos: false, pct: 48,
      body: {
        withLead: "Two coats of {ceiling_product} in the {areas_a}.",
        noLead: "Two coats of {ceiling_product} in the {areas_a}.",
      },
      exterior: {
        title: "Priming",
        body: {
          withLead: "Bare timber and patched areas primed on the {areas_a}.",
          noLead: "Bare timber and patched areas primed on the {areas_a}.",
        },
      },
    },
    {
      day: "Day 5", time: "4:30pm", title: "Walls, first coat", photos: true, pct: 76,
      body: {
        withLead: "{wall_product} going on in the {areas_c}, in the colours you chose at your consultation.",
        noLead: "{wall_product} going on in the {areas_c}, in the colours you chose at your consultation.",
      },
      exterior: {
        title: "Top coats",
        body: {
          withLead: "{wall_product} going on to the {areas_c}, in the colours you chose at your consultation.",
          noLead: "{wall_product} going on to the {areas_c}, in the colours you chose at your consultation.",
        },
      },
    },
    {
      day: "Day 7", time: "11:20am", title: "Final walkthrough booked", photos: false, pct: 100, milestone: true,
      body: {
        withLead: "2pm today with {lead}. You'll walk every room together, and anything you spot is put right before the final invoice.",
        noLead: "2pm today. You'll walk every room with your lead painter, and anything you spot is put right before the final invoice.",
      },
      exterior: {
        title: "Final walkthrough booked",
        body: {
          withLead: "2pm today with {lead}. You'll walk around the whole property together, and anything you spot is put right before the final invoice.",
          noLead: "2pm today. You'll walk around the whole property with your lead painter, and anything you spot is put right before the final invoice.",
        },
      },
    },
  ],
};

export const COMMERCIAL: MessagingTemplates = {
  firstText: {
    withLead: "{street_address}{po}: Paint Group signed in on site at 6:30am. {lead} is your site supervisor. Live progress: {link}",
    noLead: "{street_address}{po}: Paint Group signed in on site at 6:30am. Your site supervisor will meet your site contact. Live progress: {link}",
    noName: "{street_address}{po}: Paint Group signed in on site at 6:30am. {lead} is your site supervisor. Live progress: {link}",
    noNameNoLead: "{street_address}{po}: Paint Group signed in on site at 6:30am. Your site supervisor will meet your site contact. Live progress: {link}",
  },
  lastText: {
    withLead: "{street_address}{po}: works complete and site cleared. Handover walkthrough at 2pm. Completion report to follow.",
    noLead: "{street_address}{po}: works complete and site cleared. Handover walkthrough at 2pm. Completion report to follow.",
    noName: "{street_address}{po}: works complete and site cleared. Handover walkthrough at 2pm. Completion report to follow.",
    noNameNoLead: "{street_address}{po}: works complete and site cleared. Handover walkthrough at 2pm. Completion report to follow.",
  },
  exteriorMention: "External elevations ({exterior_areas}) washed down ready for priming.",
  updates: [
    {
      day: "Day 1", time: "6:30am", title: "Site induction and set-up", photos: true, pct: 12, stage: 1,
      chips: ["SWMS on site ✓", "Tenant notice posted ✓"],
      body: {
        withLead: "Team inducted and signed in. SWMS reviewed with your site contact, work zones barricaded and signed, floors and fixtures protected in {areas_a}.",
        noLead: "Team inducted and signed in. SWMS reviewed with your site contact, work zones barricaded and signed, floors and fixtures protected in {areas_a}.",
      },
      exterior: {
        title: "Site induction and set-up",
        body: {
          withLead: "Team inducted and signed in. SWMS reviewed with your site contact, exclusion zones barricaded and signed, wash-down under way on {areas_a}.",
          noLead: "Team inducted and signed in. SWMS reviewed with your site contact, exclusion zones barricaded and signed, wash-down under way on {areas_a}.",
        },
      },
    },
    {
      day: "Day 2", time: "4:45pm", title: "Preparation complete, common areas", photos: true, pct: 30, stage: 1,
      body: {
        withLead: "{areas_b} patched, sanded and spot-primed. Access kept clear throughout trading hours. Daily report sent to your recipients.",
        noLead: "{areas_b} patched, sanded and spot-primed. Access kept clear throughout trading hours. Daily report sent to your recipients.",
      },
      exterior: {
        title: "Preparation complete",
        body: {
          withLead: "{areas_b} scraped, patched, sanded and spot-primed. Access kept clear throughout trading hours. Daily report sent to your recipients.",
          noLead: "{areas_b} scraped, patched, sanded and spot-primed. Access kept clear throughout trading hours. Daily report sent to your recipients.",
        },
      },
    },
    {
      day: "Day 3", time: "9:40pm", title: "After-hours works, {area}", photos: false, pct: 48, stage: 1,
      chips: ["Out of hours ✓", "On programme ✓", "Variations 0"],
      body: {
        withLead: "Ceilings and walls completed after close using low-odour products. Area cleaned and reopened for trading at 7am.",
        noLead: "Ceilings and walls completed after close using low-odour products. Area cleaned and reopened for trading at 7am.",
      },
      exterior: {
        title: "After-hours works, {area}",
        body: {
          withLead: "Priming and first coats completed after close, away from trading hours. Access reopened at 7am.",
          noLead: "Priming and first coats completed after close, away from trading hours. Access reopened at 7am.",
        },
      },
    },
    {
      day: "Day 5", time: "4:45pm", title: "{areas_c}", photos: true, pct: 76, stage: 2,
      body: {
        withLead: "Two coats to walls, completed in stages around your staff. Colours recorded against the property.",
        noLead: "Two coats to walls, completed in stages around your staff. Colours recorded against the property.",
      },
      exterior: {
        title: "{areas_c}",
        body: {
          withLead: "Two top coats applied, completed in stages around your operations. Colours recorded against the property.",
          noLead: "Two top coats applied, completed in stages around your operations. Colours recorded against the property.",
        },
      },
    },
    {
      day: "Day 7", time: "11:20am", title: "Practical completion and handover", photos: false, pct: 100, stage: 3, milestone: true,
      body: {
        withLead: "Quality check passed. Walkthrough at 2pm with your site contact. Signed completion report, photo record and colour schedule filed to the property.",
        noLead: "Quality check passed. Walkthrough at 2pm with your site contact. Signed completion report, photo record and colour schedule filed to the property.",
      },
    },
  ],
};

export const TEMPLATES: Record<MessagingSet, MessagingTemplates> = { residential: RESIDENTIAL, commercial: COMMERCIAL };

/** Every template string of a set, flattened — what the banned-words test walks. */
export function templateStrings(set: MessagingSet): string[] {
  const t = TEMPLATES[set];
  const out: string[] = [
    ILLUSTRATION_LINE[set], PHOTO_TAG[set], LEAD_ROLE[set], EXAMPLE_LABEL, t.exteriorMention,
    ...Object.values(t.firstText), ...Object.values(t.lastText),
  ];
  for (const u of t.updates) {
    out.push(u.title, u.body.withLead, u.body.noLead, ...(u.chips ?? []));
    if (u.exterior) out.push(u.exterior.title, u.exterior.body.withLead, u.exterior.body.noLead);
  }
  if (set === "commercial") out.push(...COMMERCIAL_STAGE_RAIL, ...COMMERCIAL_DOC_CHIPS);
  return out;
}
