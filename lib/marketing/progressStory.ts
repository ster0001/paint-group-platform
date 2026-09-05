/**
 * The 22-second progress story (brief §4.7) as ONE timeline: every visual
 * on the phone and the caption beside it are a pure function of elapsed
 * milliseconds. The component keeps one clock (paused on tab blur) and
 * renders `storyStateAt(t)` — nothing is chained on setTimeout, so captions
 * and phone beats cannot drift from each other, and the drift test below
 * asserts it.
 *
 * Timings are the prototype's BEATS[] (ms from play start).
 */
export type AreaKey = "living" | "hall" | "bed1" | "bed2" | "kitchen";
export type AreaState = "todo" | "prepped" | "done";

export const STORY_AREAS: ReadonlyArray<{ key: AreaKey; label: string }> = [
  { key: "living", label: "Living room" },
  { key: "hall", label: "Hallway" },
  { key: "bed1", label: "Main bedroom" },
  { key: "bed2", label: "Bedroom 2" },
  { key: "kitchen", label: "Kitchen" },
];

export const STORY_BEATS: ReadonlyArray<{ at: number; caption: string }> = [
  { at: 0, caption: "Monday, 7:31am. Felipe's on site." },
  { at: 2000, caption: "You get a message before the first brush touches a wall." },
  { at: 5000, caption: "Photos from the site." },
  { at: 8000, caption: "Every area ticked off as it's finished. No guessing." },
  { at: 11000, caption: "An update in plain words at the end of each day." },
  { at: 14500, caption: "Anything extra is priced and approved by you before it starts." },
  { at: 17500, caption: "Then you walk it with us, room by room." },
  { at: 20000, caption: "You sign off. Then you pay." },
];
export const STORY_END_MS = 22000;
export const STORY_CAPTIONS = STORY_BEATS.map((b) => b.caption);

export const UPDATE_TEXT = "Living room finished and looking great. Hallway has its first coat. Second coat first thing tomorrow. Back on site at 7:30.";
const UPDATE_CHAR_MS = 22;
export const VARIATION_PRESS_AT = 14500 + 1500;
export const VARIATION_APPROVED_AT = 14500 + 1700;
export const WALKTHROUGH_BANNER_AT = 17500 + 1400;
const AREA_TICK_GAP_MS = 300;

export type StoryState = {
  /** Which caption is showing (index into STORY_BEATS); -1 before play. */
  captionIndex: number;
  day: 1 | 3 | 5;
  progress: 0 | 8 | 48 | 100;
  areas: Record<AreaKey, { state: AreaState; sub: string }>;
  photos: number;
  banner: { text: string; bold: string } | null;
  update: string | null;
  variation: "hidden" | "waiting" | "pressed" | "approved";
  signed: boolean;
  done: boolean;
};

const DONE_SUB = "Walls ✓ Ceiling ✓ Trim ✓";

export function storyStateAt(t: number): StoryState {
  const areas: StoryState["areas"] = {
    living: { state: "todo", sub: "Not started" },
    hall: { state: "todo", sub: "Not started" },
    bed1: { state: "todo", sub: "Not started" },
    bed2: { state: "todo", sub: "Not started" },
    kitchen: { state: "todo", sub: "Not started" },
  };
  const s: StoryState = { captionIndex: -1, day: 1, progress: 0, areas, photos: 0, banner: null, update: null, variation: "hidden", signed: false, done: false };
  if (t < 0) return s;

  s.captionIndex = STORY_BEATS.reduce((idx, b, i) => (t >= b.at ? i : idx), 0);

  if (t >= 2000) { s.banner = { bold: "Felipe M.", text: "Furniture moved, floors covered. Starting the living room." }; s.progress = 8; }
  if (t >= 5000) { s.banner = null; s.photos = 2; areas.living = { state: "prepped", sub: "Masked up, first coat next" }; }
  if (t >= 8000) { s.day = 3; s.progress = 48; areas.living = { state: "done", sub: DONE_SUB }; }
  if (t >= 8400) areas.hall = { state: "prepped", sub: "First coat on" };
  if (t >= 11000) { const n = Math.min(UPDATE_TEXT.length, Math.floor((t - 11000) / UPDATE_CHAR_MS)); s.update = UPDATE_TEXT.slice(0, n); }
  if (t >= 14500) { s.update = null; s.variation = "waiting"; }
  if (t >= VARIATION_PRESS_AT) s.variation = "pressed";
  if (t >= VARIATION_APPROVED_AT) s.variation = "approved";
  if (t >= 17500) {
    s.variation = "hidden"; s.day = 5; s.progress = 100;
    (["hall", "bed1", "bed2", "kitchen"] as AreaKey[]).forEach((k, i) => { if (t >= 17500 + i * AREA_TICK_GAP_MS) areas[k] = { state: "done", sub: DONE_SUB }; });
  }
  if (t >= WALKTHROUGH_BANNER_AT) s.banner = { bold: "Walkthrough booked", text: "· Fri 3:30pm, with you on site." };
  if (t >= 20000) { s.banner = null; s.signed = true; }
  if (t >= STORY_END_MS) s.done = true;
  return s;
}

/** The end state — what reduced motion shows, and what the phone holds after 22 s. */
export const storyFinalState = (): StoryState => storyStateAt(STORY_END_MS);
