"use client";

import { useState, type ReactNode } from "react";
import {
  CHANGING_GROUPS, CONDITION_BANDS, JOB_TYPES, OCCUPIED, PROPERTY_KINDS,
  SCOPE_PRESETS, STOREYS, changingForScope, stepCount, toggleChanging, visibleChanging, type Choice, type QuickLook, type QuickLookStep, exclusionOptions, toggleExcluded,
} from "@/lib/wizard/quick-look";
import {
  EXTERIOR_PROMISE, EXT_ACCESS, EXT_COLOURS, EXT_ELEMENTS, EXT_MATERIALS, EXT_SIDES, EXT_STANDALONE, EXT_STOREYS, EXT_WINDOW_TYPES, ALL_SIDES,
  toggleAccess, toggleIn, toggleMaterial,
  type ExteriorQuickLook,
} from "@/lib/wizard/exterior-quick-look";
import { AreasScreen, BookScreen, BriefScreen, JobScreen, SegmentScreen, WarehouseScreen, type BookContact } from "./CommercialScreens";
import type { BriefAnswers, CommercialAnswers, Segment, SegmentBrief } from "@/lib/wizard/segments";
import { starterRoomNames } from "@/lib/wizard/some-rooms";
import { ExteriorPickTiles } from "./ExteriorTiles";
import { WINDOW_DRAWINGS } from "@/app/estimate/scope/StyleTiles";

/** C12: what the commercial screens need from WizardApp. */
export type CommercialQuickProps = {
  segments: Segment[];
  segmentKey: string | null;
  segment: Segment | null;
  onSegment: (key: string) => void;
  answers: CommercialAnswers | null;
  onAnswers: (patch: Partial<CommercialAnswers>) => void;
  photoCount: number;
  onPhotos: () => void;
  /** C14: the brief path — the config the door opened, the answers, the booking. */
  door: "range" | "brief" | "brief_after_areas";
  briefConfig: SegmentBrief | null;
  brief: BriefAnswers | null;
  onBrief: (patch: Partial<BriefAnswers>) => void;
  slots: string[];
  slot: string | null;
  onSlot: (s: string | null) => void;
  contact: BookContact;
  onContact: (patch: Partial<BookContact>) => void;
  bookError: string | null;
  holdDays: number;
};

/**
 * The QUICK LOOK — four screens, about nine taps, then a range.
 *
 * Estimator journey v2 §3, phase 2. This replaces the five-page interior
 * wizard (property → surfaces → condition → details → contact) that §2 takes
 * apart: it asked 25-30 answers, made the customer choose a route before
 * showing them anything, and put the contact form in front of the price.
 *
 * Every screen here follows the same rule: **ask only what a person standing
 * in their own hallway can answer.** Bedrooms, storeys, what needs painting,
 * whether the colours are changing, how it looks. Nothing about coats, film
 * builds, substrates or ceiling heights to the nearest 300 mm — those are our
 * job, derived from these answers and shown back on the reveal screen where
 * they can be corrected in context.
 *
 * Presentational on purpose: WizardApp owns the state, the address lookup and
 * the submit. This file owns the questions and their words.
 */

const BEDROOMS = [1, 2, 3, 4, 5];

