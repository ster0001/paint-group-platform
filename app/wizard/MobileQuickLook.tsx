"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CONDITION_BANDS, OCCUPIED, type QuickLook, type QuickLookStep, type ScopePreset } from "@/lib/wizard/quick-look";
import {
  COLOUR_CHOICES, EXTRA_ROOMS, JOB_CHOICES, MOBILE_SCREEN_KEY, applyColourChoice, applyJobChoice, colourChoiceOf, detailsReady,
  mobileProgress, mobileScreensFor, roomChips, roomsTicked, surfaceChips, toggleListedRoom, toggleSurface, type MobileScreen,
} from "@/lib/wizard/mobileScreens";
import { jobTypesFor, propertyKindsFor, type WizardBrand } from "@/lib/wizard/brand";
import { brandFor } from "@/lib/marketing/brand";
import { sendWizardEvent } from "@/lib/wizard/wizardEvents";
import { AddRoomInline } from "./QuickLook";

/**
 * Wizard mobile v5, session 2 — the phone's shell and its screens (brief §2;
 * the prototype `docs/mockups/painthome-wizard-v5.html` at 390px is the
 * reference and wins where the two disagree).
 *
 * Under 768px the quick look is one question per screen: a header of back
 * chevron · logo · Contact pill, a 3px bar, the live strip (a placeholder
 * here — session 3 draws the thumbnail and the ribbon in it), the heading,
 * at most one grey line, the options. A single choice advances itself
 * ~250ms after the tap (R7, D10); surfaces, rooms and details carry a
 * bottom bar that clears the safe area. No sticky picture panel and no
 * floating talk pill on a phone (§3) — the pill's three doors live behind
 * Contact (the Contact sheet itself is session 5; for now it opens the talk
 * sheet). Desktop (≥ 768px) never renders this file.
 *
 * It OWNS nothing the desktop does not: the answers are the quick look's on
 * the wizard state, the step list is `stepsFor()`, Continue is WizardApp's
 * `quickNext` (its validation, autosave tag and submit), Back its
 * `quickBack`. This file only splits a step into screens
 * (lib/wizard/mobileScreens.ts) and keeps WHICH screen of the step is
 * showing — in state, and in localStorage beside the resume record so a
 * reload lands on the same screen. A step this file does not split is
 * rendered as it is (`renderStep`, the desktop's QuickLook in `shell="mobile"`
 * mode) with the bar underneath.
 */
