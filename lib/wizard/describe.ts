import type { BriefExtraction } from "@/lib/agent/brief-extract";
import { colourFromChanges, type QuickLook, type QuickLookStep } from "./quick-look";

/**
 * C16 (a) — "DESCRIBE IT" behind the chat bubble.
 *
 * The customer types the job in a sentence or two; the brief reader
 * (lib/agent/brief-extract — the model, or the heuristic reader on the test
 * stack) turns it into facts; THIS module turns the facts into quick-look
 * answers. Nothing here writes anywhere: the route returns the answers to the
 * wizard, and the wizard saves them the way it saves every tap — through the
 * versioned draft (C3). The assistant never gets its own write path.
 *
 * Every field the assistant filled is named in `wrote`, and stays there
 * (amber on the screen) until the customer confirms it: a tap on that field,
 * or Continue on the screen that asks it. Attribution is on the state
 * (`state.assistant`), so a reload keeps it and the submit records it.
 */

export const ASSISTANT_FIELDS = ["jobType", "propertyKind", "bedrooms", "storeys", "scope", "changing", "bold", "condition", "occupied"] as const;
export type AssistantField = (typeof ASSISTANT_FIELDS)[number];

/** Which quick-look screen asks (and so confirms) which fields. */
export const STEP_FIELDS: Partial<Record<QuickLookStep, AssistantField[]>> = {
  start: ["jobType"],
  place: ["propertyKind", "bedrooms", "storeys"],
  job: ["scope", "changing", "bold"],
  condition: ["condition", "occupied"],
};

export type AssistantAttribution = { wrote: string[]; at: string; source: "describe" };

export function quickLookFromBrief(x: BriefExtraction, current: QuickLook): { quick: QuickLook; wrote: AssistantField[] } {
  const wrote: AssistantField[] = [];
  const next: QuickLook = { ...current, changing: { ...current.changing } };
  const put = <K extends AssistantField>(key: K, value: QuickLook[K] | null | undefined) => {
    if (value == null) return;
    (next as QuickLook)[key] = value;
    if (!wrote.includes(key)) wrote.push(key);
  };

  put("jobType", x.jobType);
  put("propertyKind", x.propertyKind);
  if (x.bedrooms != null && x.bedrooms >= 1) put("bedrooms", Math.min(5, x.bedrooms));
  put("storeys", x.storeys);

  // Scope from the surfaces named: only walls/ceilings → that preset; only
  // the woodwork → trims and doors; anything wider → the whole interior.
  if (x.surfaces.length) {
    const s = new Set<string>(x.surfaces);
    const wood = ["doors", "architraves", "skirting", "windows"];
    const onlyWallsCeilings = [...s].every((k) => k === "walls" || k === "ceilings" || k === "cornices");
    const onlyWood = [...s].every((k) => wood.includes(k));
    put("scope", onlyWallsCeilings ? "walls_ceilings" : onlyWood ? "trims_doors" : "whole");
  }

  // Colour intent → the changing tiles and the bold flag (C9's derivation
  // then rebuilds `colour` from them, as it does for a tap).
  if (x.coats === "fresh") {
    put("changing", { walls: false, ceilings: false, trims: false, windows: false });
    put("bold", false);
  } else if (x.coats === "change") {
    put("changing", { walls: true, ceilings: x.surfaces.includes("ceilings"), trims: false, windows: false });
    put("bold", false);
  } else if (x.coats === "dark_to_light") {
    put("changing", { walls: true, ceilings: x.surfaces.includes("ceilings"), trims: false, windows: false });
    put("bold", true);
  }

  // Condition from the defects named: severity 3 anywhere → needs work; any
  // defect → some wear; "no damage" wording is the extractor's null, left alone.
  if (x.defects.length) {
    const worst = Math.max(...x.defects.map((d) => d.severity));
    put("condition", worst >= 3 ? "needs_work" : "wear");
  }
  if (x.occupied != null) put("occupied", x.occupied ? "yes" : "no");

  next.colour = colourFromChanges(next);
  return { quick: next, wrote };
}

/** A tap on a field, or Continue on its screen, confirms it: it leaves `wrote`. */
export function confirmAssistantFields(att: AssistantAttribution | null, fields: readonly string[]): AssistantAttribution | null {
  if (!att) return null;
  const left = att.wrote.filter((f) => !fields.includes(f));
  return left.length ? { ...att, wrote: left } : null;
}

export function confirmAssistantStep(att: AssistantAttribution | null, step: QuickLookStep): AssistantAttribution | null {
  return confirmAssistantFields(att, STEP_FIELDS[step] ?? []);
}

/** The bubble's one-line reply after a fill-in, in the customer's words. */
export function describeReply(wrote: readonly string[], notes: { unmapped: string[]; injected: string[] }): string {
  const n = wrote.length;
  const head = n === 0
    ? "I couldn't pick out the answers from that — tap them in on the screen, or tell me the rooms, the surfaces and the condition."
    : `Filled in ${n} answer${n === 1 ? "" : "s"} from what you wrote — they're marked as ours until you confirm them on each screen.`;
  const tail = notes.unmapped.length ? ` I've noted "${notes.unmapped[0]}" for your estimator to price on the visit.` : "";
  return head + tail;
}
