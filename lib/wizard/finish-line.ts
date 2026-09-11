import type { CustomerPayload } from "./view";
import type { PaintSystemLine } from "./systems-view";
import type { SiteAccess } from "./site-access";

/**
 * THE FINISH LINE — estimator journey v2 §3, prototype screen 10.
 *
 * "The detailed range, the summary of everything they told us, and the fixing
 * options chosen by the policy ladder."
 *
 * Two things make this screen worth existing rather than being a button at
 * the bottom of the editor:
 *
 *   1. **It reads their answers back before they commit.** Every row here is
 *      something the price depends on, in their words, with a way to change
 *      it. A customer who accepts a number they cannot check is a complaint
 *      waiting to be made.
 *
 *   2. **It states what is NOT in the range.** Access equipment, structural
 *      repairs, anything nobody has seen. Said here, once, plainly — an
 *      exclusion a customer finds out about later is an argument.
 *
 * Pure: the caller has already priced and routed. Nothing here computes money
 * or decides a tier — it turns what the ladder already decided into sentences.
 */

/** One line of "what you've told us", and where to go and change it. */
export type SummaryRow = {
  key: string;
  /** The customer's own answer, read back. */
  text: string;
  /** The card in the editor that owns it — the "Change" link's target. */
  card: string;
};

export type FinishOption = {
  key: "fix_online" | "send_for_confirmation" | "book_visit";
  icon: string;
  title: string;
  body: string;
};

/**
 * The fixing options, chosen by the ladder — never re-derived here.
 *
 * `canAccept` is the SERVER's verdict (policy.ts), and the two shapes are
 * genuinely different offers: a job that qualifies can have its price fixed
 * on the spot, and one that does not is sent to a person. Both keep a visit
 * available, because §1's rule is that the two doors have no hierarchy.
 */
export function finishOptions(
  payload: CustomerPayload,
  fixedPriceText: string,
  /**
   * C4 — which walk this was. An exterior job has no rooms and no derived paint
   * systems, so "checks your rooms, systems and photos" described a job the
   * customer had not given us. Defaults to rooms, which is every existing
   * caller.
   */
  kind: "rooms" | "sides" = "rooms",
  /**
   * C7 — how long the price is held, in the customer's words, from Settings
   * (`holdWords(holdDaysFromSettings(...))`). It was the literal "60 days"
   * here. The day Tom changes that promise, the door that makes it has to
   * change with the date we hold to — one setting, or we say 60 and honour 30.
   */
  holdText: string = "held for 60 days",
): FinishOption[] {
  if (payload.canAccept) {
    return [
      {
        key: "fix_online",
        icon: "✓",
        title: "Fix my price online",
        body: `Everything's confirmed and the job is within what we fix without a visit. Your price becomes ${fixedPriceText} inc. GST, ${holdText}. Nothing to pay now.`,
      },
      {
        key: "book_visit",
        icon: "☎",
        title: "Have a person check it first",
        body: "Happy either way. Send it over and we'll confirm it, or book a visit.",
      },
    ];
  }
  return [
    {
      key: "send_for_confirmation",
      icon: "✓",
      title: "Send for confirmation",
      body: kind === "sides"
        ? "One of our estimators checks your sides, the surfaces and your photos and fixes your price. Every outside job is signed off by a person — usually from what you've given us, and we'll say so if we need to see it."
        : "One of our estimators checks your rooms, systems and photos and fixes your price — usually by the next working day, and usually without a visit. If we do need to see it, we'll say so and offer times.",
    },
    {
      key: "book_visit",
      icon: "☎",
      title: "Book a site visit instead",
      body: "Prefer someone to walk it with you? Pick a time. We arrive with your answers already on the tablet.",
    },
  ];
}

/**
 * What is NOT in the range. Said on the screen where they decide, not in a
 * footer nobody reads — and the walk-the-job promise beside it, because the
 * honest version of an exclusion is "here is what protects you instead".
 */
export const NOT_INCLUDED =
  "Not in this range: access equipment hire, structural repairs, and anything we can't see yet. "
  + "Your painter walks the job with you on the last day — nothing is finished until you say so.";

export type SummaryInput = {
  payload: CustomerPayload;
  systems: PaintSystemLine[];
  access: SiteAccess;
  /** Whole-job extras the customer ticked, in their own words. */
  extras: string[];
  /** Flagged spots, as "a crack, a water mark, flaking". */
  spots: string[];
  /** Rooms with a confirmed size. */
  roomsConfirmed: number;
  roomsTotal: number;
  /**
   * C4 (audit 9.4) — the exterior half. An exterior-only job has no rooms and
   * no paint systems, so without this the summary said nothing at all and the
   * finish line had no reason to exist. Absent on an interior job.
   */
  sides?: {
    done: number;
    total: number;
    storeys: "single" | "double" | null;
    substrates: string[];
    windows: number;
    doors: number;
    /** The whole-job exterior condition answers, as given. */
    condition: "good" | "weathered" | "peeling" | null;
    rot: "no" | "little" | "lots" | null;
    access: "steep" | "tight" | "high" | "none" | null;
  } | null;
};