export default function QuickLook({
  step, quick, onQuick, outside, onOutside, addressField, needsWork, error, canContinue, busy, onBack, onNext, stepNo, stepsTotal,
  onBook, onChooseBoth, phone, commercial = null, assumed = [], planUpload = null,
  planRooms = null, planPreviewUrl = null, planPending = false, addedRooms = [], onAddRoom = () => undefined, onRemoveAdded = () => undefined,
}: {
  /** Tom, 14 Sep (evening): the confirm-rooms step — the plan's rooms (or the starter list), a preview, and the rooms added by hand. */
  planRooms?: Array<{ name: string; roomType: string }> | null;
  planPreviewUrl?: string | null;
  planPending?: boolean;
  addedRooms?: Array<{ name: string; roomType: string }>;
  onAddRoom?: (room: { name: string; roomType: string }) => void;
  onRemoveAdded?: (index: number) => void;
  /** Tom, 14 Sep: the floorplan / listing upload, on the place screen of an inside job. */
  planUpload?: ReactNode;
  /** C16 (a): the quick-look fields the assistant filled in from "describe it" — amber until confirmed. */
  assumed?: string[];
  /** C12: the commercial screens (segment, areas, job), rendered from the row. */
  commercial?: CommercialQuickProps | null;
  /** C8: "Book someone in" on screen 1, and "book an estimator for both" — opens the Save & book sheet. */
  onBook: () => void;
  /** C8: the "both" choice screen (prototype `s-both`). */
  onChooseBoth: (how: "self" | "book") => void;
  /** The office number, for "Call us". Null = the card offers booking only. */
  phone: string | null;
  step: QuickLookStep;
  quick: QuickLook;
  onQuick: (patch: Partial<QuickLook>) => void;
  /** The exterior answers (prototype `s-ext-job`), for outside and both jobs. */
  outside: ExteriorQuickLook;
  onOutside: (patch: Partial<ExteriorQuickLook>) => void;
  /** The address input, wired by WizardApp (Places lookup + service area). */
  addressField: ReactNode;
  /** ⚑14's condition box, on the screen that asks about condition. */
  /** Tom, 15 Sep: under "Needs work" — optional photos and a description, and the estimator-check line. */
  needsWork: { note: string; onNote: (v: string) => void; photoCount: number; onPhotos: () => void; onClearPhotos: () => void };
  error: string | null;
  canContinue: boolean;
  busy: boolean;
  onBack: (() => void) | null;
  onNext: () => void;
  stepNo: number;
  stepsTotal: number;
}) {
  /** Tom, 14 Sep (evening): the "anything NOT being painted?" popup, open right after a preset is picked. */
  // Tom, 15 Sep (late): an outside job ends on the sides screen, not the outside screen.
  const last = quick.jobType === "interior" ? step === "condition" || step === "com_job" : step === "sides";
  // C16 (a): the amber tag under a field the assistant filled in. A tap on
  // the field, or Continue on this screen, confirms it and the tag goes.
  const tag = (field: string) => assumed.includes(field)
    ? <span className="wz-assumed-tag" data-testid={`assumed-${field}`}>From what you told us — tap to change, or continue to confirm</span>
    : null;
  const pattern = commercial?.segment?.config.pattern === "warehouse" ? "warehouse" as const : "areas" as const;
  const door = commercial?.door ?? "range";
  // C14: the booking screen's button books; it never says "range".
  const nextLabel = step === "com_book" ? "Book it" : last ? "See my guide range" : "Continue";

  return (
    <div className="wz-wrap wz-quick" data-quick-step={step}>
      {step === "start" && (
        <>
          <p className="wz-kick">A minute to a guide range</p>
          <h1>Let&rsquo;s price your painting</h1>
          {/**
            * AUDIT 9.3(b): this said "Four quick screens" on every branch, and
            * `stepsFor` returns THREE for Outside and FIVE for Both — so the
            * promise was false on two of three paths while the dots below it
            * showed the real number, and the screen contradicted itself. The
            * count is computed, never typed.
            */}
          <p className="wz-sub">
            {stepCount(quick.jobType, quick.propertyKind, pattern, door, quick.scope)} quick screens, then a guide range. Everything after that is
            optional — and nothing you say here is a commitment.
          </p>
          {addressField}
          <p className="wz-qhead">What&rsquo;s being painted?</p>
          <Chips options={JOB_TYPES} value={quick.jobType} onPick={(jobType) => onQuick({ jobType })} name="jobtype" />
          {tag("jobType")}

          {/*
            C8 — the way out, on screen 1 (prototype `s-start`): "for the
            time-poor customer who wants a human. It's large, it's on screen
            1, and the same Save & book pill sits in the header of every
            screen after it — so leaving is never a dead end and everything
            typed so far goes with them."
          */}
          <div className="wz-rather" data-testid="ql-rather-not">
            <b>Rather not fill anything in?</b>
            <p>Book an estimator or call us. Either takes about a minute, and we do the rest.</p>
            <div className="wz-rather-row">
              <button type="button" className="wz-btn wz-bs2" onClick={onBook} data-testid="ql-book">Book someone in</button>
              {phone && (
                <a className="wz-btn wz-bs2" href={`tel:${phone.replace(/\s+/g, "")}`} data-testid="ql-call">Call us</a>
              )}
            </div>
          </div>
        </>
      )}

      {/*
        C8 — INSIDE AND OUTSIDE (prototype `s-both`): "inside and outside price
        on different trees (rooms vs sides), so 'both' is really two quick
        looks." The customer chooses: answer both, one after the other, or
        book one visit for the lot. Both keep everything saved.
      */}
      {step === "both" && (
        <>
          <p className="wz-kick">Inside and outside</p>
          <h1>Two jobs — two ways to do this</h1>
          <p className="wz-sub">
            Inside and outside are priced differently, so we take them one at a time. Pick whichever suits you.
          </p>
          <div className="wz-doors" data-testid="ql-both">
            <button type="button" className="wz-door" onClick={() => onChooseBoth("self")} data-testid="ql-both-self">
              <span className="wz-door-icon" aria-hidden="true">◫</span>
              <span className="wz-door-text">
                <b>Price them yourself, one after the other</b>
                <span>Inside first, then outside. About a minute to a guide range for each, and you can tighten either one whenever you like.</span>
              </span>
              <span className="wz-door-go" aria-hidden="true">›</span>
            </button>
            <button type="button" className="wz-door" onClick={() => onChooseBoth("book")} data-testid="ql-both-book">
              <span className="wz-door-icon" aria-hidden="true">☎</span>
              <span className="wz-door-text">
                <b>Book an estimator for both</b>
                <span>One visit covers the lot. Takes a minute to book, and you don&rsquo;t have to answer anything else.</span>
              </span>
              <span className="wz-door-go" aria-hidden="true">›</span>
            </button>
          </div>
          <p className="wz-chint">Either way your answers are saved, and a person can pick up wherever you leave off.</p>
        </>
      )}

      {step === "place" && (
        <>
          <p className="wz-kick">About the place</p>
          <h1>What kind of property is it?</h1>
          <p className="wz-sub">
            Near enough is fine — this seeds the rooms, and you can change any of them later.
          </p>
          <Cards options={PROPERTY_KINDS} value={quick.propertyKind} onPick={(propertyKind) => onQuick({ propertyKind })} name="kind" />
          {tag("propertyKind")}

          {/* C8b: an OUTSIDE job has no rooms to seed — no bedrooms here, and
              storeys is asked ONCE, on the outside screen. */}
          {quick.propertyKind !== "commercial" && quick.jobType !== "exterior" && (
            <>
              <p className="wz-qhead">How many bedrooms?</p>
              <div className="wz-chips" data-testid="ql-bedrooms">
                {BEDROOMS.map((n) => (
                  <button
                    key={n} type="button"
                    className={`wz-tile ${quick.bedrooms === n ? "on" : ""}`}
                    data-testid={`ql-bedrooms-${n}`}
                    onClick={() => onQuick({ bedrooms: n })}
                  >{n === 5 ? "5+" : n}</button>
                ))}
              </div>
              {tag("bedrooms")}

              <p className="wz-qhead">Storeys</p>
              <Cards options={STOREYS} value={quick.storeys} onPick={(storeys) => onQuick({ storeys })} name="storeys" />
              {tag("storeys")}
              {planUpload}
            </>
          )}
        </>
      )}

      {/* C12 — the commercial branch: three screens, every word from the row. */}
      {step === "segment" && commercial && (
        <SegmentScreen
          segments={commercial.segments}
          value={commercial.segmentKey}
          onPick={commercial.onSegment}
          jobType={quick.jobType}
          onJobType={(jobType) => onQuick({ jobType })}
          onBook={onBook}
          phone={phone}
        />
      )}
      {step === "com_areas" && commercial?.segment && commercial.answers && (
        <AreasScreen
          segment={commercial.segment}
          answers={commercial.answers}
          onAnswers={commercial.onAnswers}
          photoCount={commercial.photoCount}
          onPhotos={commercial.onPhotos}
        />
      )}
      {step === "com_warehouse" && commercial?.segment && commercial.answers && (
        <WarehouseScreen
          segment={commercial.segment}
          answers={commercial.answers}
          onAnswers={commercial.onAnswers}
        />
      )}
      {step === "com_brief" && commercial?.briefConfig && commercial.brief && (
        <BriefScreen
          brief={commercial.briefConfig}
          answers={commercial.brief}
          onAnswers={commercial.onBrief}
          photoCount={commercial.photoCount}
          onPhotos={commercial.onPhotos}
        />
      )}
      {step === "com_book" && commercial && (
        <BookScreen
          slots={commercial.slots}
          slot={commercial.slot}
          onSlot={commercial.onSlot}
          contact={commercial.contact}
          onContact={commercial.onContact}
          phone={phone}
          error={commercial.bookError}
          holdDays={commercial.holdDays}
        />
      )}
      {step === "com_job" && commercial?.segment && commercial.answers && (
        <JobScreen
          segment={commercial.segment}
          answers={commercial.answers}
          onAnswers={commercial.onAnswers}
          quick={quick}
          onQuick={onQuick}
        />
      )}

      {step === "job" && (
        <>
          <p className="wz-kick">The job</p>
          <h1>What&rsquo;s the job?</h1>
          <p className="wz-sub">
            We work out the coats and the preparation from these two answers — and you&rsquo;ll see
            exactly what we&rsquo;ve allowed for.
          </p>
          <Cards options={SCOPE_PRESETS} value={quick.scope} onPick={(scope) => onQuick({ scope, excluded: [], changing: changingForScope(scope, []) })} name="scope" />
          {tag("scope")}

          {/* Tom, 14 Sep (evening, items 3, 5, 7) → Tom, 15 Sep: "anything NOT being
              painted?" sits INLINE under the preset — the popup is gone. */}
          {exclusionOptions(quick.scope).length > 0 && (
            <div className="wz-excl" data-testid="ql-excl">
              <p className="wz-qhead">Anything NOT being painted? <span className="wz-opt">TICK ALL THAT APPLY — OR LEAVE IT AS THE LOT</span></p>
              <div className="wz-chips" data-testid="ql-excl-options">
                {exclusionOptions(quick.scope).map((o) => {
                  const on = quick.excluded.includes(o.value);
                  return (
                    <button key={o.value} type="button" className={`wz-tile ${on ? "on" : ""}`} aria-pressed={on} data-testid={`ql-excl-${o.value}`}
                      onClick={() => { const next = toggleExcluded(quick.excluded, o.value); onQuick({ excluded: next, changing: changingForScope(quick.scope, next) }); }}>
                      {o.label}
                    </button>
                  );
                })}
                <button type="button" className={`wz-tile ${quick.excluded.length === 0 ? "on" : ""}`} aria-pressed={quick.excluded.length === 0} data-testid="ql-excl-none"
                  onClick={() => onQuick({ excluded: [], changing: changingForScope(quick.scope, []) })}>
                  Painting the lot ✓
                </button>
              </div>
              <p className="wz-chint" data-testid="ql-excl-line" style={{ marginTop: 6 }}>
                {quick.excluded.length
                  ? <>Not painting: <b>{quick.excluded.map((k) => exclusionOptions(quick.scope).find((o) => o.value === k)?.label.toLowerCase() ?? k).join(", ")}</b>.</>
                  : <>Painting everything in that choice.</>}
              </p>
            </div>
          )}

          {/*
            C9 (v2.3, prototype `s-job`) — "What's changing colour?" replaces
            "how many coats" and the single colour picker. The customer ticks
            which parts get a new colour, says whether any go much lighter or
            bold, and can admit they are still choosing. The ENGINE derives
            coats and prep per surface group from that (lib/pricing/systems.ts);
            the customer never referees a paint system.
          */}
          <p className="wz-qhead">What&rsquo;s changing colour?</p>
          <p className="wz-chint" style={{ marginTop: 0, marginBottom: 8 }}>
            Tick what&rsquo;s getting a new colour. Anything you leave unticked is painted the same colour it is now.
          </p>
          <Multi options={CHANGING_GROUPS.filter((o) => visibleChanging(quick.scope, quick.excluded).includes(o.value))} on={visibleChanging(quick.scope, quick.excluded).filter((k) => quick.changing[k])} name="changing"
            onPick={(k) => onQuick({ changing: toggleChanging(quick, k) })} />
          {tag("changing")}

          <p className="wz-qhead">Any of them going much lighter, or a bold colour? <span className="wz-opt">NEEDS AN UNDERCOAT FIRST — WE ALLOW FOR IT</span></p>
          <Chips options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} value={quick.bold ? "yes" : "no"}
            onPick={(v) => onQuick({ bold: v === "yes" })} name="bold" />
          {/* Tom, 15 Sep: "Yes" then WHICH — the groups being painted and changing colour.
              It used to assume every one of them (the walls first), and asked nothing. */}
          {quick.bold && (
            <>
              <p className="wz-qhead">Which ones? <span className="wz-opt">TICK ALL THAT APPLY — THESE GET THE UNDERCOAT AND THIRD COAT</span></p>
              <Multi options={CHANGING_GROUPS.filter((o) => visibleChanging(quick.scope, quick.excluded).includes(o.value) && quick.changing[o.value])}
                on={(quick.boldGroups ?? []).filter((k) => quick.changing[k])}
                onPick={(k) => onQuick({ boldGroups: (quick.boldGroups ?? []).includes(k) ? (quick.boldGroups ?? []).filter((x) => x !== k) : [...(quick.boldGroups ?? []), k] })}
                name="bold-which" />
            </>
          )}

          <p className="wz-qhead">Still choosing colours? <span className="wz-opt">FINE — WE ALLOW FOR NEW COLOURS AND YOU DECIDE LATER</span></p>
          <Chips options={[{ value: "known", label: "I know roughly" }, { value: "undecided", label: "Still choosing" }]} value={quick.undecided ? "undecided" : "known"}
            onPick={(v) => onQuick({ undecided: v === "undecided" })} name="choosing" />
        </>
      )}

      {step === "rooms" && (() => {
        const fromPlan = planRooms != null && planRooms.length > 0;
        const names = fromPlan ? planRooms.map((r) => r.name) : starterRoomNames(quick);
        const isOn = (name: string) => !quick.rooms || quick.rooms.includes(name);
        const toggle = (name: string) => {
          const cur = quick.rooms ?? names;
          const next = isOn(name) ? cur.filter((n) => n !== name) : [...cur, name];
          onQuick({ rooms: next.length === names.length && names.every((n) => next.includes(n)) ? null : next });
        };
        return (
          <>
            <p className="wz-kick">{quick.scope === "some_rooms" ? "Which rooms" : "Confirm the rooms"}</p>
            <h1>{quick.scope === "some_rooms" ? "Which rooms are we painting?" : "Please confirm the rooms we're painting"}</h1>
            <p className="wz-sub">
              {fromPlan
                ? "These are the rooms we read off your floorplan. Untick any we're not painting, add any we missed — you confirm each one's size after the range."
                : "From your answers — untick any we're not painting, add any we've missed. Sizes come from typical rooms for now; you confirm each one after the range."}
            </p>
            {planPending && !fromPlan && <p className="wz-chint" data-testid="ql-plan-reading">Still reading your floorplan — the list below is from your answers until it finishes.</p>}
            {planPreviewUrl && (
              <figure className="wz-planpreview" data-testid="ql-plan-preview">
                {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived preview of the customer's own upload */}
                <img src={planPreviewUrl} alt="Your floorplan" />
              </figure>
            )}
            <div className="wz-chips" data-testid="ql-rooms">
              {names.map((name, i) => {
                const on = isOn(name);
                return (
                  <button key={name} type="button" className={`wz-tile ${on ? "on" : ""}`} aria-pressed={on} data-testid={`ql-room-${i}`} onClick={() => toggle(name)}>{name}</button>
                );
              })}
              {addedRooms.map((r, i) => (
                <button key={`added-${i}`} type="button" className="wz-tile on" aria-pressed data-testid={`ql-room-added-${i}`} title="Added by you — tap to remove" onClick={() => onRemoveAdded(i)}>{r.name} <span aria-hidden="true">×</span></button>
              ))}
            </div>
            {quick.rooms && quick.rooms.length === 0 && addedRooms.length === 0 && <p className="wz-err" data-testid="ql-rooms-none">Tick at least one room, or add one.</p>}
            <AddRoomInline onAdd={onAddRoom} />
          </>
        );
      })()}

      {step === "condition" && (
        <>
          <p className="wz-kick">Condition</p>
          <h1>How&rsquo;s it looking?</h1>
          <p className="wz-sub">
            Honest is best — it sets the preparation we allow for. You can point out particular
            spots later, with photos.
          </p>
          <Cards options={CONDITION_BANDS} value={quick.condition} onPick={(condition) => onQuick({ condition })} name="condition" />
          {tag("condition")}

          {/* Tom, 15 Sep: "Needs work" used to demand photos with nowhere to add
              them (the box left in C10; the check stayed). Now: photos AND a
              description, both optional, and the honest line about who prices
              the extra preparation. */}
          {quick.condition === "needs_work" && (
            <div className="wz-follow wz-alt" data-testid="ql-needs-work">
              <p className="wz-qhead">Which areas need work? <span className="wz-opt">OPTIONAL — PHOTOS, A FEW WORDS, OR BOTH</span></p>
              <textarea
                className="wz-brief" data-testid="ql-damage-note" rows={3} maxLength={600} value={needsWork.note}
                onChange={(e) => needsWork.onNote(e.target.value)}
                placeholder="e.g. peeling above the shower, a cracked wall in the hall, water mark on the lounge ceiling…"
              />
              <div className="wz-chips" style={{ marginTop: 8 }}>
                <button type="button" className="wz-tile" data-testid="ql-damage-photos" onClick={needsWork.onPhotos}>
                  {needsWork.photoCount > 0 ? `+ Add another photo` : `+ Add photos of the areas`}
                </button>
                {needsWork.photoCount > 0 && (
                  <span className="wz-chint" data-testid="ql-damage-photo-count" style={{ alignSelf: "center" }}>
                    {needsWork.photoCount} photo{needsWork.photoCount === 1 ? "" : "s"} ready to send{" "}
                    <button type="button" className="wz-linkish" data-testid="ql-damage-photos-clear" onClick={needsWork.onClearPhotos}>Remove</button>
                  </span>
                )}
              </div>
              <p className="wz-chint" data-testid="ql-prep-check" style={{ marginTop: 8 }}>
                Any areas that need extra preparation are checked by our estimator before they&rsquo;re priced.
              </p>
            </div>
          )}

          <p className="wz-qhead">Will anyone be living there while we paint?</p>
          <Cards options={OCCUPIED} value={quick.occupied} onPick={(occupied) => onQuick({ occupied })} name="occupied" />
          {tag("occupied")}
        </>
      )}

      {/*
        THE EXTERIOR QUICK LOOK — prototype `s-ext-job` v2.6, "What are we
        painting?" (C8b). ELEMENTS FIRST, nothing pre-ticked; materials only
        if the body is ticked; window type and count only if windows are;
        door count only if doors are; then colours, condition, storeys ONCE,
        access, and the book-someone-in card. One screen.
      */}
      {step === "outside" && (
        <>
          <p className="wz-kick">Outside</p>
          <h1>What are we painting?</h1>
          <p className="wz-sub">{EXTERIOR_PROMISE}</p>

          <p className="wz-qhead" style={{ marginTop: 0 }}>On the house</p>
          <ExteriorPickTiles options={EXT_ELEMENTS} on={outside.elements} name="ext-el"
            onPick={(v) => onOutside({ elements: toggleIn(outside.elements, v) })} />

          <p className="wz-qhead">Any other areas being painted? <span className="wz-opt">TICK ALL THAT APPLY</span></p>
          <ExteriorPickTiles options={EXT_STANDALONE} on={outside.standalone} name="ext-sep"
            onPick={(v) => onOutside({ standalone: toggleIn(outside.standalone, v) })} />

          {outside.elements.includes("body") && (
            <div data-testid="ext-body-q">
              <p className="wz-qhead">What are the walls made of? <span className="wz-opt">TICK EVERYTHING THAT NEEDS PAINTING</span></p>
              <Multi options={EXT_MATERIALS} on={outside.materials} name="ext-mat"
                onPick={(v) => onOutside({ materials: toggleMaterial(outside.materials, v) })} />
              <p className="wz-chint">Nothing is ticked for you — brick and render are often left bare on purpose, so we&rsquo;d rather you told us.</p>
            </div>
          )}

          {outside.elements.includes("windows") && (
            <div data-testid="ext-windows-q">
              <p className="wz-qhead">What type of windows, mostly?</p>
              {/* Tom, 15 Sep (item 2): the drawings, as the old wizard showed them; aluminium and not sure as chips. */}
              <div className="wz-pick sc-tiles" data-testid="ql-ext-win">
                {EXT_WINDOW_TYPES.filter((o) => o.value !== "alu" && o.value !== "unsure").map((o) => (
                  <button key={o.value} type="button" className={`wz-pk ${outside.windowType === o.value ? "on" : ""}`} aria-pressed={outside.windowType === o.value}
                    data-testid={`ql-ext-win-${o.value}`} onClick={() => onOutside({ windowType: o.value })}>
                    {WINDOW_DRAWINGS[o.value as "casement" | "sash" | "colonial" | "winder"]}<small>{o.label}</small>{o.hint && <em className="wz-pksub">{o.hint}</em>}
                  </button>
                ))}
              </div>
              <div className="wz-chips" style={{ marginTop: 8 }}>
                {EXT_WINDOW_TYPES.filter((o) => o.value === "alu" || o.value === "unsure").map((o) => (
                  <button key={o.value} type="button" className={`wz-tile ${outside.windowType === o.value ? "on" : ""}`} aria-pressed={outside.windowType === o.value}
                    data-testid={`ql-ext-win-${o.value}`} onClick={() => onOutside({ windowType: o.value })}>{o.label}</button>
                ))}
              </div>
              {outside.windowType === "alu" && (
                <p className="wz-chint" data-testid="ext-alu-note">Aluminium usually isn&rsquo;t painted — your estimator will check.</p>
              )}
              <div className="wz-countrow" data-testid="ext-win-count">
                <div className="wz-qtext">How many windows, all up?<small>A rough count is fine — we check it side by side later</small></div>
                <div className="wz-stepper">
                  <button type="button" aria-label="fewer windows" data-testid="ext-win-minus" disabled={outside.windowCount <= 0} onClick={() => onOutside({ windowCount: Math.max(0, outside.windowCount - 1) })}>−</button>
                  <span data-testid="ext-win-n">{outside.windowCount}</span>
                  <button type="button" aria-label="more windows" data-testid="ext-win-plus" onClick={() => onOutside({ windowCount: Math.min(200, outside.windowCount + 1) })}>+</button>
                </div>
              </div>
            </div>
          )}

          {outside.elements.includes("doors") && (
            <div className="wz-countrow" data-testid="ext-door-count">
              <div className="wz-qtext">How many doors?<small>Including the garage&rsquo;s personnel door, if it&rsquo;s painted</small></div>
              <div className="wz-stepper">
                <button type="button" aria-label="fewer doors" data-testid="ext-door-minus" disabled={outside.doorCount <= 0} onClick={() => onOutside({ doorCount: Math.max(0, outside.doorCount - 1) })}>−</button>
                <span data-testid="ext-door-n">{outside.doorCount}</span>
                <button type="button" aria-label="more doors" data-testid="ext-door-plus" onClick={() => onOutside({ doorCount: Math.min(60, outside.doorCount + 1) })}>+</button>
              </div>
            </div>
          )}

          <p className="wz-qhead">Colours</p>
          <Cards options={EXT_COLOURS} value={outside.colour} onPick={(colour) => onOutside({ colour })} name="ext-colour" />

          {/* Tom, 15 Sep (late, item 11): condition is NOT asked here. The range
              prices it good-to-peeling; the tighten screen asks it first. */}

          <p className="wz-qhead">Single or double storey?</p>
          <Cards options={EXT_STOREYS} value={outside.storeys} onPick={(storeys) => onOutside({ storeys })} name="ext-storeys" />

          <p className="wz-qhead">Anything tricky about getting to it?</p>
          <Multi
            options={EXT_ACCESS} on={outside.access} name="ext-access"
            onPick={(v) => onOutside({ access: toggleAccess(outside.access, v) })}
          />
          {outside.access.includes("lift") && (
            <p className="wz-chint" data-testid="ext-lift-note" style={{ marginTop: 10 }}>
              Nothing for scaffolding or a lift is in this price. If the job needs one we&rsquo;ll quote it with
              you before we start, as a separate line — never a surprise on the invoice.
            </p>
          )}

          <div className="wz-rather" data-testid="ext-rather">
            <b>Rather we just came out?</b>
            <p>Every outside job is signed off by a person anyway. Book now and skip the rest.</p>
            <div className="wz-rather-row">
              <button type="button" className="wz-btn wz-bs2" onClick={onBook} data-testid="ext-book">Book someone in</button>
              {phone && (
                <a className="wz-btn wz-bs2" href={`tel:${phone.replace(/\s+/g, "")}`} data-testid="ext-call">Call us</a>
              )}
            </div>
          </div>
        </>
      )}

      {/*
        Tom, 15 Sep (late, item 3): WHICH SIDES — its own screen just before the
        gate, the outside's rooms-confirm step. All four start ticked; a side
        unticked here is not scaffolded at all (lib/wizard/exteriorAnswers.ts),
        and the sides editor starts every side left at "yes".
      */}
      {step === "sides" && (() => {
        const chosen = outside.sides ?? ALL_SIDES;
        const all = ALL_SIDES.every((k) => chosen.includes(k));
        const toggle = (k: (typeof ALL_SIDES)[number]) =>
          onOutside({ sides: chosen.includes(k) ? chosen.filter((x) => x !== k) : [...chosen, k] });
        return (
          <>
            <p className="wz-kick">Which sides</p>
            <h1>Which sides are we painting?</h1>
            <p className="wz-sub">Looking at the house from the street. Untick any side we&rsquo;re not painting — you size each one after the range.</p>
            <div className="wz-pick sc-tiles wz-exttiles" data-testid="ql-ext-sides">
              <button type="button" className={`wz-pk ${all ? "on" : ""}`} aria-pressed={all} data-testid="ql-ext-side-all"
                onClick={() => onOutside({ sides: [...ALL_SIDES] })}>
                <svg viewBox="0 0 60 64"><rect x="10" y="10" width="40" height="44" fill="#12161A" stroke="#2FB9CB" strokeWidth="4" /></svg>
                <small>The full exterior</small><em className="wz-pksub">all four sides</em>
              </button>
              {EXT_SIDES.map((o) => {
                const on = chosen.includes(o.value);
                return (
                  <button key={o.value} type="button" className={`wz-pk ${on ? "on" : ""}`} aria-pressed={on}
                    data-testid={`ql-ext-side-${o.value}`} onClick={() => toggle(o.value)}>
                    <svg viewBox="0 0 60 64">
                      <rect x="10" y="10" width="40" height="44" fill="#12161A" stroke="#39424B" />
                      {o.value === "front" && <line x1="10" y1="54" x2="50" y2="54" stroke="#2FB9CB" strokeWidth="4" />}
                      {o.value === "back" && <line x1="10" y1="10" x2="50" y2="10" stroke="#2FB9CB" strokeWidth="4" />}
                      {o.value === "left" && <line x1="10" y1="10" x2="10" y2="54" stroke="#2FB9CB" strokeWidth="4" />}
                      {o.value === "right" && <line x1="50" y1="10" x2="50" y2="54" stroke="#2FB9CB" strokeWidth="4" />}
                    </svg>
                    <small>{o.label}</small>
                    {o.hint && <em className="wz-pksub">{o.hint}</em>}
                  </button>
                );
              })}
            </div>
            {chosen.length === 0 && <p className="wz-err" data-testid="ql-sides-none">Tick at least one side.</p>}
            <p className="wz-chint" style={{ marginTop: 10 }}>A side you leave off won&rsquo;t be on your estimate at all. You can add it back later if you change your mind.</p>
          </>
        );
      })()}

      {error && <div className="wz-err" data-testid="ql-error">{error}</div>}

      <div className="wz-nav">
        {onBack && (
          <button type="button" className="wz-btn wz-bs" onClick={onBack} data-testid="ql-back">Back</button>
        )}
        {/* The "both" choice IS the answer — its two doors continue; there is no Continue to press. */}
        {step !== "both" && (
          <button
            type="button"
            className="wz-btn wz-bp"
            disabled={!canContinue || busy}
            data-testid="ql-next"
            onClick={onNext}
          >
            {busy ? (step === "com_book" ? "Booking…" : "Working it out…") : nextLabel}
          </button>
        )}
      </div>
      <p className="wz-steps">Step {stepNo} of {stepsTotal}</p>
    </div>
  );
}