export default function MobileQuickLook({
  brand, logo, steps, step, quick, onQuick, address, contact, onContact, marketing, onMarketing, roomNames, addedRooms, onAddRoom, onRemoveAdded,
  error, busy, canContinue, whyNot, onNext, onBack, canBack, onContactOpen, renderStep, resumed, onStartAgain,
}: {
  brand: WizardBrand;
  logo: ReactNode;
  /** `stepsFor()` for the answers so far — the order of record. */
  steps: readonly QuickLookStep[];
  step: QuickLookStep;
  quick: QuickLook;
  onQuick: (patch: Partial<QuickLook>) => void;
  /** The address chip: the words, whether it is enough to price (a pick, or a suburb and postcode), and the field to change it. */
  address: { text: string; known: boolean; field: ReactNode };
  /** The details screen (the quick look's gate); null when the session asks for details on the range instead (R6/R7). */
  contact: { name: string; email: string; phone: string } | null;
  onContact: (c: { name: string; email: string; phone: string }) => void;
  marketing: boolean;
  onMarketing: (v: boolean) => void;
  /** §2.3: the generated rooms (the plan's, or the starter list's names) and the ones added by hand. */
  roomNames: readonly string[];
  addedRooms: ReadonlyArray<{ name: string; roomType: string }>;
  onAddRoom: (room: { name: string; roomType: string }) => void;
  onRemoveAdded: (index: number) => void;
  error: string | null;
  busy: boolean;
  /** Whether Continue may go (the session is connected, nothing uploading); the screen adds its own rule. */
  canContinue: boolean;
  whyNot: string | null;
  /** WizardApp's quickNext / quickBack — validation, autosave and submit stay there. */
  onNext: () => void;
  onBack: () => void;
  canBack: boolean;
  /** The Contact pill (R6), with the screen it was tapped on (brief §8 `contact_opened {step}`). Session 5 replaces the sheet it opens. */
  onContactOpen: (screenId: string) => void;
  /** A step this shell does not split, rendered as it is. */
  renderStep: () => ReactNode;
  /** "Welcome back — …" after a resume, and Start again. */
  resumed: string | null;
  onStartAgain: () => void;
}) {
  const screens = mobileScreensFor(steps, quick);
  const stepScreens = screens.filter((s) => s.step === step);
  // Which screen of THIS step is showing. On a new step: the first one going
  // forward, the last one coming back, the remembered one after a reload.
  const [sub, setSub] = useState(0);
  const pendingRef = useRef<"first" | "last" | null>(null);
  const stepRef = useRef<QuickLookStep | null>(null);
  useLayoutEffect(() => {
    if (stepRef.current === step) return;
    stepRef.current = step;
    const want = pendingRef.current;
    pendingRef.current = null;
    if (want === "first") { setSub(0); return; }
    if (want === "last") { setSub(Math.max(0, stepScreens.length - 1)); return; }
    // No move of our own (a mount, a resume): the remembered screen, if it is one of this step's.
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(MOBILE_SCREEN_KEY); } catch { stored = null; }
    const at = stored ? stepScreens.findIndex((s) => s.id === stored) : -1;
    setSub(at >= 0 ? at : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stepScreens is derived from step + answers; the step is the trigger
  }, [step]);
  const current: MobileScreen = stepScreens[Math.min(sub, Math.max(0, stepScreens.length - 1))] ?? { id: step, step, advance: "bar", heading: null, sub: null };
  const index = Math.max(0, screens.findIndex((s) => s.id === current.id));
  const first = index === 0;
  const last = sub >= stepScreens.length - 1;

  // Every screen: top of the page, the screen remembered, the event written (§8).
  useEffect(() => {
    window.scrollTo({ top: 0 });
    try { window.localStorage.setItem(MOBILE_SCREEN_KEY, current.id); } catch { /* private mode: the resume lands on the step's first screen */ }
    sendWizardEvent("wizard_step_viewed", { step: current.id, breakpoint: "mobile" });
  }, [current.id]);

  // R7 / D10: a single choice advances itself ~250ms after the tap.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const go = () => {
    if (!last) { setSub(sub + 1); return; }
    pendingRef.current = "first";
    onNext();
  };
  const pick = (patch: Partial<QuickLook>) => {
    onQuick(patch);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(go, 250);
  };
  const back = () => {
    if (timer.current) clearTimeout(timer.current);
    if (sub > 0) { setSub(sub - 1); return; }
    if (!canBack) return;
    pendingRef.current = "last";
    onBack();
  };

  const [changingAddress, setChangingAddress] = useState(false);
  const ticked = roomsTicked(quick, roomNames, addedRooms);
  const ready = current.id === "details" ? Boolean(contact && detailsReady(contact))
    : current.id === "rooms" ? ticked > 0
    : true;
  const barLabel = current.id === "details" ? "Show my range" : step === "com_book" ? "Book it" : "Continue";
  const showBar = current.advance === "bar";
  const pct = mobileProgress(index, screens.length);

  return (
    <div className="wzm" data-testid="wzm" data-mobile-screen={current.id} data-quick-step={step}>
      <header className="wzm-head" data-testid="wzm-head">
        <button type="button" className="wzm-back" aria-label="Back" disabled={first && !canBack} onClick={back} data-testid="wzm-back">‹</button>
        <span className="wzm-logo">{logo}</span>
        <button type="button" className="wzm-contact" onClick={() => onContactOpen(current.id)} data-testid="wzm-contact">Contact</button>
      </header>
      <div className="wzm-bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i style={{ width: `${pct}%` }} data-testid="wzm-bar" />
      </div>
      {/* §3 — the live strip. Session 3 draws the thumbnail, the ribbon and the sheet; this is its place. */}
      <div className="wzm-strip" data-testid="wzm-strip" aria-hidden="true">
        <span className="thumb" />
        <span className="txt"><b>Your place</b><span>Updates as you answer</span></span>
        <span className="chev">›</span>
      </div>

      <main className={`wzm-main ${showBar ? "has-bar" : ""}`}>
        {resumed && (
          <div className="wz-resume" data-testid="wz-resume">
            <span>Welcome back — {resumed}. Everything you answered is still here.</span>
            <button type="button" className="wz-linkish" onClick={onStartAgain} data-testid="wz-start-again">Start again</button>
          </div>
        )}
        <section className="wzm-screen" key={current.id}>
          {current.heading && <h1 data-testid="wzm-h1">{current.heading}</h1>}
          {current.sub && <p className="wzm-sub" data-testid="wzm-sub">{current.sub}</p>}

          {current.id === "what" && (
            <>
              {address.known && !changingAddress ? (
                <div className="wzm-addr" data-testid="wzm-addr">
                  <span>{address.text}</span>
                  <button type="button" onClick={() => setChangingAddress(true)} data-testid="wzm-addr-change">Change</button>
                </div>
              ) : (
                <div className="wzm-addrfield" data-testid="wzm-addr-field">{address.field}</div>
              )}
              <div className="wzm-opts two" data-testid="ql-jobtype">
                {jobTypesFor(brand).map((o) => (
                  <button key={o.value} type="button" className={`wzm-opt ${quick.jobType === o.value ? "on" : ""}`} aria-pressed={quick.jobType === o.value}
                    data-testid={`ql-jobtype-${o.value}`} onClick={() => pick({ jobType: o.value })}>
                    <JobIcon kind={o.value} />
                    <span><span className="t">{o.label}</span><span className="d">{JOB_LINE[o.value]}</span></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {current.id === "property" && (
            <div className="wzm-opts" data-testid="ql-kind">
              {propertyKindsFor(brand).map((o) => (
                <button key={o.value} type="button" className={`wzm-opt ${quick.propertyKind === o.value ? "on" : ""}`} aria-pressed={quick.propertyKind === o.value}
                  data-testid={`ql-kind-${o.value}`} onClick={() => pick({ propertyKind: o.value })}>
                  <KindIcon kind={o.value} />
                  <span><span className="t">{o.label}</span>{o.hint && <span className="d">{o.hint}</span>}</span>
                </button>
              ))}
            </div>
          )}

          {current.id === "beds" && (
            <div className="wzm-nums" data-testid="ql-bedrooms">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className={`wzm-opt ${quick.bedrooms === n ? "on" : ""}`} aria-pressed={quick.bedrooms === n}
                  data-testid={`ql-bedrooms-${n}`} onClick={() => pick({ bedrooms: n })}>{n === 5 ? "5+" : n}</button>
              ))}
            </div>
          )}

          {current.id === "storeys" && (
            <div className="wzm-opts two" data-testid="ql-storeys">
              {([["single", "One"], ["double", "Two"]] as const).map(([value, label]) => (
                <button key={value} type="button" className={`wzm-opt ${quick.storeys === value ? "on" : ""}`} aria-pressed={quick.storeys === value}
                  data-testid={`ql-storeys-${value}`} onClick={() => pick({ storeys: value })}>
                  <StoreyIcon two={value === "double"} />
                  <span className="t">{label}</span>
                </button>
              ))}
            </div>
          )}

          {current.id === "job" && (
            <div className="wzm-opts" data-testid="ql-scope">
              {JOB_CHOICES.map((o) => (
                <button key={o.value} type="button" className={`wzm-opt ${quick.scope === o.value ? "on" : ""}`} aria-pressed={quick.scope === o.value}
                  data-testid={`ql-scope-${o.value}`} onClick={() => pick(applyJobChoice(o.value as ScopePreset, roomNames))}>
                  <span><span className="t">{o.label}</span><span className="d">{o.hint}</span></span>
                </button>
              ))}
            </div>
          )}

          {current.id === "surfaces" && (
            <div className="wzm-chips" data-testid="ql-surfaces">
              {surfaceChips(quick).map((c) => (
                <button key={c.key} type="button" className={`wzm-chip ${c.on ? "on" : ""}`} aria-pressed={c.on}
                  data-testid={`ql-surface-${c.key}`} onClick={() => onQuick(toggleSurface(quick, c.key))}>{c.label}</button>
              ))}
            </div>
          )}

          {current.id === "rooms" && (
            <>
              <div className="wzm-chips" data-testid="ql-rooms">
                {roomChips(quick, roomNames, addedRooms).map((c) => {
                  const testId = c.kind === "listed" ? `ql-room-${c.index}` : c.kind === "extra" ? `ql-room-extra-${c.name.toLowerCase()}` : `ql-room-added-${c.index}`;
                  const toggle = () => {
                    if (c.kind === "listed") onQuick(toggleListedRoom(quick, roomNames, c.name));
                    else if (c.on) onRemoveAdded(c.index);
                    else onAddRoom(EXTRA_ROOMS.find((e) => e.name === c.name) ?? { name: c.name, roomType: "bedroom" });
                  };
                  return (
                    <button key={`${c.kind}-${c.name}`} type="button" className={`wzm-chip ${c.on ? "on" : ""}`} aria-pressed={c.on} data-testid={testId} onClick={toggle}>{c.name}</button>
                  );
                })}
              </div>
              <AddRoomInline onAdd={onAddRoom} label="+ Another room" />
            </>
          )}

          {current.id === "colours" && (
            <div className="wzm-opts" data-testid="ql-colours">
              {COLOUR_CHOICES.map((o) => (
                <button key={o.value} type="button" className={`wzm-opt ${colourChoiceOf(quick) === o.value ? "on" : ""}`} aria-pressed={colourChoiceOf(quick) === o.value}
                  data-testid={`ql-colours-${o.value}`} onClick={() => pick(applyColourChoice(quick, o.value))}>
                  <span className={`wzm-sw wzm-sw--${o.value}`} aria-hidden="true" />
                  <span><span className="t">{o.label}</span><span className="d">{o.hint}</span></span>
                </button>
              ))}
            </div>
          )}

          {current.id === "condition" && (
            <div className="wzm-opts" data-testid="ql-condition">
              {CONDITION_BANDS.map((o) => (
                <button key={o.value} type="button" className={`wzm-opt ${quick.condition === o.value ? "on" : ""}`} aria-pressed={quick.condition === o.value}
                  data-testid={`ql-condition-${o.value}`} onClick={() => pick({ condition: o.value })}>
                  <span className={`wzm-sw wzm-sw--${o.value}`} aria-hidden="true" />
                  <span><span className="t">{CONDITION_WORDS[o.value].t}</span><span className="d">{CONDITION_WORDS[o.value].d}</span></span>
                </button>
              ))}
            </div>
          )}

          {current.id === "living" && (
            <div className="wzm-opts two" data-testid="ql-occupied">
              {OCCUPIED.map((o) => (
                <button key={o.value} type="button" className={`wzm-opt ${quick.occupied === o.value ? "on" : ""}`} aria-pressed={quick.occupied === o.value}
                  data-testid={`ql-occupied-${o.value}`} onClick={() => pick({ occupied: o.value })}>
                  <span className="t">{o.label}</span>
                </button>
              ))}
            </div>
          )}

          {current.id === "details" && contact && (
            <>
              <label className="wzm-field"><span>Name</span>
                <input value={contact.name} placeholder="First name is fine" autoComplete="given-name" data-testid="gate-name" onChange={(e) => onContact({ ...contact, name: e.target.value })} /></label>
              <label className="wzm-field"><span>Mobile</span>
                <input type="tel" inputMode="tel" value={contact.phone} placeholder="04" autoComplete="tel" data-testid="gate-mobile" onChange={(e) => onContact({ ...contact, phone: e.target.value })} /></label>
              <label className="wzm-field"><span>Email</span>
                <input type="email" inputMode="email" value={contact.email} placeholder="For your quote" autoComplete="email" data-testid="gate-email" onChange={(e) => onContact({ ...contact, email: e.target.value })} /></label>
              <label className="wzm-optin" data-testid="gate-marketing">
                <input type="checkbox" checked={marketing} onChange={(e) => onMarketing(e.target.checked)} /> Occasional offers from {brandFor(brand === "painthome" ? "painthome" : "home").name}
              </label>
            </>
          )}

          {current.heading == null && <div className="wzm-generic">{renderStep()}</div>}

          {current.heading != null && error && <div className="wz-err" data-testid="ql-error">{error}</div>}
        </section>
      </main>

      {showBar && (
        <div className="wzm-foot" data-testid="wzm-foot">
          {whyNot && (!canContinue || busy) && <p className="wzm-why" data-testid="ql-why" role="status">{whyNot}</p>}
          <button key={error ?? "ok"} type="button" className={`wzm-cta ${error ? "wz-shake" : ""}`} disabled={!ready || !canContinue || busy} data-testid="ql-next"
            onClick={() => { pendingRef.current = "first"; if (!last) { setSub(sub + 1); return; } onNext(); }}>
            {busy ? (step === "com_book" ? "Booking…" : "Working it out…") : barLabel}
          </button>
          {current.id === "details" && <p className="wzm-hint" data-testid="wzm-hint">Appears instantly</p>}
        </div>
      )}
    </div>
  );
}

const JOB_LINE: Record<QuickLook["jobType"], string> = { interior: "Rooms, walls, ceilings, trims", exterior: "Walls, eaves, trims, doors", both: "Inside first, then outside" };
const CONDITION_WORDS: Record<QuickLook["condition"], { t: string; d: string }> = {
  good: { t: "Good, just tired", d: "Light sand and go" },
  wear: { t: "Some wear", d: "Scuffs, nail holes, the odd crack" },
  needs_work: { t: "Needs work", d: "Flaking, cracked plaster, water marks" },
};

/* The prototype's line icons, as they are. */
function JobIcon({ kind }: { kind: QuickLook["jobType"] }) {
  if (kind === "exterior") return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 20h20M4 20V9l8-6 8 6v11" /><path d="M9 20v-5h6v5" /></svg>;
  if (kind === "both") return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M12 3v18" /></svg>;
  return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M9 21v-6h6v6" /></svg>;
}
function KindIcon({ kind }: { kind: QuickLook["propertyKind"] }) {
  if (kind === "townhouse") return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 20V9l5-4 5 4v11M12 20V9l5-4 5 4v11" /></svg>;
  if (kind === "unit_apartment") return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></svg>;
  if (kind === "commercial") return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M4 21V8h16v13M4 8l2-4h12l2 4" /><path d="M9 21v-5h6v5" /></svg>;
  return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-8 9 8v9H3z" /></svg>;
}
function StoreyIcon({ two }: { two: boolean }) {
  return two
    ? <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l9-6 9 6v12H3z" /><path d="M3 14h18" /></svg>
    : <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13l9-7 9 7v7H3z" /></svg>;
}