/**
 * "What you've told us" — one row per thing the price depends on.
 *
 * Rows that would say nothing are LEFT OUT rather than shown empty. A summary
 * padded with "no extras" and "no spots flagged" teaches people to stop
 * reading it, and the whole value of this screen is that it gets read.
 */
export function summaryRows(input: SummaryInput): SummaryRow[] {
  const rows: SummaryRow[] = [];

  if (input.roomsTotal > 0) {
    rows.push({
      key: "rooms",
      card: "rooms",
      text: input.roomsConfirmed >= input.roomsTotal
        ? `${input.roomsTotal} ${input.roomsTotal === 1 ? "room" : "rooms"}, sizes confirmed`
        : `${input.roomsTotal} ${input.roomsTotal === 1 ? "room" : "rooms"} — ${input.roomsTotal - input.roomsConfirmed} still to confirm`,
    });
  }

  if (input.systems.length > 0) {
    rows.push({
      key: "systems",
      card: "systems",
      // The painter's own summary, joined — "walls 2 coats · ceilings 1 coat ·
      // skirtings, architraves and door frames 2 coats (one an undercoat)".
      text: input.systems
        .map((s) => `${s.title.toLowerCase()} ${s.coats} ${s.coats === 1 ? "coat" : "coats"}${s.undercoat ? " (one an undercoat)" : ""}`)
        .join(" · "),
    });
  }

  const x = input.sides;
  if (x && x.total > 0) {
    rows.push({
      key: "sides",
      card: "rooms",
      text: x.done >= x.total
        ? `${x.total} ${x.total === 1 ? "side" : "sides"}, all checked`
        : `${x.total} ${x.total === 1 ? "side" : "sides"} — ${x.total - x.done} still to check`,
    });
  }
  if (x && (x.storeys || x.substrates.length > 0)) {
    const bits = [
      x.storeys === "double" ? "double storey" : x.storeys === "single" ? "single storey" : null,
      x.substrates.length > 0 ? listWords(x.substrates) : null,
    ].filter(Boolean) as string[];
    rows.push({ key: "geo", card: "rooms", text: capitalise(bits.join(", ")) });
  }
  if (x && (x.windows > 0 || x.doors > 0)) {
    const bits = [
      x.windows > 0 ? `${x.windows} ${x.windows === 1 ? "window" : "windows"}` : null,
      x.doors > 0 ? `${x.doors} ${x.doors === 1 ? "door" : "doors"}` : null,
    ].filter(Boolean) as string[];
    rows.push({ key: "dw", card: "rooms", text: capitalise(bits.join(" and ")) });
  }
  const extCond = x ? exteriorConditionSentence(x) : null;
  if (extCond) rows.push({ key: "ext_condition", card: "access", text: extCond });

  if (input.spots.length > 0) {
    rows.push({
      key: "spots",
      card: "rooms",
      text: `${input.spots.length} ${input.spots.length === 1 ? "spot" : "spots"} flagged — ${listWords(input.spots)}`,
    });
  }

  const accessWords = accessSentence(input.access);
  if (accessWords) rows.push({ key: "access", card: "access", text: accessWords });

  if (input.extras.length > 0) {
    rows.push({ key: "extras", card: "extras", text: listWords(input.extras) });
  }

  return rows;
}

/**
 * The exterior's condition answers as one sentence — the same shape as the
 * interior's access line, so the two branches read alike on the same screen.
 */
function exteriorConditionSentence(x: NonNullable<SummaryInput["sides"]>): string | null {
  const parts: string[] = [];
  if (x.condition === "good") parts.push("paint in good order");
  else if (x.condition === "weathered") parts.push("weathered paint");
  else if (x.condition === "peeling") parts.push("peeling paint");
  if (x.rot === "little") parts.push("a little rot");
  else if (x.rot === "lots") parts.push("rot to deal with");
  if (x.access === "steep") parts.push("steep ground");
  else if (x.access === "tight") parts.push("tight access");
  else if (x.access === "high") parts.push("height to work at");
  return parts.length ? capitalise(parts.join(", ")) : null;
}