/** A row of plain chips — for answers whose label is the whole story. */
function Chips<T extends string>({ options, value, onPick, name }: {
  options: Choice<T>[]; value: T; onPick: (v: T) => void; name: string;
}) {
  return (
    <div className="wz-chips" data-testid={`ql-${name}`}>
      {options.map((o) => (
        <button
          key={o.value} type="button"
          className={`wz-tile ${value === o.value ? "on" : ""}`}
          data-testid={`ql-${name}-${o.value}`}
          onClick={() => onPick(o.value)}
        >{o.label}</button>
      ))}
    </div>
  );
}

/** A row of chips where several can be on at once. */
function Multi<T extends string>({ options, on, onPick, name }: {
  options: Choice<T>[]; on: readonly T[]; onPick: (v: T) => void; name: string;
}) {
  return (
    <div className="wz-chips" data-testid={`ql-${name}`}>
      {options.map((o) => (
        <button
          key={o.value} type="button"
          className={`wz-tile ${on.includes(o.value) ? "on" : ""}`}
          aria-pressed={on.includes(o.value)}
          data-testid={`ql-${name}-${o.value}`}
          onClick={() => onPick(o.value)}
        >{o.label}</button>
      ))}
    </div>
  );
}

/** Cards — for answers that need a line of explanation under them. */
function Cards<T extends string>({ options, value, onPick, name }: {
  options: Choice<T>[]; value: T; onPick: (v: T) => void; name: string;
}) {
  return (
    <div className="wz-cards" data-testid={`ql-${name}`}>
      {options.map((o) => (
        <button
          key={o.value} type="button"
          className={`wz-card ${value === o.value ? "on" : ""}`}
          data-testid={`ql-${name}-${o.value}`}
          onClick={() => onPick(o.value)}
        >
          <b>{o.label}</b>
          {o.hint && <span>{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/** Tom, 14 Sep (evening): "add a room" on the confirm step — a type and a name; the size comes from the typicals. */
const ADD_ROOM_TYPES: Array<{ value: string; label: string }> = [
  { value: "hallway", label: "Hallway" }, { value: "bedroom", label: "Bedroom" }, { value: "bathroom", label: "Bathroom" }, { value: "dining", label: "Dining" },
  { value: "living", label: "Living" }, { value: "kitchen", label: "Kitchen" }, { value: "laundry", label: "Laundry" }, { value: "study", label: "Study" },
  { value: "wc", label: "WC" }, { value: "storage", label: "Storage" }, { value: "garage", label: "Garage" },
];
function AddRoomInline({ onAdd }: { onAdd: (room: { name: string; roomType: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string | null>(null);
  const [name, setName] = useState("");
  return (
    <div className="wz-addroom" data-testid="ql-add-room">
      {!open ? (
        <button type="button" className="wz-tile" data-testid="ql-add-room-open" onClick={() => setOpen(true)}>+ Add a room</button>
      ) : (
        <>
          <p className="wz-qhead">Which kind of room?</p>
          <div className="wz-chips">
            {ADD_ROOM_TYPES.map((t) => (
              <button key={t.value} type="button" className={`wz-tile ${type === t.value ? "on" : ""}`} aria-pressed={type === t.value} data-testid={`ql-add-room-type-${t.value}`}
                onClick={() => { setType(t.value); if (!name) setName(t.label); }}>{t.label}</button>
            ))}
          </div>
          <div className="wz-addroom-row">
            <input className="wz-field" placeholder="Name it — e.g. Dining" maxLength={60} value={name} data-testid="ql-add-room-name" onChange={(e) => setName(e.target.value)} />
            <button type="button" className="wz-btn" disabled={!type} data-testid="ql-add-room-go"
              onClick={() => { if (!type) return; onAdd({ name: name.trim() || (ADD_ROOM_TYPES.find((t) => t.value === type)?.label ?? type), roomType: type }); setOpen(false); setType(null); setName(""); }}>Add it</button>
            <button type="button" className="wz-linkish" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
