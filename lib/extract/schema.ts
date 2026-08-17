import { z } from "zod";

/**
 * What the model is allowed to return (build brief, section 2 stage 2).
 *
 * The rule the whole design rests on: THE MODEL IDENTIFIES, THE CODE COMPUTES.
 * Nothing in here is a price, an hour or a square metre of surface. The model
 * reports what it can see — room names, printed dimensions, door and window
 * symbols — and every derived quantity is worked out afterwards in code that
 * can be tested and calibrated.
 *
 * Amended from the brief in two places, both from reading nine real listing
 * plans (docs/plan-reader-corpus-findings.md):
 *
 *   1. `storeys` is a LIST. Three of the nine put ground and first floor on one
 *      image and one had four levels; the brief assumed one page = one storey.
 *
 *   2. Every room carries `dimension_source`, including "not_dimensioned".
 *      Bathrooms, kitchens, laundries and halls are labelled but not
 *      dimensioned on effectively every marketing plan, and those rooms still
 *      get painted.
 */

export const PROMPT_VERSION = "floorplan-2026-08-17-a";

const confidence = z.number().min(0).max(1);

/** Where a number came from. Never "guessed" — omission is the alternative. */
export const measurementSource = z.enum(["read", "derived", "scale_bar", "not_dimensioned"]);

export const roomTypes = [
  "bedroom", "living", "dining", "kitchen", "bathroom", "wc", "laundry",
  "hallway", "study", "storage", "garage", "exterior", "unknown",
] as const;

export const doorSchema = z.object({
  type: z.enum(["internal_hinged", "sliding", "cased_opening", "external", "garage", "unknown"]),
  width_m: z.number().positive().max(6).nullable(),
  confidence,
});

export const windowSchema = z.object({
  size_class: z.enum(["small", "medium", "large", "unknown"]),
  confidence,
});

export const roomSchema = z.object({
  name_on_plan: z.string().max(80).nullable(),
  normalised_type: z.enum(roomTypes),
  storey: z.string().max(20),
  length_m: z.number().positive().max(60).nullable(),
  width_m: z.number().positive().max(60).nullable(),
  dimension_source: measurementSource,
  dimension_confidence: confidence,
  /** Only when printed on the plan. Never estimated — that is the code's job. */
  area_m2_printed: z.number().positive().max(1000).nullable(),
  irregular: z.boolean(),
  doors: z.array(doorSchema).max(20),
  windows: z.array(windowSchema).max(20),
  openings_no_door: z.number().int().min(0).max(10),
  wet_area: z.boolean(),
  notes_read_from_plan: z.string().max(200),
});

export const storeySchema = z.object({
  label: z.string().max(30),
  kind: z.enum(["ground", "first", "second", "basement", "unknown"]),
  stated_area_m2: z.number().positive().max(2000).nullable(),
});

export const extractionSchema = z.object({
  storeys: z.array(storeySchema).min(1).max(6),
  scale: z.object({
    method: z.enum(["labelled_dimensions", "scale_bar", "stated_total_area", "none"]),
    stated_total_area_m2: z.number().positive().max(5000).nullable(),
    /** Printed on the plan, e.g. "NOT TO SCALE". Disables pixel measurement. */
    not_to_scale_disclaimer: z.boolean(),
    confidence,
  }),
  ceiling_height_m: z.number().positive().max(6).nullable(),
  rooms: z.array(roomSchema).max(60),
  has_site_plan: z.boolean(),
  unreadable_regions: z.array(z.object({
    description: z.string().max(200),
    impact: z.enum(["low", "medium", "high"]),
  })).max(20),
});

export type Extraction = z.infer<typeof extractionSchema>;
export type ExtractedRoom = z.infer<typeof roomSchema>;
export type RoomType = (typeof roomTypes)[number];

/**
 * The same shape as a JSON Schema for the model's tool. Written by hand rather
 * than generated so the descriptions can carry the instructions that matter —
 * the model reads these, and they are where "do not guess" actually lives.
 */
export const EXTRACTION_TOOL = {
  name: "report_floorplan",
  description: "Report what is legible on this floorplan page. Never guess a number.",
  input_schema: {
    type: "object" as const,
    properties: {
      storeys: {
        type: "array",
        description: "Every storey drawn on THIS page. Marketing plans often put ground and first floor side by side.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "As printed, e.g. 'Ground Floor'" },
            kind: { type: "string", enum: ["ground", "first", "second", "basement", "unknown"] },
            stated_area_m2: { type: ["number", "null"], description: "Only if an area is printed for this storey" },
          },
          required: ["label", "kind", "stated_area_m2"],
        },
      },
      scale: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["labelled_dimensions", "scale_bar", "stated_total_area", "none"] },
          stated_total_area_m2: { type: ["number", "null"] },
          not_to_scale_disclaimer: {
            type: "boolean",
            description: "True if the plan prints 'not to scale' or similar anywhere.",
          },
          confidence: { type: "number" },
        },
        required: ["method", "stated_total_area_m2", "not_to_scale_disclaimer", "confidence"],
      },
      ceiling_height_m: { type: ["number", "null"], description: "ONLY if printed on the plan. Otherwise null." },
      rooms: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name_on_plan: { type: ["string", "null"], description: "Exactly as printed. Null if the space is unlabelled." },
            normalised_type: { type: "string", enum: [...roomTypes] },
            storey: { type: "string", description: "The label of the storey this room is on" },
            length_m: { type: ["number", "null"], description: "The larger printed dimension. Null if not printed." },
            width_m: { type: ["number", "null"], description: "The smaller printed dimension. Null if not printed." },
            dimension_source: {
              type: "string",
              enum: ["read", "derived", "scale_bar", "not_dimensioned"],
              description: "'read' ONLY when the numbers are printed beside the room name. Use 'not_dimensioned' for rooms with a label and no numbers - this is normal for bathrooms, kitchens, laundries and halls.",
            },
            dimension_confidence: { type: "number" },
            area_m2_printed: { type: ["number", "null"] },
            irregular: { type: "boolean", description: "True for L-shaped or angled rooms" },
            doors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["internal_hinged", "sliding", "cased_opening", "external", "garage", "unknown"] },
                  width_m: { type: ["number", "null"] },
                  confidence: { type: "number" },
                },
                required: ["type", "width_m", "confidence"],
              },
            },
            windows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  size_class: { type: "string", enum: ["small", "medium", "large", "unknown"] },
                  confidence: { type: "number" },
                },
                required: ["size_class", "confidence"],
              },
            },
            openings_no_door: { type: "integer", description: "Cased openings with no door leaf" },
            wet_area: { type: "boolean" },
            notes_read_from_plan: { type: "string" },
          },
          required: [
            "name_on_plan", "normalised_type", "storey", "length_m", "width_m",
            "dimension_source", "dimension_confidence", "area_m2_printed", "irregular",
            "doors", "windows", "openings_no_door", "wet_area", "notes_read_from_plan",
          ],
        },
      },
      has_site_plan: { type: "boolean", description: "True if a site/block plan shares this page" },
      unreadable_regions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            impact: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["description", "impact"],
        },
      },
    },
    required: ["storeys", "scale", "ceiling_height_m", "rooms", "has_site_plan", "unreadable_regions"],
  },
};