/** The access answers as one sentence, skipping anything not answered. */
function accessSentence(a: SiteAccess): string | null {
  const parts: string[] = [];
  if (a.cleared === "yes") parts.push("rooms cleared");
  else if (a.cleared === "some") parts.push("mostly cleared");
  else if (a.cleared === "no") parts.push("furniture stays");
  if (a.stairwell === "yes") parts.push("a stairwell or void");
  if (a.parking === "hard") parts.push("tricky parking");
  if (a.lift === "yes") parts.push("a lift booking");
  if (a.pets === "yes") parts.push("pets on site");
  return parts.length ? capitalise(parts.join(", ")) : null;
}

function listWords(items: string[]): string {
  const words = items.map((s) => s.toLowerCase());
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The three steps on the hand-off screen (§3, prototype screen 11).
 *
 * Concrete, in order, and counted from what this job actually carries — "8
 * rooms, 3 flagged spots and your photos" rather than a generic reassurance.
 * A customer who has just handed over their job wants to know what happens to
 * it, and vagueness there is what makes people ring to check.
 */
export function handoffSteps(input: {
  roomsTotal: number;
  spots: number;
  photos: number;
  turnaround: string;
}): Array<{ title: string; body: string }> {
  const carried = [
    input.roomsTotal > 0 ? `${input.roomsTotal} ${input.roomsTotal === 1 ? "room" : "rooms"}` : null,
    input.spots > 0 ? `${input.spots} flagged ${input.spots === 1 ? "spot" : "spots"}` : null,
    input.photos > 0 ? `your ${input.photos === 1 ? "photo" : "photos"}` : null,
  ].filter(Boolean) as string[];

  return [
    {
      title: "We check what you've told us",
      body: `${carried.length ? `${capitalise(listWords(carried))}. ` : ""}Anything unclear, we'll message rather than guess.`,
    },
    {
      title: "We fix your price",
      body: `Usually ${input.turnaround}. It arrives by email, with everything itemised.`,
    },
    {
      title: "If we need a look in person, we'll say so",
      body: "Most jobs like this one don't. If yours does, pick a time below and we'll come out.",
    },
  ];
}

/** ⚑ Tom, decision 13: "confirm what you can hold to on a busy week." */
export const DEFAULT_TURNAROUND = "by the next working day";

/**
 * "SEND TO SARAH" — the CTA, v2.4 (C7).
 *
 * The button said "Finalise my price", which is what the customer is doing but
 * not what is about to happen: they are handing their job to a person, and
 * every screen after this one names that person. A button that hides them and
 * a hand-off screen that introduces them are describing the same tap two
 * different ways.
 *
 * The name comes from a RECORD — the estimator whose patch covers the postcode
 * (`profiles.name`), or the coordinator in Settings — and never from a string
 * in a component. When we have nobody to name, the old label stands: an
 * invented first name is worse than a generic button, and "Send to Felipe"
 * when Felipe does not work here is the kind of small lie a customer catches.
 */
export function firstName(full: string | null | undefined): string | null {
  const trimmed = (full ?? "").trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  // A single initial ("J Smith") is not a name to greet somebody with.
  return first.replace(/[.,]$/, "").length > 1 ? first.replace(/[.,]$/, "") : null;
}

export function sendToLabel(estimatorName: string | null | undefined): string {
  const name = firstName(estimatorName);
  return name ? `Send to ${name}` : "Finalise my price";
}

/**
 * WHO HAS IT — the hand-off screen's estimator line (C7, prototype s-handoff).
 *
 * The prototype introduces "Sarah Reid — your estimator" with a sentence about
 * why she is in the loop. Two things make that line true rather than
 * decorative: the name comes from `profiles`, and the PATCH is stated in terms
 * the customer recognises — their own suburb, not a list of postcodes. "Sarah
 * looks after Brunswick" is a fact a customer can check; "patch: 3056, 3057,
 * 3058" is an internal field shown to the wrong audience.
 *
 * No pronoun is invented for anybody. We know an estimator's name from a
 * record; we do not know their pronouns, and a screen that guesses wrong about
 * a real colleague in front of a customer is worse than a plainer sentence.
 *
 * `covers` false means the name came from the Settings coordinator rather than
 * a patch match — so the line drops the geography instead of claiming a patch
 * nobody was assigned.
 */
export function estimatorLine(input: {
  name: string | null | undefined;
  suburb?: string | null;
  covers: boolean;
}): string | null {
  const name = firstName(input.name);
  if (!name) return null;
  const suburb = (input.suburb ?? "").trim();
  return input.covers && suburb
    ? `${name} looks after ${suburb}, and will be the one confirming your price.`
    : `${name} will be the one confirming your price.`;
}
