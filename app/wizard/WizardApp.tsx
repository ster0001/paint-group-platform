"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { checkUpload } from "@/lib/uploads/validate";
import {
  defaultCustomer,
  defaultExterior,
  defaultWizardState,
  exteriorElements,
  exteriorSides,
  exteriorSurfaceKeys,
  pageForPath,
  type WizardExterior,
  type WizardState,
  type WizardSurfaceKey,
} from "@/lib/wizard/state";
import { mergeDraftState } from "@/lib/wizard/draft-merge";

/** What /api/wizard/draft hands back on a 409 (C3) — the server's copy, so the
 *  losing write can merge instead of guessing. */
type DraftConflict = {
  version?: number;
  state?: Record<string, unknown>;
  lastScreen?: string | null;
  page?: number | null;
};
import { defaultSurfacesFor, type SubstrateGroups } from "@/lib/estimate/substrates";
import { captureTouch, readAttribution } from "@/lib/crm/attributionClient";
import {
  busyReason,
  continueState,
  establishSession,
  planUploadLabel,
  SESSION_ERROR_TEXT,
  SESSION_SLOW_TEXT,
  type SessionPhase,
} from "@/lib/wizard/session";
import type { CustomerPayload, WizardEditorPayload } from "@/lib/wizard/view";
import AddressField from "./AddressField";
import QuickLook from "./QuickLook";
import SaveAndBookSheet from "./SaveAndBookSheet";
import ConditionBox from "./ConditionBox";
import Reveal from "./Reveal";
import {
  DEFAULT_QUICK_LOOK, quickLookToState, stepsFor,
  colourFromChanges,
  type QuickLook as QuickLookAnswers,
} from "@/lib/wizard/quick-look";
import {
  applyExteriorQuickLook, exteriorQuickLookFromState, paintsSomething,
  type ExteriorQuickLook as ExteriorQuickLookAnswers,
} from "@/lib/wizard/exterior-quick-look";
import CustomerResult, { type CustomerOutcome } from "./CustomerResult";
import { RESUME_KEY, RESTART_KEY, decodeResume, encodeResume, restartedSince, resumeLine, type ResumeRecord, type SafetyAnswered, pickResume } from "@/lib/wizard/resume";
import Wordmark from "./Wordmark";
import ChatWidget from "./ChatWidget";
import { gateMessage, routeCommercial } from "@/lib/wizard/commercial";
import {
  DEFAULT_SEGMENTS, commercialSurfaceKeys, defaultCommercialAnswers, segmentByKey, segmentTiles,
  type CommercialAnswers, type Segment,
} from "@/lib/wizard/segments";

/**
 * W1: the five paginated pages, exactly per the workflow doc — Property →
 * Surfaces → Condition → Details → Paint — with the visible 5-dot
 * pagination and the conditional logic as client behaviour only. The state
 * is ONE typed object; the server re-validates it with the same zod schema
 * on submit. Copy tone: English rather than Australian (business inputs §4).
 *
 * Page-1 uploads kick the plan reader off IN THE BACKGROUND (W2): each page
 * starts its read the moment the upload lands, so by the processing screen
 * most of the model work is already done.
 */

type Screen = "pages" | "processing" | "editor" | "reveal";

/** Phase 2 (6 Sep plan): the wizard's pages are a LIST per job type, not numbers. */
type PageKey = "property" | "surfaces" | "condition" | "details" | "paint" | "house" | "scope" | "ext_condition" | "extras" | "contact";
/** The customer's way in: describe it · answer a few questions · upload the plan/listing. */
type EntryChoice = "describe" | "questions" | "upload";

/** The page's name for a person (the "I'm stuck" note). */

/** What choosing a way in means for the state, per job type. Pure, so the
 * job-type switch and the entry cards write the same thing. */
function entryPatch(e: EntryChoice, jobType: WizardState["jobType"], ext: WizardExterior | null, basics: WizardState["basics"]): Partial<WizardState> {
  if (jobType === "exterior") {
    const base = ext ?? defaultExterior();
    // Tom, 7 Sep: an exterior job answers the EXTERIOR question set — the
    // interior "quick basics" (bedrooms, open-plan) must never ride along
    // from a job type picked earlier. noPlan is the interior path's flag.
    return { exterior: { ...base, noPhotos: e === "questions" }, noPlan: false, basics: null };
  }
  return {
    noPlan: e === "questions",
    basics: e === "questions" && !basics
      ? { bedrooms: 3, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: false }
      : basics,
    // A "both" job answers for the outside too: no photos = sized from the answers.
    ...(jobType === "both" ? { exterior: { ...(ext ?? defaultExterior()), noPhotos: e === "questions" } } : {}),
  };
}

/** A restored walk: which way in do its answers imply? */
function entryFromState(s: WizardState): EntryChoice | null {
  /**
   * The quick look leaves its own fingerprint, and it has to be checked FIRST.
   * `noPlan` is only set when the quick look SUBMITS, so a walk abandoned
   * halfway looked like "no route chosen" and resumed onto the old entry
   * cards — the answers were all restored and the screen showing them was
   * not. The presence of the eight answers is the honest signal.
   */
  if (s.quickLook) return "questions";
  if (s.jobType === "exterior") {
    if (s.exterior?.noPhotos) return "questions";
    if (s.facadeRunIds.length > 0 || s.listingUrl.trim()) return "upload";
    return null;
  }
  if (s.noPlan) return "questions";
  if (s.planRunIds.length > 0 || s.listingUrl.trim()) return "upload";
  return null;
}

type SubmitResult = WizardEditorPayload & {
  estimateId: string;
  openAt: string;
  planUrl: string | null;
  skipped: Array<{ name: string; reason: string }>;
  warnings: string[];
};

const emptySubscribe = () => () => {};
const snapshotTrue = () => true;
const snapshotFalse = () => false;

/** Rotating lines on the processing screen — something worth reading while
 * the AI measures and prices (Tom, 31 Aug: make the wait interactive). */
const PROC_TIPS = [
  "You'll be able to adjust every room and watch the price move live.",
  "5.0 ★ from 93+ five-star reviews across Melbourne.",
  "Free, unlimited colour samples — nothing starts until you love the colours.",
  "A real estimator checks every estimate before anything is fixed.",
  "Nothing is booked and nothing is charged until you say so.",
];

export default function WizardApp({ roomTypes, substrates, mode = "internal", prefill, prefillState, logoUrl, companyPhone = null, intent, resume = null, assisted = null, segments = DEFAULT_SEGMENTS }: {
  roomTypes: string[];
  /** A2: the offered surface lists, derived server-side from the rate card. */
  substrates: SubstrateGroups;
  mode?: "internal" | "customer";
  /** The Settings logo (logo 1) for the header — wordmark when unset. */
  logoUrl?: string | null;
  /** The office number, for the reveal screen's "or just talk to us" line. */
  companyPhone?: string | null;
  /** C12: the `commercial_segments` rows, loaded by the page; the mirror when absent. */
  segments?: Segment[];
  /** 3a-6: a signed-in portal customer arrives known — email from their
   * verified session (the gate page disappears), address from the chosen
   * property. Same component, same flow; a returning customer just starts
   * closer to a price. */
  prefill?: {
    email: string;
    /** Trade members (Tom, 31 Aug): the account already knows who they are —
     * name and phone prefill and the contact sub-step never shows. */
    name?: string;
    phone?: string;
    address: { street: string; suburb: string; state: string; postcode: string; formatted: string } | null;
  };
  /** 3a-7: one-tap rebook (§6 W3) — a prior job's SANITISED wizard answers
   * as the starting point, so the walk only asks what's changed. The server
   * strips file/run references before it hands this over. */
  prefillState?: WizardState;
  /** Homepage hand-off (lib/marketing/prefill.ts): the address the visitor
   * typed on the marketing site, shown in the field; "business" pre-selects
   * the commercial property kind. Intent only — no account, no event. */
  intent?: { addressText: string | null; propertyKind: "commercial" | null; mode?: "home" | "business" | null; entrySource?: string };
  /** Tom, 7 Sep: the SERVER copy of a half-finished walk (the autosaved
   * draft for this user) — merged with the browser copy on mount, newest wins. */
  resume?: Omit<ResumeRecord, "v"> | null;
  /**
   * C8 — a staff member opening a CUSTOMER's session (Save & book, addendum
   * §4.17): the server copy wins over anything in this browser, the walk lands
   * on the screen the customer left, and a banner says whose answers these are.
   */
  assisted?: { who: string; screen: string | null } | null;
}) {
  const makeInitialState = (): WizardState => {
    const seed = prefillState ?? defaultWizardState();
    const base = mode === "customer"
      ? {
          ...seed,
          mode: "customer" as const,
          customer: {
            ...(seed.customer ?? defaultCustomer()),
            email: prefill?.email ?? seed.customer?.email ?? "",
            suburb: prefill?.address?.suburb ?? seed.customer?.suburb ?? "",
            postcode: prefill?.address?.postcode ?? seed.customer?.postcode ?? "",
            ...(intent?.propertyKind ? { propertyKind: intent.propertyKind } : {}),
          },
          address: prefill?.address ?? seed.address,
          contact: {
            name: prefill?.name ?? seed.contact?.name ?? "",
            email: prefill?.email ?? seed.contact?.email ?? "",
            phone: prefill?.phone ?? seed.contact?.phone ?? "",
          },
        }
      : seed;
    return prefillState
      ? base // the rebook keeps the prior job's chosen surfaces
      : { ...base, surfaces: defaultSurfacesFor(base.jobType, substrates) };
  };
  const [state, setState] = useState<WizardState>(makeInitialState);
  const [page, setPage] = useState(1);
  const [screen, setScreen] = useState<Screen>("pages");
  const isCustomer = mode === "customer";
  const [outcome, setOutcome] = useState<CustomerOutcome | null>(null);

  /**
   * THE QUICK LOOK (estimator journey v2 §3, phase 2) — the four screens that
   * replace the five-page interior wizard for a customer. The old pages are
   * still here and still reached by the describe and upload routes, which ask
   * different questions; this is the default way in.
   */
  /**
   * The quick look's answers live on the STATE, not here — autosave and resume
   * only know about the state, so held in React alone a reload lost all eight.
   * The screen the customer is on is the ordinary `page`, for the same reason:
   * the resume record already restores it, and two notions of "where am I"
   * would need keeping in step forever.
   */
  const quick: QuickLookAnswers = state.quickLook ?? {
    ...DEFAULT_QUICK_LOOK,
    ...(intent?.propertyKind ? { propertyKind: intent.propertyKind } : {}),
  };
  /**
   * The quick look's answers, written to the state as they are tapped.
   *
   * ⚑ `jobType` is mirrored onto the state IMMEDIATELY rather than waiting for
   * `quickLookToState` at submit. Everything else in the wizard branches on it
   * — the page list, the exterior question set, the describe and upload routes
   * — so a customer who picked "Outside" and then tapped "Upload a floorplan"
   * landed on an INTERIOR page asking for a floorplan of a house exterior.
   * One answer, one meaning, from the moment it is given.
   */
  /**
   * The exterior quick look's five answers (prototype `s-ext-job`). They live
   * on `state.exterior`, which is where the engine reads them — so there is no
   * second copy to keep in step, and a reload restores them like everything
   * else. The screen edits that block directly through `applyExteriorQuickLook`.
   */
  // C8b: the screen's answers are read back from the state's own fields —
  // elements, materials, type and counts, colour, condition, storeys, access.
  const outside: ExteriorQuickLookAnswers = exteriorQuickLookFromState(state.exterior);
  const setOutside = (patch: Partial<ExteriorQuickLookAnswers>) =>
    setState((s) => applyExteriorQuickLook({ ...outside, ...patch }, s));

  const setQuick = (patch: Partial<QuickLookAnswers>) => {
    const next = { ...quick, ...patch };
    set({
      // C9: `colour` is derived from the tiles, never picked (colourFromChanges).
      quickLook: { ...next, colour: colourFromChanges(next) },
      ...(patch.jobType ? { jobType: patch.jobType } : {}),
    });
  };

  /**
   * The typed address rides `state.title` — the field the schema already
   * describes as "the job's name/address" — so it survives a reload like
   * every other answer. Held in component state it was lost on resume, and
   * the suburb/postcode fallback it reveals vanished with it, so a returning
   * customer saw an empty first screen with their later answers intact.
   * (Customer submits build the title from the address itself, so nothing
   * downstream reads this.)
   */
  const quickAddress = state.title || intent?.addressText || "";
  /**
   * Has the quick look handed over? Explicit, because every way of INFERRING
   * it has a case where it is wrong: an outside job sets `jobType` on screen 1
   * and would vanish mid-quick-look, and counting screens cannot tell "on
   * screen 2 of the quick look" from "on page 2 of the exterior questions".
   */
  const [quickDone, setQuickDone] = useState(false);
  const [quickOutOfArea, setQuickOutOfArea] = useState(false);
  /** C8 — the Save & book sheet, reachable from every screen. */
  const [bookOpen, setBookOpen] = useState(false);
  /** The revealed range, held on the client so the three doors can act on it. */
  const [reveal, setReveal] = useState<{ payload: CustomerPayload; estimateId: string } | null>(null);

  // A customer needs an identity before they can upload or submit —
  // an anonymous Supabase session, promoted to an account if they save.
  // S0: this is a three-state thing, not a boolean. "failed" is a place the
  // customer can act from; the old `false` was a dead end with no way out.
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>(isCustomer ? "connecting" : "ready");
  /** Bumped by "Try again" to re-run the sign-in effect. */
  const [sessionAttemptId, setSessionAttemptId] = useState(0);
  /** S0: set the moment the first attempt fails, so the ~26s worst case says
   *  it is still going instead of sitting there looking frozen. */
  const [sessionSlow, setSessionSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [procLine, setProcLine] = useState(0);
  /** The processing screen's rotating tip — advances on a timer. */
  const [procTip, setProcTip] = useState(0);
  useEffect(() => {
    if (screen !== "processing") return;
    const t = setInterval(() => setProcTip((n) => n + 1), 3600);
    return () => clearInterval(t);
  }, [screen]);
  const [planFileCount, setPlanFileCount] = useState(0);
  const [facadeFileCount, setFacadeFileCount] = useState(0);
  // The canonical hydration detector (same as the editors): server snapshot
  // false, client snapshot true, no effect-driven re-render.
  const ready = useSyncExternalStore(emptySubscribe, snapshotTrue, snapshotFalse);
  const [uploading, setUploading] = useState(false);
  /** "Uploading 2 of 3…" — the visible progress the old flow never had. */
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  /** Pages whose background read failed — flagged, not silently skipped. */
  const [readIssueCount, setReadIssueCount] = useState(0);

  /** Reads fired in the background; the processing screen awaits them. */
  const readsRef = useRef<Array<Promise<unknown>>>([]);
  const primaryRunRef = useRef<string | null>(null);
  const damageFilesRef = useRef<File[]>([]);
  /** R5: estimate_sources rows created for run-less condition photos, so the
   * submit can claim them for the estimate (they used to orphan). */
  const conditionSourceIdsRef = useRef<string[]>([]);
  const planInputRef = useRef<HTMLInputElement>(null);
  const facadeInputRef = useRef<HTMLInputElement>(null);
  const damageInputRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  const set = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));

  /** Tom, 31 Aug: name, phone and email are one of the LAST questions — the
   *  final page before the AI builds the estimate, not a gate at the start.
   *  A signed-in member whose account already carries all three (every trade
   *  member, most portal customers) never sees the page at all. */
  const contactDone =
    Boolean(prefill?.email && prefill?.name?.trim() && (prefill?.phone ?? "").replace(/[^0-9]/g, "").length >= 8);
  // Phase 2 (6 Sep plan): the pages are a LIST, not numbers — interior and
  // exterior each have their own; condition and damage share a page; the
  // paint preferences ride the LAST page (the contact details for a customer,
  // their own page for staff and members whose details are already known).
  /**
   * ⚑ §2.1's first complaint: *"screen 1 asks the customer to choose a route
   * before they've seen any value. That's a decision about OUR mechanics, not
   * their house."* So a customer no longer chooses — they start on the quick
   * look, and the other two ways in are offers on that first screen for
   * people who have a floorplan or would rather write it out. Staff and the
   * resumed-walk path are unchanged.
   */
  const [entry, setEntry] = useState<EntryChoice | null>(
    mode === "customer" && !prefillState && entryFromState(resume?.state ?? defaultWizardState()) == null
      ? "questions"
      : null,
  );
  // Tom, 7 Sep: "Describe it" is one request — the property page, then the
  // contact details (still the LAST question before the build), then the
  // build lands in the editor. Nothing else is asked.
  const describing = isCustomer && entry === "describe";
  // Tom, 7 Sep (evening): the paragraph builds the ROOM LIST, but the
  // questions the form asks up front — condition and damage (with photos),
  // the safety flags, occupancy — are still asked; the build was assuming
  // "no damage, built after 1970" for every described job.
  // Tom, 7 Sep (late): a commercial property skips "Anything else out there?"
  // (pergola, balustrades, paint preferences) — a person prices it anyway.
  const commercial = isCustomer && state.customer?.propertyKind === "commercial";
  const pageKeys: PageKey[] = describing
    ? ["property", ...(state.jobType === "exterior" ? ["ext_condition" as const] : ["condition" as const, "details" as const]), ...(!contactDone ? ["contact" as const] : [])]
    : state.jobType === "exterior"
      // Tom, 7 Sep: the follow-up page exists only when something other than
      // the house was ticked (fence type, shed / wall material, floor area).
      ? ["property", "house", ...(state.exterior?.targets.some((t) => t !== "house") ? ["scope" as const] : []), "ext_condition", ...(commercial ? [] : ["extras" as const]), ...(isCustomer && !contactDone ? ["contact" as const] : [])]
      : ["property", "surfaces", "condition", "details", ...(isCustomer && !contactDone ? ["contact" as const] : ["paint" as const])];
  // The quick look has its own, shorter walk — the header dots must count IT,
  // not the pages it replaced, or four screens show five dots and the last
  // one never fills.
  /**
   * The quick look is the DEFAULT customer route, not a fourth choice.
   *
   * §2.1's first complaint is that screen 1 made people choose a route before
   * they had seen any value. So "answer a few questions" is simply where a
   * customer starts, and the other two ways in stay on the screen as offers
   * for the people who have a floorplan or would rather write a paragraph.
   *
   * Exterior keeps the existing pages: its own five-answer quick look is the
   * other half of §9.7, still blocked on the per-elevation allowances spec.
   */
  const quickActive = isCustomer && entry === "questions" && !quickDone;
  const lastPage = quickActive ? stepsFor(quick.jobType, quick.propertyKind).length : pageKeys.length;
  const pageKey: PageKey = pageKeys[Math.min(page, lastPage) - 1];
  const chooseEntry = (e: EntryChoice) => {
    setQuickDone(true);
    setEntry(e);
    set(entryPatch(e, state.jobType, state.exterior, state.basics));
  };

  // Phase 0 (6 Sep plan): the three safety answers carry no silent default —
  // heritage, built-before-1970 and asbestos read as unanswered until the
  // customer taps one, and Continue names the one still open. A rebook
  // arrives with the prior job's answers, which count as answered.
  const [answered, setAnswered] = useState<SafetyAnswered>(() =>
    prefillState ? { heritage: true, pre1970: true, asbestos: true } : { heritage: false, pre1970: false, asbestos: false });
  const markAnswered = (k: keyof SafetyAnswered) => setAnswered((a) => (a[k] ? a : { ...a, [k]: true }));

  // Phase 1 (6 Sep plan): save-and-return on this device. The answers are
  // kept in the browser as the customer goes; on the next visit they come
  // back to the page they were on, with a line saying so and a way to start
  // again. A rebook or a member's prefilled walk is never overridden, and a
  // homepage hand-off for a DIFFERENT address starts fresh (lib/wizard/resume).
  const [resumed, setResumed] = useState<string | null>(null);
  const clearResume = () => { try { localStorage.removeItem(RESUME_KEY); } catch { /* storage may be unavailable */ } };
  const startAgain = () => {
    clearResume();
    // The server copy would otherwise come straight back on the next reload:
    // mark the restart here and reset the open draft row (lib/wizard/resume).
    try { localStorage.setItem(RESTART_KEY, new Date().toISOString()); } catch { /* storage may be unavailable */ }
    void fetch("/api/wizard/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: {}, reset: true }), keepalive: true }).catch(() => {});
    setResumed(null);
    // A customer starting again lands back on the quick look, which is where
    // they started — not on a route choice they were never asked to make.
    setQuickDone(false);
    setEntry(isCustomer ? "questions" : null);
    setState(makeInitialState());
    setAnswered({ heritage: false, pre1970: false, asbestos: false });
    setPage(1);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    if (!isCustomer || prefillState || prefill?.address) return;
    // Deferred: the restore is a state change, and it must land after paint.
    const t = setTimeout(() => {
      let raw: string | null = null;
      let restartedAt: string | null = null;
      try { raw = localStorage.getItem(RESUME_KEY); restartedAt = localStorage.getItem(RESTART_KEY); } catch { raw = null; }
      const local = decodeResume(raw, new Date(), { incomingAddress: intent?.addressText ?? null });
      // The server copy (any device) vs the browser copy — whichever is newer;
      // a server copy from before a "Start again" on this device is not a resume.
      const server = resume && !restartedSince(resume.savedAt, restartedAt) && !(intent?.addressText && (resume.addressText || resume.state.customer?.suburb) && !decodeResume(encodeResume(resume), new Date(), { incomingAddress: intent.addressText })) ? resume : null;
      // C3: decided by the server's version counter, not by comparing two
      // clocks on two devices — see pickResume.
      // C8: an assisted open is the customer's SESSION, not this browser's walk.
      const { pick: r, from } = assisted && resume ? { pick: resume, from: "server" as const } : pickResume(local, server);
      if (!r) return;
      // Whichever copy we took, its version is what the next write is against.
      draftVersionRef.current = (r as { version?: number }).version ?? null;
      setConfirmedVersion((r as { version?: number }).version ?? null);
      draftBaseRef.current = r.state as unknown as Record<string, unknown>;
      if (from === "server") {
        // The browser cache was behind. Replace it so the two agree from here.
        try { localStorage.setItem(RESUME_KEY, encodeResume(r)); } catch { /* private mode */ }
      }
      setState(r.state);
      setAnswered(r.answered);
      /**
       * C3 — the screen comes from `last_screen` when we have it, and is only
       * INFERRED when we do not. `entryFromState` keys on `state.quickLook`,
       * which appears once the customer answers a quick-look question; someone
       * who typed an address, pressed Continue and closed the tab had no such
       * key and came back to the page set, under a banner saying "you were at
       * The place". Recording beats inferring.
       */
      const screenTag = (r as { lastScreen?: string | null }).lastScreen ?? null;
      if (screenTag?.startsWith("quick:")) {
        setEntry("questions");
        setQuickDone(false);
      } else {
        setEntry(entryFromState(r.state));
      }
      setPage(r.page);
      setResumed(resumeLine(r.page, r.state.jobType));
    }, 0);
    return () => clearTimeout(t);
    // Mount only: a later change to these props is a new walk, not a resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2.4 · record the arrival once, on mount. First touch writes itself only
  // the first time; last touch moves every visit. Wrapped in the helper, which
  // never throws — a marketing tag must not be able to break an estimate.
  useEffect(() => { captureTouch(); }, []);

  // S4: hand the person to the assistant on a fresh draft of their own.
  const [startingChat, setStartingChat] = useState(false);
  /** The processing screen is showing a BRIEF build, not a form submit. */
  const [briefBuilding, setBriefBuilding] = useState(false);
  const [brief, setBrief] = useState("");
  async function startChat(withBrief = false) {
    setStartingChat(true);
    // Tom, 7 Sep: a build must never look frozen — the same processing screen
    // the form path shows, with the brief's own steps.
    let ticks: ReturnType<typeof setTimeout>[] = [];
    if (withBrief) {
      setBriefBuilding(true);
      setScreen("processing");
      setProcLine(1);
      ticks = [setTimeout(() => setProcLine(2), 5000), setTimeout(() => setProcLine(3), 11000)];
    }
    const backToPages = () => { ticks.forEach(clearTimeout); setBriefBuilding(false); setScreen("pages"); setStartingChat(false); };
    try {
      // The page-1 address rides along so the brief prices with a known property.
      const address = state.address
        ? { street: state.address.street, suburb: state.address.suburb, postcode: state.address.postcode, state: state.address.state }
        : state.customer && (state.customer.suburb || state.customer.postcode)
          ? { street: "", suburb: state.customer.suburb, postcode: state.customer.postcode, state: "VIC" }
          : null;
      const contact = withBrief ? { name: state.contact.name.trim(), email: state.contact.email.trim(), phone: state.contact.phone.trim() } : null;
      // Tom, 7 Sep (evening): the damage photos go up first — they used to be
      // asked only on the form path; their source rows are claimed for the
      // built estimate, and the form's answers ride the build request.
      const conditionSourceIds = withBrief ? await analyseDamagePhotos().then(() => conditionSourceIdsRef.current).catch(() => conditionSourceIdsRef.current) : [];
      const answers = withBrief ? {
        condition: state.condition,
        details: state.details,
        customer: state.customer ? {
          propertyKind: state.customer.propertyKind, bodyCorporate: state.customer.bodyCorporate,
          heritageListed: state.customer.heritageListed, builtPre1970: state.customer.builtPre1970, asbestosSuspected: state.customer.asbestosSuspected,
        } : undefined,
        exterior: state.jobType === "exterior" && state.exterior ? {
          storeys: state.exterior.storeys, condition: state.exterior.condition,
          access: state.exterior.access, accessEquipment: state.exterior.accessEquipment,
        } : undefined,
        conditionSourceIds,
      } : null;
      const res = await fetch("/api/agent/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        ...(withBrief && brief.trim() ? { brief: brief.trim() } : {}),
        ...(address ? { address: { ...address, formatted: state.address?.formatted ?? "" } } : {}),
        ...(contact ? { contact } : {}),
        ...(answers ? { answers } : {}),
      }) });
      const j = (await res.json().catch(() => ({}))) as { conversationId?: string; estimateId?: string; built?: boolean; error?: string };
      if (!res.ok || !j.conversationId) { backToPages(); setError(j.error ?? "That didn't go through — please try again."); return; }
      ticks.forEach(clearTimeout);
      setProcLine(4);
      // Tom, 7 Sep: a described job lands STRAIGHT in the editor with every
      // assumption marked; the chat is only where the paragraph wasn't enough.
      if (withBrief && j.built && j.estimateId) {
        clearResume();
        router.push(`/estimate/scope?id=${j.estimateId}`);
        return;
      }
      router.push(`/estimate/assist?c=${j.conversationId}`);
    } catch { backToPages(); setError("That didn't go through — check the connection and try again."); }
  }

  useEffect(() => {
    if (!isCustomer) return;
    let live = true;
    const supabase = createBrowserClient();

    /** One full try: use the session we have, else ask for an anonymous one. */
    const attempt = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) return true;
      const { error: signInError } = await supabase.auth.signInAnonymously();
      return !signInError;
    };

    // Already "connecting" — initial state for a customer, and what
    // retrySession sets before it bumps the id that re-runs this.
    void establishSession(attempt, {
      onAttemptFailed: ({ willRetry }) => {
        // Only while another try is coming — once it is over, the error and
        // its "Try again" say everything, and two messages would compete.
        if (live && willRetry) setSessionSlow(true);
      },
    }).then((outcome) => {
      if (!live) return;
      setSessionSlow(false);
      setSessionPhase(outcome.phase);
      // The error clears on a retry, so it can never outlive the failure.
      setError(outcome.phase === "failed" ? SESSION_ERROR_TEXT : null);
    });

    return () => { live = false; };
  }, [isCustomer, sessionAttemptId]);

  /** S0: the way back. Without this a failed sign-in could only be escaped by
   *  reloading the page, which most customers on a phone will not do. */
  const retrySession = () => {
    setError(null);
    setSessionSlow(false);
    setSessionPhase("connecting");
    setSessionAttemptId((n) => n + 1);
    // NOTE: `state`, `page` and the staged files are deliberately untouched —
    // a retry must never cost the customer what they have already typed.
  };

  // ---- page-1 uploads -------------------------------------------------------

  /** Kick a page's read off in the background; a failure is NOTED, never
   * swallowed — the old silent .catch() meant a page could sit unread and
   * nobody found out until submit skipped it. */
  const kickRead = (runId: string) => {
    readsRef.current.push(
      fetch(`/api/extract/${runId}/read`, { method: "POST" })
        .then((r) => {
          if (!r.ok) setReadIssueCount((n) => n + 1);
          return r;
        })
        .catch(() => { setReadIssueCount((n) => n + 1); return null; }),
    );
  };

  /**
   * A3: uploads no longer ride a multipart POST through the serverless
   * function (its ~4.5 MB body cap silently killed real plans). Each file is
   * checked client-side first, staged straight to storage via a signed URL,
   * then the process route validates the bytes and returns the run ids.
   */
  async function stageAndProcess(rawFiles: File[], kind: "floorplan" | "elevation"): Promise<{ runIds: string[]; primaryRunId: string | null } | null> {
    const files = rawFiles.slice(0, 5);
    for (const f of files) {
      const problem = checkUpload({ name: f.name, size: f.size, type: f.type }, "document");
      if (problem) { setError(problem); return null; }
    }

    // 1. signed upload URLs for the batch
    const prep = await fetch("/api/extract/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: files.map((f) => ({ name: f.name, size: f.size })) }),
    });
    const prepJson = await prep.json().catch(() => ({}));
    if (!prep.ok) { setError(prepJson.error ?? "The upload couldn't start — try again."); return null; }
    const slots: Array<{ path: string; token: string }> = prepJson.uploads ?? [];
    if (slots.length !== files.length) { setError("The upload couldn't start — try again."); return null; }

    // 2. the bytes go straight to storage, one file at a time, with progress
    const supabase = createBrowserClient();
    const staged: Array<{ path: string; name: string }> = [];
    for (let i = 0; i < files.length; i++) {
      setUploadNote(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : "Uploading…");
      const { error: upErr } = await supabase.storage
        .from("estimate-sources")
        .uploadToSignedUrl(slots[i].path, slots[i].token, files[i]);
      if (upErr) {
        setError(`"${files[i].name}" didn't upload — check your connection and try that one again.`);
        return null;
      }
      staged.push({ path: slots[i].path, name: files[i].name });
    }

    // 3. server-side validation + ingest of the staged bytes
    setUploadNote("Checking the files…");
    const res = await fetch(`/api/extract/floorplan?kind=${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploads: staged }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "The upload didn't work — try again."); return null; }
    return { runIds: j.runIds ?? [], primaryRunId: j.primaryRunId ?? null };
  }

  async function uploadPlans(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      // R1.3: a floorplan is EXACTLY ONE document — a new upload REPLACES the
      // old one, and the primary run moves with it (it used to pin to the
      // first-ever upload, so damage photos and the listing cross-check could
      // only ever attach to the first file).
      const out = await stageAndProcess(files.slice(0, 1), "floorplan");
      if (!out) return;
      const ids = out.runIds;
      primaryRunRef.current = out.primaryRunId ?? ids[0] ?? null;
      for (const runId of ids) kickRead(runId);
      setState((s) => ({ ...s, planRunIds: ids, noPlan: false }));
      setPlanFileCount(1);
    } catch {
      setError("The upload didn't finish — check your connection and try again.");
    } finally {
      setUploading(false);
      setUploadNote(null);
    }
  }

  /** Tom, 31 Aug: read the floorplan straight off the pasted listing. The
   * server finds + downloads the plan image and stages it; the staged path
   * then rides the SAME ingest as an uploaded plan. Failures are spoken —
   * realestate.com.au blocks automated access, and the error says to
   * screenshot the plan instead. */
  async function importListingPlan() {
    const url = state.listingUrl.trim();
    if (!url) { setError("Paste the listing link first."); return; }
    setUploading(true);
    setError(null);
    setUploadNote("Reading the listing…");
    try {
      const res = await fetch("/api/extract/listing-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Couldn't read that listing — upload the floorplan instead."); return; }
      setUploadNote("Reading the floorplan…");
      const proc = await fetch("/api/extract/floorplan?kind=floorplan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploads: [{ path: j.path, name: j.name ?? "listing-floorplan" }] }),
      });
      const pj = await proc.json().catch(() => ({}));
      if (!proc.ok) { setError(pj.error ?? "The listing's floorplan couldn't be read — upload it instead."); return; }
      const ids: string[] = pj.runIds ?? [];
      primaryRunRef.current = pj.primaryRunId ?? ids[0] ?? null;
      for (const runId of ids) kickRead(runId);
      setState((s) => ({ ...s, planRunIds: ids, noPlan: false }));
      setPlanFileCount(1);
    } catch {
      setError("The listing couldn't be read — check your connection, or upload the floorplan instead.");
    } finally {
      setUploading(false);
      setUploadNote(null);
    }
  }

  async function uploadFacades(files: File[]) {
    if (!files.length) return;
    setError(null);
    setUploading(true);
    try {
      const out = await stageAndProcess(files, "elevation");
      if (!out) return;
      // E2: each facade starts its elevation read in the background, same as
      // plan pages — the envelope assembles from whatever has finished.
      for (const runId of out.runIds) kickRead(runId);
      setState((s) => ({ ...s, facadeRunIds: [...s.facadeRunIds, ...out.runIds] }));
      setFacadeFileCount((n) => n + files.length);
    } catch {
      setError("The upload didn't finish — check your connection and try again.");
    } finally {
      setUploading(false);
      setUploadNote(null);
    }
  }

  // ---- submit ---------------------------------------------------------------

  async function runSubmit(override?: WizardState) {
    draftHaltRef.current = true;   // no autosave may race the conversion

    setScreen("processing");
    setError(null);
    try {
      await runSubmitInner(override);
    } catch (e) {
      // A dropped connection must never strand the customer on the spinner -
      // their answers are all still in state, so send them back to retry.
      // The real exception goes to the console — "connection dropped" once
      // masked a plain client bug for a whole e2e run.
      console.error("wizard submit failed", e);
      setScreen("pages");
      setError("The connection dropped while we were working — nothing was lost. Check your internet and tap through again.");
    }
  }

  /** A7: stage the damage photos to storage (signed URLs, 5 per call) and
   * run the defect reader on them; failures come back as readable warnings
   * instead of vanishing. */
  async function analyseDamagePhotos(): Promise<string[]> {
    const files = damageFilesRef.current.slice(0, 12);
    if (!files.length) return [];
    const issues: string[] = [];
    const supabase = createBrowserClient();
    const staged: Array<{ path: string; name: string }> = [];
    try {
      for (let at = 0; at < files.length; at += 5) {
        const batch = files.slice(at, at + 5);
        const prep = await fetch("/api/extract/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: batch.map((f) => ({ name: f.name, size: f.size })) }),
        });
        const prepJson = await prep.json().catch(() => ({}));
        if (!prep.ok) { issues.push(prepJson.error ?? "The damage photos couldn't be uploaded."); break; }
        const slots: Array<{ path: string; token: string }> = prepJson.uploads ?? [];
        for (let i = 0; i < batch.length && i < slots.length; i++) {
          const { error: upErr } = await supabase.storage
            .from("estimate-sources")
            .uploadToSignedUrl(slots[i].path, slots[i].token, batch[i]);
          if (upErr) issues.push(`Damage photo "${batch[i].name}" didn't upload — add it again in the editor.`);
          else staged.push({ path: slots[i].path, name: batch[i].name });
        }
      }
      if (!staged.length) return issues.length ? issues : ["The damage photos couldn't be uploaded — add them again in the editor."];
      // R1.3: condition photos never require a floorplan. With a plan run
      // they feed the defect reader; without one they are KEPT for the
      // estimator via the run-less record route — visibly, never silently.
      const endpoint = primaryRunRef.current
        ? `/api/extract/${primaryRunRef.current}/photos?purpose=damage`
        : "/api/extract/photos";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploads: staged }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        issues.push(j.error ?? "The damage photos couldn't be analysed — the damage is flagged for review instead.");
      } else {
        for (const p of (j.perPhoto ?? []) as Array<{ file?: string; error?: string }>) {
          if (p.error) issues.push(`Damage photo "${p.file ?? "photo"}": ${p.error}`);
        }
        // R5: the run-less route now hands back the rows it created so the
        // submit can CLAIM them for the estimate. Before this they were kept
        // in storage with estimate_id = null — saved, but attached to
        // nothing, so they never appeared on the editor.
        if (Array.isArray(j.sourceIds)) conditionSourceIdsRef.current = j.sourceIds as string[];
        if (!primaryRunRef.current && Number(j.kept) > 0) {
          issues.push("Your damage photos are saved with the estimate — your estimator reviews them rather than the automatic reader (no floorplan to attach them to).");
        }
      }
    } catch {
      issues.push("The damage photos couldn't be analysed — the damage is flagged for review instead.");
    }
    return issues;
  }

  async function runSubmitInner(override?: WizardState) {
    setProcLine(1);
    // 1. Let every background read finish.
    await Promise.all(readsRef.current);
    setProcLine(2);
    // 2. Damage photos feed the defect reader on the primary run — its
    // findings ride the estimate as review deferrals (the editor shows them).
    await analyseDamagePhotos();
    // 3. The listing cross-check rides the primary run too.
    if (state.listingUrl.trim() && primaryRunRef.current) {
      await fetch(`/api/extract/${primaryRunRef.current}/listing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: state.listingUrl.trim() }),
      }).catch(() => null);
    }
    setProcLine(3);
    // 3.5 Exterior rule 2 (Tom's ruling): when the job has an exterior and a
    // floorplan, derive the building's edge widths from the plan's room
    // dimensions. The reading rides as its own run id; the server flags
    // everything priced from it for a human check.
    let footprintRunId: string | null = null;
    if (state.jobType !== "interior" && primaryRunRef.current) {
      const res = await fetch(`/api/extract/${primaryRunRef.current}/footprint`, { method: "POST" }).catch(() => null);
      if (res?.ok) {
        const j = await res.json().catch(() => null);
        if (j?.footprintRunId) footprintRunId = j.footprintRunId as string;
      }
    }
    // 4. The submit rebuilds, merges, prices and scores server-side. The
    // photo count rides as stated: the server treats it as a claim and checks
    // the READINGS for real defect observations — no observations means it
    // neutralises the count itself and raises the "damage to price" deferral.
    // (R1.3: photos without a plan run are now kept via /api/extract/photos,
    // so the old client-side zeroing both lied and broke the customer gate.)
    // The contact email doubles as the property email — synced HERE, not via
    // setState, because this closure still reads the pre-set state.
    // The quick look derives its state at the moment the customer taps "See my
    // guide range" and hands it in directly — a setState here would not have
    // landed by the time this closure reads it, and the submit would price
    // yesterday's answers.
    const src = override ?? state;
    const customer = src.customer && !src.customer.email.trim() && src.contact.email.trim()
      ? { ...src.customer, email: src.contact.email.trim() }
      : src.customer;
    const submitState = {
      ...src,
      customer,
      planRunIds: footprintRunId ? [...src.planRunIds, footprintRunId] : src.planRunIds,
      conditionSourceIds: conditionSourceIdsRef.current,
    };
    const res = await fetch("/api/wizard/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 2.4: where this visitor came from rides with the submit. Captured on
      // arrival and read here rather than posted separately, so attribution
      // lands in the same transaction as the estimate or not at all.
      body: JSON.stringify({ state: submitState, attribution: readAttribution() }),
    });
    const j = await res.json().catch(() => ({}));

    // Customer guardrail outcomes are answers, not errors.
    if (isCustomer && typeof j.outcome === "string" && j.outcome !== "reveal") {
      setOutcome(j as CustomerOutcome);
      setScreen("editor"); // the result screen takes over
      return;
    }
    if (!res.ok) {
      setScreen("pages");
      if (Array.isArray(j.path) && j.path.length) setPage(pageForPath(j.path));
      setError(j.error ?? "Something didn't work — please check the answers and try again.");
      return;
    }
    if (isCustomer) {
      const landedId = (j as { estimateId: string }).estimateId;
      /**
       * ⚑ THE 28 AUG RULING IS REVERSED FOR THE QUICK LOOK (v2 phase 2).
       *
       * "No interstitial result screen — a revealed estimate goes STRAIGHT to
       * the confirm-loop editor" was right for a wizard that only reached a
       * price after 25-30 answers and a contact form: by then another screen
       * was a toll on somebody already committed. The quick look's promise is
       * the opposite — a number in under a minute, no commitment — so the
       * reveal IS the product, and the three doors are how §1's "one flow,
       * two speeds" actually reaches a time-poor customer.
       *
       * The describe and upload routes still land straight in the editor:
       * they asked the long questions, so they have earned the editor.
       */
      if (quickActive) {
        setReveal({ payload: j as CustomerPayload, estimateId: landedId });
        setScreen("reveal");
        clearResume();
        return;
      }
      clearResume();
      router.push(`/estimate/scope?id=${landedId}`);
      return;
    }
    // Tom (20 Aug): staff land in the NEW confirm-loop editor — the same
    // view the customer gets (R1.1 parity), replacing the old W3 internal
    // editor screen. Margin and deep surgery stay in /quote; photo issues
    // ride the estimate as review deferrals either way.
    const landed = j as SubmitResult;
    // The draft is no longer a drop-out: mark it converted so no funnel ever
    // chases somebody who actually finished.
    if (isCustomer) {
      void fetch("/api/wizard/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, converted: true, estimateId: landed.estimateId, page: lastPage, lastPage }),
        keepalive: true,
      }).catch(() => {});
    }
    clearResume();
    router.push(`/estimate/scope?id=${landed.estimateId}`);
  }

  /**
   * C15 · autosave.
   *
   * Every change, coalesced into one write a few seconds later — a keystroke
   * per request would be both wasteful and slower than the person typing.
   * Deliberately fire-and-forget: a failed save must never interrupt somebody
   * filling in a form, so nothing here is awaited and nothing is shown.
   *
   * Only once there is an email. Before that there is no way to reach them, so
   * a row would be a half-finished form nobody can act on.
   */
  // ONE save in flight at a time (6 Sep). Two overlapping POSTs race at the
  // database — the older one, slower because it priced the draft, landed
  // after the newer one and wiped the email the person had just typed
  // (CI run #105). The newest body waits for the one in flight, then goes.
  /**
   * C3 — one server truth. `draftVersionRef` is the version the server last
   * confirmed; every write carries it so a stale tab loses the race loudly
   * instead of erasing the winner. `draftBaseRef` is the state that version
   * represents — the common ancestor a 409 merge needs, because "the server
   * changed it" and "I changed it" are only distinguishable against what both
   * sides last agreed on.
   */
  const draftVersionRef = useRef<number | null>(null);
  /**
   * The same number as `draftVersionRef`, as STATE — so the localStorage cache
   * effect re-runs the moment a save is confirmed and re-stamps the cache with
   * the version it is now based on.
   *
   * Without this the cache is written 400 ms after a keystroke while the server
   * confirms at 2.5 s+, so the stamp always lagged by one save, `pickResume`
   * read "the browser is behind" on a perfectly good copy, and a refresh
   * resumed from the server's older state — which put a customer mid-quick-look
   * back into the page set. Caught by the C3 e2e, not by reasoning.
   */
  const [confirmedVersion, setConfirmedVersion] = useState<number | null>(null);
  const draftBaseRef = useRef<Record<string, unknown> | null>(null);
  /** Set below, once `state` and `setState` are in scope for the merge. */
  const onDraftConflictRef = useRef<((server: DraftConflict) => void) | null>(null);
  const inFlightRef = useRef(false);
  const queuedRef = useRef<string | null>(null);
  const queueDraftSave = useCallback(function send(body: string) {
    if (inFlightRef.current) { queuedRef.current = body; return; }
    inFlightRef.current = true;
    void fetch("/api/wizard/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).then(async (res) => {
      // C3: 409 is the ONE non-200 this route answers, and it is not an error
      // the customer should ever see — somebody else wrote first, and the
      // server has handed back its copy so we can merge rather than guess.
      if (res.status === 409) {
        const server = await res.json().catch(() => null) as DraftConflict | null;
        if (server) onDraftConflictRef.current?.(server);
        return;
      }
      const j = await res.json().catch(() => null) as { version?: number } | null;
      if (typeof j?.version === "number") {
        draftVersionRef.current = j.version;
        setConfirmedVersion(j.version);
      }
    }).catch(() => {}).finally(() => {
      inFlightRef.current = false;
      const next = queuedRef.current;
      queuedRef.current = null;
      if (next && !draftHaltRef.current) send(next);
    });
  }, []);

  const savedRef = useRef("");
  /** Set at the moment submit starts. The pending debounce otherwise fires
   *  DURING the processing screen and races the server's conversion — the
   *  probe run left an orphan "open" draft at 83% that way. */
  const draftHaltRef = useRef(false);
  // Buckets brief §2.1: a session exists from the first answer (an address,
  // a suburb, or moving off page 1) — not from the email, which is now the
  // LAST page. "An address is a lead in this business." A visitor who lands
  // and bounces still leaves nothing.
  // The quick look stores what they typed on `state.title` (see quickAddress),
  // so the draft's address signal and the browser resume copy must read it —
  // otherwise a walk with a typed-but-unresolved address looks addressless and
  // `sessionWorthSaving` never turns on.
  const addressText = (state.address as { formatted?: string } | null | undefined)?.formatted?.trim()
    || state.title.trim() || intent?.addressText?.trim() || "";
  const sessionWorthSaving = page > 1 || Boolean(addressText) || Boolean((state.customer?.suburb ?? "").trim());

  /**
   * Write the draft NOW, not in 2.5 seconds.
   *
   * The autosave is debounced, which is right while somebody is typing and
   * wrong at the moment they are handed to a person: a commercial exterior
   * hand-off (9.3c) is the end of the customer's walk, and if they close the
   * tab on that screen the lead has to already exist. Carries the version like
   * every other write, so it cannot overwrite a concurrent one.
   */
  const flushDraft = useCallback((screenTag: string) => {
    if (!isCustomer) return;
    queueDraftSave(JSON.stringify({
      state, page, lastPage,
      ...(intent?.mode ? { mode: intent.mode } : {}),
      entrySource: intent?.entrySource || "direct",
      ...(addressText ? { address: addressText.slice(0, 250) } : {}),
      ...(draftVersionRef.current != null ? { version: draftVersionRef.current } : {}),
      lastScreen: screenTag,
    }));
  }, [isCustomer, state, page, lastPage, intent?.mode, intent?.entrySource, addressText, queueDraftSave]);
  /**
   * C3 — where they actually are, as a word rather than a number. The funnel
   * keeps current_page/furthest_page; this is what a staff member reads when
   * they open a live session and the customer is still in it, and what the
   * resume lands on. The quick look's own step names are the honest answer
   * there; the page set falls back to its page key.
   */
  const lastScreen = screen === "processing"
    ? "processing"
    : quickActive
      ? `quick:${stepsFor(quick.jobType, quick.propertyKind)[Math.min(Math.max(page, 1), stepsFor(quick.jobType, quick.propertyKind).length) - 1]}`
      : `page:${pageKeys[Math.min(page, pageKeys.length) - 1] ?? page}`;

  /**
   * C3 — the 409 merge. Somebody else wrote first; the server handed back its
   * copy. Merge it against the state this client last saved, adopt the server's
   * version so the next write is against reality, and carry on. The customer is
   * told nothing: they have done nothing wrong and are probably mid-sentence.
   * `draft-merge.ts` owns the rule — server for what I have not touched, mine
   * for what I have, and a confirmation is never withdrawn.
   */
  useEffect(() => {
    onDraftConflictRef.current = (server) => {
      if (typeof server.version === "number") draftVersionRef.current = server.version;
      const theirs = server.state;
      if (!theirs || typeof theirs !== "object") return;
      setState((current) => {
        const base = draftBaseRef.current ?? (current as unknown as Record<string, unknown>);
        const { state: merged } = mergeDraftState(base, current as unknown as Record<string, unknown>, theirs);
        return merged as unknown as WizardState;
      });
      // The merged state is what the next write is against; the effect above
      // re-derives the body and sends it with the server's version.
      savedRef.current = "";
    };
    return () => { onDraftConflictRef.current = null; };
  }, []);

  useEffect(() => {
    if (!isCustomer) return;
    if (draftHaltRef.current) return;
    if (!sessionWorthSaving) return;

    const body = JSON.stringify({
      state, page, lastPage,
      ...(intent?.mode ? { mode: intent.mode } : {}),
      entrySource: intent?.entrySource || "direct",
      ...(addressText ? { address: addressText.slice(0, 250) } : {}),
      // C3: the version this write is against, and where they actually are.
      ...(draftVersionRef.current != null ? { version: draftVersionRef.current } : {}),
      lastScreen,
    });
    if (body === savedRef.current) return;

    const t = setTimeout(() => {
      if (draftHaltRef.current) return;
      savedRef.current = body;
      // The state this write claims — and therefore the ancestor a later 409
      // merges against. Captured BEFORE the request, because the customer keeps
      // typing while it is in flight.
      draftBaseRef.current = state as unknown as Record<string, unknown>;
      queueDraftSave(body);
    }, 2500);
    return () => clearTimeout(t);
  }, [state, page, lastPage, isCustomer, sessionWorthSaving, addressText, intent?.mode, intent?.entrySource, queueDraftSave, lastScreen]);

  /**
   * The same-device copy, written a beat after every change.
   *
   * C3 — this is a CACHE of the server draft, not a third truth. It carries the
   * version it is based on, so `pickResume` can tell "the server's copy plus a
   * few seconds of typing" from "a copy that never saw the other tab's work"
   * without comparing two devices' clocks. It is still written eagerly rather
   * than only on server confirmation, because the 2.5-second autosave debounce
   * would otherwise lose the last keystrokes to a hard refresh — but it can no
   * longer WIN against a server copy that has moved on.
   */
  useEffect(() => {
    if (!isCustomer || screen !== "pages" || !sessionWorthSaving || draftHaltRef.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(RESUME_KEY, encodeResume({
          savedAt: new Date().toISOString(), page, state, answered, addressText,
          ...(confirmedVersion != null ? { version: confirmedVersion } : {}),
          lastScreen,
        }));
      } catch { /* private mode, full storage — the server autosave still runs */ }
    }, 400);
    return () => clearTimeout(t);
  }, [state, page, answered, isCustomer, screen, sessionWorthSaving, addressText, confirmedVersion, lastScreen]);

  // Buckets brief §2.3 · the heartbeat. Every 15 s, ONLY while the tab is
  // visible and there has been a keypress, tap or scroll in the last 60 s —
  // so a tab left open overnight adds nothing, and "9 minutes on the page"
  // means nine minutes of attention. Fire-and-forget like the autosave.
  const lastInputRef = useRef(0);
  useEffect(() => {
    if (!isCustomer) return;
    const bump = () => { lastInputRef.current = Date.now(); };
    bump();
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener("pointerdown", bump, opts);
    window.addEventListener("keydown", bump, opts);
    window.addEventListener("scroll", bump, opts);
    window.addEventListener("touchstart", bump, opts);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("scroll", bump);
      window.removeEventListener("touchstart", bump);
    };
  }, [isCustomer]);
  useEffect(() => {
    if (!isCustomer || screen !== "pages" || !sessionWorthSaving) return;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastInputRef.current > 60_000) return;
      if (draftHaltRef.current) return;
      void fetch("/api/wizard/heartbeat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page }), keepalive: true,
      }).catch(() => {});
    };
    const id = window.setInterval(beat, 15_000);
    return () => window.clearInterval(id);
  }, [isCustomer, screen, page, sessionWorthSaving]);

  // ---- client-side page gates (server re-validates everything) --------------

  function pageBlocker(): string | null {
    if (pageKey === "property") {
      // The contact block is the first thing on the page, so it is the first
      // thing checked — being told about a field you cannot see is how a gate
      // reads as broken.
      if (!isCustomer) {
        const c = state.contact;
        if (!c.name.trim()) return "Whose job is it? A name, please.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) return "An email for them — it's how the estimate reaches them.";
        if (c.phone.replace(/[^0-9]/g, "").length < 8) return "A phone number too, so someone can ring them.";
      }
      const wantsInterior = state.jobType !== "exterior";
      if (isCustomer && (!state.customer || state.customer.suburb.trim() === "" || state.customer.postcode.trim() === "")) {
        return "Where's the property? Suburb and postcode, please.";
      }
      // Phase 2: a way in is chosen, not implied.
      if (isCustomer && !entry) return "How would you like to do this? Pick one of the three.";
      if (isCustomer && entry === "describe" && brief.trim().length < 20) {
        return "Type a few lines about the job first — or pick another way in.";
      }
      // A described job is built from the paragraph alone (Tom, 7 Sep): no
      // floorplan, basics or facade photos are asked for. The C1 run of 7 Sep
      // caught the gate below stopping it with "Upload a floorplan…".
      if (isCustomer && entry === "describe") return null; // the pages after this keep their own gates
      if (wantsInterior && !state.noPlan && state.planRunIds.length === 0) {
        return state.listingUrl.trim()
          ? "Tap “Read the floorplan from this listing”, upload a floorplan, or choose the quick basics instead."
          : "Upload a floorplan, or choose the quick basics instead.";
      }
      if (state.noPlan && !state.basics) return "A couple of basics first, please.";
      if (state.jobType !== "interior" && !state.listingUrl.trim() && state.facadeRunIds.length < 2
        && !state.exterior?.noPhotos) {
        return "Exterior needs the listing or two to three facade photos — or tap “No photos to hand” and we'll size it from your answers.";
      }
    }
    if (pageKey === "contact") {
      const c = state.contact;
      if (!c.name.trim()) return "Your name, so we know who we're talking to.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) return "An email — it's where your estimate is saved.";
      if (c.phone.replace(/[^0-9]/g, "").length < 8) return "A phone number, in case we need to ask you something.";
    }
    // R2: the exterior pages' own gates.
    if (state.jobType === "exterior") {
      const ext = state.exterior;
      if (pageKey === "house" && (ext?.targets.length ?? 0) === 0) return "What are we painting? Tick at least one.";
      if (pageKey === "house" && ext?.targets.includes("house") && ext.substrates.length === 0) return "What's the house made of? Tick at least one — or “None” if the walls aren't being painted.";
      if (pageKey === "scope" && ext && !Object.values(ext.painting).some(Boolean)) return "Tick at least one thing we're painting.";
      if (pageKey === "ext_condition" && ext?.condition == null) return "How's the paintwork holding up?";
      return null;
    }
    if (pageKey === "surfaces" && state.surfaces.length === 0) return "Tick at least one surface.";
    if (pageKey === "condition" && state.condition.tier === "dark_to_light" && state.condition.darkToLightSurfaces.length === 0) {
      return "Which surfaces are going dark to light?";
    }
    /**
     * Phase 7: the segment question is what a commercial job must answer now.
     * The gates themselves are NOT gated here — an unanswered gate routes to a
     * person (the ladder's job), and blocking the page on seven questions
     * would lose the enquiry the brief explicitly says to capture: "capture
     * everything they've already told you… don't throw it away because you
     * can't price it."
     */
    if (pageKey === "property" && commercial && !state.customer?.commercialSegment && !state.customer?.commercialKind) {
      return "What sort of place is it? Pick the closest one.";
    }
    if (pageKey === "details" && isCustomer && !commercial && !answered.asbestos) return "Any chance of asbestos sheeting? Yes, no or not sure.";
    if (pageKey === "details" && isCustomer && !commercial && state.details.occupied == null) return "Will anyone be living there while we paint? Yes or no.";
    if (pageKey === "condition" && state.details.damageTier >= 2 && state.details.damagePhotoCount === 0) {
      // Customer mode is photos-only (Step 8 brief) - a note cannot be priced.
      if (isCustomer) return "Damage at this level needs photos — a quick phone shot of each area is perfect.";
      if (state.details.damageNote.trim() === "") return "Damage at this level needs photos, or a short description.";
    }
    return null;
  }

  function next() {
    const blocked = pageBlocker();
    if (blocked) { setError(blocked); return; }
    setError(null);
    if (page < lastPage) { setPage(page + 1); window.scrollTo({ top: 0 }); return; }
    // The contact email IS the email — sync it onto the property answers so
    // the submit schema and the funnel both see it, then build.
    if (isCustomer && state.customer && !state.customer.email.trim() && state.contact.email.trim()) {
      set({ customer: { ...state.customer, email: state.contact.email.trim() } });
    }
    // Tom, 7 Sep: a described job builds from the paragraph, not the form.
    if (describing) { void startChat(true); return; }
    void runSubmit();
  }

  function back() {
    setError(null);
    if (page > 1) { setPage(page - 1); window.scrollTo({ top: 0 }); }
  }

  // ---- the quick look -------------------------------------------------------

  const quickSteps = stepsFor(quick.jobType, quick.propertyKind);
  const quickStep = quickSteps[Math.min(Math.max(page, 1), quickSteps.length) - 1];

  /**
   * C12 — the commercial branch of the quick look. The segment key lives on
   * `state.customer.commercialSegment` (where phase 7a put it, so every
   * stored draft and the property page agree); the two screens' answers live
   * on `state.commercial`. Both autosave and resume like everything else.
   */
  const commercialSeg = segmentByKey(segments, state.customer?.commercialSegment);
  const commercialAnswers: CommercialAnswers | null =
    state.commercial && commercialSeg && state.commercial.segment === commercialSeg.key
      ? state.commercial
      : commercialSeg ? defaultCommercialAnswers(commercialSeg) : null;
  const setCommercial = (patch: Partial<CommercialAnswers>) => {
    if (!commercialAnswers) return;
    set({ commercial: { ...commercialAnswers, ...patch } });
  };
  const pickSegment = (key: string) => {
    const seg = segmentByKey(segments, key);
    setState((s) => ({
      ...s,
      customer: { ...(s.customer ?? quickLookToState(quick, s).customer!), propertyKind: "commercial", commercialSegment: key },
      // A new segment starts from its own defaults; the same one keeps what was tapped.
      commercial: seg && s.commercial?.segment === seg.key ? s.commercial : seg ? defaultCommercialAnswers(seg) : null,
    }));
  };
  /**
   * A brief door (C14 builds the brief itself): the lead is flushed with
   * everything answered so far and the customer meets the person screen with
   * the reason in plain words — never "we'll need to see it" on its own.
   */
  const commercialHandOff = (routing: ReturnType<typeof routeCommercial>) => {
    setState((s) => ({
      ...s,
      customer: s.customer ? { ...s.customer, propertyKind: "commercial" } : s.customer,
    }));
    flushDraft(`quick:segment:${routing.briefKey ?? "unknown"}`);
    const why = routing.reasons[0] ? routing.reasons[0].charAt(0).toUpperCase() + routing.reasons[0].slice(1) : "";
    setOutcome({
      outcome: "handoff",
      message: gateMessage(routing),
      why: `${why ? `${why}. ` : ""}One of our estimators will call to arrange a look — we have your address and what you're after.`,
      canRetry: false,
    });
    setScreen("editor");
    window.scrollTo({ top: 0 });
  };
  const quickPhotoRef = useRef<HTMLInputElement>(null);
  const addQuickPhotos = (files: File[]) => {
    for (const f of files) {
      const problem = checkUpload({ name: f.name, size: f.size, type: f.type }, "image");
      if (problem) { setError(problem); return; }
    }
    setError(null);
    damageFilesRef.current = [...damageFilesRef.current, ...files];
    set({ details: { ...state.details, damagePhotoCount: state.details.damagePhotoCount + files.length } });
  };

  function quickNext() {
    setError(null);
    /**
     * Screen 1 needs somewhere to paint. A picked suggestion carries the
     * suburb and postcode; typing alone does not, and the postcode is what
     * the service-area check runs on — an empty one reads as "outside the
     * area" and hands off a job we could have priced.
     */
    if (quickStep === "start" && !state.address
        && !(state.customer?.suburb.trim() && state.customer.postcode.trim())) {
      setError(quickAddress.trim()
        ? "We couldn't look that address up — pop the suburb and postcode in and we'll carry on."
        : "Which address should we price? Start typing and pick it from the list.");
      return;
    }
    /**
     * C12 — a COMMERCIAL place walks the segment screen, then the segment's
     * two screens (areas → job) on a range segment. The hand-off belongs to
     * the SEGMENT screen, which asks the which-part row: outside and both go
     * to the brief (C14; today the person screen with the reason), and so
     * does a brief segment or a kind that leaves (hospital). A ?mode=business
     * visitor still sees screen 1 and the place screen first (AUDIT 9.3(a)).
     */
    if (quickStep === "segment") {
      const key = state.customer?.commercialSegment ?? null;
      if (!key) {
        setError("Pick the closest kind of place — we'll say straight away whether we can price it from here.");
        return;
      }
      const routing = routeCommercial(key, { segments, jobType: quick.jobType });
      if (!routing.canPriceOnline) { commercialHandOff(routing); return; }
      if (!state.commercial || state.commercial.segment !== routing.segment!.key) {
        set({ commercial: defaultCommercialAnswers(routing.segment!) });
      }
      setPage(page + 1);
      window.scrollTo({ top: 0 });
      return;
    }
    if (quickStep === "com_areas") {
      const routing = routeCommercial(state.customer?.commercialSegment, { segments, kind: state.commercial?.kind ?? null, jobType: quick.jobType });
      if (!routing.canPriceOnline) { commercialHandOff(routing); return; }
      setPage(page + 1);
      window.scrollTo({ top: 0 });
      return;
    }
    // C8b: an outside job has to name SOMETHING being painted — nothing is
    // pre-ticked, so an untouched screen is not an answer.
    if (quickStep === "outside" && !paintsSomething(outside)) {
      setError("Tick at least one thing we're painting — on the house, or standing on its own.");
      return;
    }
    if (page < quickSteps.length) {
      setPage(page + 1);
      window.scrollTo({ top: 0 });
      return;
    }
    /**
     * The last screen. Both halves of the answer set are already on the state —
     * the interior from `quickLookToState`, the exterior from the outside
     * screen writing through `applyExteriorQuickLook` — so this derives and
     * submits.
     *
     * ⚑ WHICH SIDES is deliberately not asked here. `s-ext-sides` ("walk around
     * the house", amber for assumed, dashed for not painting) is a TIGHTEN rung
     * and the sides editor already builds it. Four sides start assumed; saying
     * no to one there makes it an explicit exclusion on the quote, which is
     * where that decision belongs — in front of the customer, on the side
     * itself, rather than as a tick on a screen before they have seen a plan.
     */
    const derived = quickLookToState(quick, state);
    if (quickStep === "com_job" && commercialSeg && commercialAnswers) {
      /**
       * C12: the rooms come from the segment's counts and typicals, not the
       * home basics — `basics` is null and `commercial` carries the answers.
       * The ticked surfaces map to substrate keys through the row (a label
       * with no rate is flagged at submit, never guessed); the occupied
       * answer is the segment's, in the details' own words.
       */
      const { keys } = commercialSurfaceKeys(commercialSeg, commercialAnswers);
      const commercialDerived: WizardState = {
        ...derived,
        basics: null,
        commercial: commercialAnswers,
        surfaces: keys as WizardState["surfaces"],
        customer: { ...derived.customer!, propertyKind: "commercial", commercialSegment: commercialSeg.key },
        details: { ...derived.details, occupied: commercialAnswers.occ === "occ" ? "yes" : "no" },
      };
      setState(commercialDerived);
      void runSubmit(commercialDerived);
      return;
    }
    setState(derived);
    void runSubmit(derived);
  }

  function quickBack() {
    setError(null);
    if (page > 1) { setPage(page - 1); window.scrollTo({ top: 0 }); }
  }

  /**
   * C8 — open the Save & book sheet from wherever the customer is. The draft
   * is flushed FIRST with the screen tag, so the session the route marks
   * carries the resume point (`last_screen`) and nothing is inferred.
   */
  function openBook() {
    flushDraft(lastScreen);
    setBookOpen(true);
  }

  /** C8 — the "both" choice (prototype `s-both`): answer both, or book one visit for the lot. */
  function chooseBoth(how: "self" | "book") {
    setError(null);
    if (how === "book") { openBook(); return; }
    setPage(page + 1);
    window.scrollTo({ top: 0 });
  }

  // ---- render ---------------------------------------------------------------

  /** Why Continue is unavailable, kept apart from what it is unavailable FOR. */
  const nav = continueState({ uploading, sessionPhase });

  // Reveals route straight to /estimate/scope now (Tom, 28 Aug) — this
  // screen only renders the guardrail outcomes.
  if (screen === "editor" && isCustomer && outcome) {
    return <CustomerResult outcome={outcome} reveal={null} roomTypes={roomTypes} logoUrl={logoUrl} companyPhone={companyPhone} />;
  }

  /**
   * The guide range and its three doors (§3). Each door does exactly one
   * thing, and none of them is the "real" one:
   *   · tighten — the editor, which is the four rungs phases 4-5 built
   *   · book    — the reach-a-person flow the editor already owns
   *   · keep    — the email capture, which is where ⚑1's gate went. It asks
   *               in place rather than routing: sending them to another
   *               screen to give an address is the toll we just removed.
   */
  if (screen === "reveal" && reveal) {
    return (
      <div data-ready="1">
        <header className="wz-top">
          <Wordmark logoUrl={logoUrl} />
          <button type="button" className="wz-exit wz-book" onClick={() => setBookOpen(true)} data-testid="save-and-book-pill">Save &amp; book</button>
        </header>
        <SaveAndBookSheet
          open={bookOpen}
          onClose={() => setBookOpen(false)}
          phone={companyPhone}
          screen="reveal"
          estimateId={reveal.estimateId}
          prefill={{ email: prefill?.email ?? state.contact.email, phone: prefill?.phone ?? state.contact.phone, name: prefill?.name ?? state.contact.name }}
        />
        <Reveal
          payload={reveal.payload}
          quick={quick}
          outside={outside}
          commercial={reveal.payload.commercial && commercialSeg && commercialAnswers
            ? { segment: commercialSeg, answers: commercialAnswers, photos: reveal.payload.commercial.photos }
            : null}
          estimateId={reveal.estimateId}
          phone={companyPhone}
          onTighten={() => router.push(`/estimate/scope?id=${reveal.estimateId}`)}
          onBook={() => router.push(`/estimate/scope?id=${reveal.estimateId}#reach`)}
          prefillEmail={prefill?.email}
        />
      </div>
    );
  }

  return (
    // P1 (completed): the hydration gate the editors already had. Until React
    // hydrates, every chip and button is a live-looking dead control — a tap
    // in the first moments after load was silently lost. wz-waking turns off
    // pointer events so an early tap waits (and Playwright's actionability
    // check queues on it) instead of vanishing; data-ready is the spec hook.
    <div className={ready ? undefined : "wz-waking"} data-ready={ready ? "1" : undefined}>
      <header className="wz-top">
        <Wordmark logoUrl={logoUrl} />
        <div className="wz-dots">
          {Array.from({ length: lastPage }, (_, i) => i + 1).map((d) => (
            <i key={d} className={d < page || screen === "processing" ? "done" : d === page ? "on" : ""} />
          ))}
        </div>
        {/* C8 — Save & book in the header of every screen (prototype: every
            screen except the map). Leaving is never a dead end. */}
        {isCustomer && screen !== "processing" && (
          <button type="button" className="wz-exit wz-book" onClick={openBook} data-testid="save-and-book-pill">Save &amp; book</button>
        )}
        {!isCustomer && <a className="wz-exit" href="/estimates">Exit</a>}
      </header>
      {assisted && (
        <p className="wz-assisted" data-testid="assisted-banner">
          <b>Assisted session</b> — {assisted.who}&rsquo;s answers, picked up {assisted.screen ? `at ${assisted.screen.replace(/^quick:/, "").replace(/^page:/, "")}` : "where they left off"}. Nothing here changes their saved copy.
        </p>
      )}
      {isCustomer && (
        <SaveAndBookSheet
          open={bookOpen}
          onClose={() => setBookOpen(false)}
          phone={companyPhone}
          screen={lastScreen}
          estimateId={null}
          snapshot={{ state, page, lastPage }}
          prefill={{ email: prefill?.email ?? state.contact.email, phone: prefill?.phone ?? state.contact.phone, name: prefill?.name ?? state.contact.name }}
        />
      )}

      {screen === "processing" ? (
        // Tom, 31 Aug: something to WATCH while the AI works — live step
        // ticks, a moving bar, and a rotating line about what they're getting.
        <div className="wz-wrap wz-proc">
          <div className="wz-ring" />
          <div className="wz-psteps">
            {(briefBuilding ? [
              { at: 1, label: "Reading your description" },
              { at: 2, label: "Building the rooms and surfaces" },
              { at: 3, label: "Pricing every surface" },
            ] : [
              {
                at: 1,
                label: state.jobType === "exterior" ? "Looking over the outside"
                  : state.noPlan || state.planRunIds.length === 0 ? "Building the room list" : "Reading your floorplan",
              },
              {
                at: 2,
                label: state.jobType === "exterior" ? "Setting out the elevations"
                  : state.noPlan || state.planRunIds.length === 0 ? "Sizing rooms from typical dimensions" : "Measuring the rooms",
              },
              ...(state.details.damagePhotoCount > 0 ? [{ at: 2, label: "Analysing the damage photos" }] : []),
              { at: 3, label: "Pricing every surface" },
            ]).map((s, i) => (
              <p key={i} className={`wz-pstep ${procLine > s.at ? "done" : procLine >= s.at ? "on" : ""}`}>
                <i className="wz-pdot" aria-hidden>{procLine > s.at ? "✓" : ""}</i>
                {s.label}
              </p>
            ))}
          </div>
          <div className="wz-pbar" role="progressbar" aria-label="Building your estimate">
            <i style={{ width: `${Math.min(92, 14 + procLine * 26)}%` }} />
          </div>
          <p className="wz-ptip" key={procTip}>{PROC_TIPS[procTip % PROC_TIPS.length]}</p>
        </div>
      ) : (
        <div className="wz-wrap">
          {resumed && (
            <div className="wz-resume" data-testid="wz-resume">
              <span>Welcome back — {resumed}. Everything you answered is still here.</span>
              <button type="button" className="wz-linkish" onClick={startAgain} data-testid="wz-start-again">Start again</button>
            </div>
          )}
          {/* §3's quick look replaces the interior question pages for a
              customer. The pages themselves are untouched and still serve
              staff, the describe route and the upload route. */}
          {quickActive ? (
            <div className="wz-step" key={`quick-${quickStep}`}>
              {/* C12: the open-space photo rides the condition-photo upload —
                  it goes up with the submit and the estimator reviews it. */}
              <input
                ref={quickPhotoRef} type="file" hidden multiple accept="image/*" data-testid="com-photo-input"
                onChange={(e) => { addQuickPhotos([...(e.target.files ?? [])]); e.target.value = ""; }}
              />
              <QuickLook
                step={quickStep}
                quick={quick}
                onQuick={setQuick}
                stepNo={Math.min(page, quickSteps.length)}
                stepsTotal={quickSteps.length}
                error={error}
                canContinue={!nav.disabled}
                busy={uploading}
                onBack={page > 1 ? quickBack : null}
                onNext={quickNext}
                onBook={openBook}
                onChooseBoth={chooseBoth}
                phone={companyPhone}
                outside={outside}
                onOutside={setOutside}
                // C10 (v2.5): the condition free-text box is off the quick look —
                // the bands answer the question, and anything unusual is pointed
                // out per room with a photo on the tighten screen. The box still
                // serves the describe route.
                conditionBox={null}
                commercial={{
                  segments,
                  segmentKey: state.customer?.commercialSegment ?? null,
                  segment: commercialSeg,
                  onSegment: pickSegment,
                  answers: commercialAnswers,
                  onAnswers: setCommercial,
                  photoCount: state.details.damagePhotoCount,
                  onPhotos: () => quickPhotoRef.current?.click(),
                }}
                addressField={
                  <>
                    <AddressField
                      placeholder="Your address — start typing and pick it"
                      value={state.address ? state.address.formatted : quickAddress}
                      onText={(text) => set({ title: text, address: null })}
                      onPick={(a, inArea) => {
                        setQuickOutOfArea(inArea === false);
                        set({
                          title: a.formatted,
                          address: a,
                          customer: state.customer
                            ? { ...state.customer, suburb: a.suburb || state.customer.suburb, postcode: a.postcode || state.customer.postcode }
                            : state.customer,
                        });
                      }}
                    />
                    {/* The lookup degrades to a plain input when Places is
                        unavailable, and a job with no postcode reads as
                        OUTSIDE THE SERVICE AREA — a handoff caused by our
                        outage, not their address. These two appear only when
                        they have typed something the lookup did not resolve. */}
                    {(quickAddress.trim() !== "" || state.customer?.suburb.trim() || state.customer?.postcode.trim())
                      && !state.address && state.customer && (
                      <div className="wz-crow wz-quick-fallback">
                        <input
                          className="wz-in" placeholder="Suburb" value={state.customer.suburb}
                          onChange={(e) => set({ customer: { ...state.customer!, suburb: e.target.value } })}
                        />
                        <input
                          className="wz-in" placeholder="Postcode" value={state.customer.postcode} inputMode="numeric"
                          onChange={(e) => set({ customer: { ...state.customer!, postcode: e.target.value } })}
                        />
                      </div>
                    )}
                    {quickOutOfArea && (
                      <div className="wz-err">
                        That looks to be outside the areas we cover — send it anyway and we&rsquo;ll tell you honestly.
                      </div>
                    )}
                    {/* ⚑14 stands: nothing was demoted. The other two ways in
                        stay on the first screen — they are simply no longer a
                        toll gate in front of the price (§2.1). */}
                    <div className="wz-otherways" data-testid="wz-entry">
                      <span>Or start another way:</span>
                      <button type="button" className="wz-linkish" data-testid="entry-describe" onClick={() => chooseEntry("describe")}>
                        Describe it in your own words
                      </button>
                      <button type="button" className="wz-linkish" data-testid="entry-upload" onClick={() => chooseEntry("upload")}>
                        Upload a floorplan or listing
                      </button>
                    </div>
                  </>
                }
              />
            </div>
          ) : (
          <div className="wz-step" key={page}>
            {pageKey === "property" && (
              <PageProperty
                state={state} set={set} isCustomer={isCustomer} substrates={substrates} segments={segments}
                stepsTotal={lastPage}
                entry={entry} onEntry={chooseEntry} brief={brief} setBrief={setBrief} startChat={startChat} startingChat={startingChat} sessionPhase={sessionPhase}
                initialAddressText={state.title.trim() || intent?.addressText || ""}
                planFileCount={planFileCount} facadeFileCount={facadeFileCount}
                uploading={uploading}
                /* P1: a fast tap before anonymous sign-in completed got a
                   staff-only 403, so the controls still wait for the session —
                   but as a SEPARATE reason, so no label claims a file is
                   uploading when none was chosen (S0.3). */
                sessionBlocked={sessionPhase !== "ready"}
                planInputRef={planInputRef} facadeInputRef={facadeInputRef}
                onPlanFiles={uploadPlans} onFacadeFiles={uploadFacades}
                onImportListingPlan={importListingPlan}
              />
            )}
            {/* R2: the wizard BRANCHES at job type — a pure-exterior customer
                gets the exterior question set and never sees ceiling heights,
                interior door styles or the interior damage intake. */}
            {/* Tom, 31 Aug: contact details moved to the LAST page (below) —
                the questions come first, the name/phone/email is the final
                step before the AI builds the estimate. */}
            {pageKey === "house" && <PageExteriorHouse state={state} set={set} substrates={substrates} stepsTotal={lastPage} stepNo={page} />}
            {pageKey === "surfaces" && <PageSurfaces state={state} set={set} substrates={substrates} stepsTotal={lastPage} />}
            {pageKey === "scope" && <PageExteriorScope state={state} set={set} substrates={substrates} stepsTotal={lastPage} stepNo={page} />}
            {pageKey === "ext_condition" && (
              <PageExteriorCondition state={state} set={set} stepsTotal={lastPage} stepNo={page} />
            )}
            {pageKey === "details" && (
              <PageDetails state={state} set={set} isCustomer={isCustomer} stepsTotal={lastPage} stepNo={page} answered={answered} markAnswered={markAnswered} />
            )}
            {pageKey === "condition" && (
              <PageCondition
                state={state} set={set} substrates={substrates} stepsTotal={lastPage} stepNo={page} damageInputRef={damageInputRef}
                hasPlanRuns={state.planRunIds.length > 0}
                onDamageFiles={(files) => {
                  for (const f of files) {
                    const problem = checkUpload({ name: f.name, size: f.size, type: f.type }, "image");
                    if (problem) { setError(problem); return; }
                  }
                  setError(null);
                  damageFilesRef.current = [...damageFilesRef.current, ...files];
                  set({ details: { ...state.details, damagePhotoCount: state.details.damagePhotoCount + files.length } });
                }}
              />
            )}
            {/* C8: the paint picks are the office's job — never on the customer path. */}
            {pageKey === "extras" && <PageExteriorExtras state={state} set={set} stepsTotal={lastPage} stepNo={page} embedPaint={!isCustomer && !pageKeys.includes("contact")} />}
            {pageKey === "paint" && <PagePaint state={state} set={set} stepsTotal={lastPage} />}
            {pageKey === "contact" && <PageContact state={state} set={set} stepsTotal={lastPage} />}
            {uploadNote && <div className="wz-note">{uploadNote}</div>}
            {readIssueCount > 0 && (
              <div className="wz-note">
                {readIssueCount === 1 ? "One page" : `${readIssueCount} pages`} couldn&rsquo;t be read —
                we&rsquo;ll price what we can and flag the rest for a person to check.
              </div>
            )}
            {sessionSlow && sessionPhase === "connecting" && (
              <div className="wz-waiting">{SESSION_SLOW_TEXT}</div>
            )}
            {error && (
              <div className="wz-err">
                {error}
                {sessionPhase === "failed" && (
                  <button className="wz-linkish" onClick={retrySession}>
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {/* The quick look carries its OWN nav (its last button says "See my
          guide range", not "See my estimate"), so the page nav stands down. */}
      {screen === "pages" && !quickActive && (
        <nav className="wz-nav">
          <button className="wz-btn wz-bg" onClick={back} style={{ visibility: page > 1 ? "visible" : "hidden" }}>
            Back
          </button>
          <button className="wz-btn wz-bp" onClick={next} disabled={nav.disabled} title={nav.note ?? undefined}>
            {page === lastPage ? "See my estimate" : pageKeys[page] === "contact" ? "Nearly there" : "Continue"}
          </button>
          {/* S0.3: the honest reason, beside the button rather than inside a
              label that claims a file is going up when none was chosen. */}
          {nav.note && <span className="wz-navnote">{nav.note}</span>}
        </nav>
      )}
      {isCustomer && <ChatWidget ready={ready} />}
    </div>
  );
}

// ---- small shared controls --------------------------------------------------

function Seg<T extends string>({ options, value, onPick }: {
  options: Array<{ v: T; label: string }>;
  value: string | null;
  onPick: (v: T) => void;
}) {
  return (
    <div className="wz-seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? "on" : ""} onClick={() => onPick(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

// ---- page 1: the property ---------------------------------------------------

function PageProperty({
  state, set, isCustomer = false, substrates, stepsTotal, entry, onEntry, brief, setBrief, startChat, startingChat, sessionPhase, segments,
  planFileCount, facadeFileCount, uploading, sessionBlocked = false, planInputRef, facadeInputRef, onPlanFiles, onFacadeFiles, onImportListingPlan, initialAddressText = "",
}: {
  state: WizardState;
  set: (p: Partial<WizardState>) => void;
  isCustomer?: boolean;
  /** C12: the segment rows, for the commercial picker and its door. */
  segments: Segment[];
  stepsTotal: number;
  /** Phase 2 (6 Sep plan): the customer's way in — describe it, answer a
   * few questions, or upload the plan/listing. Staff keep the old layout. */
  entry: EntryChoice | null;
  onEntry: (e: EntryChoice) => void;
  brief: string;
  setBrief: (b: string) => void;
  startChat: (withBrief?: boolean) => void;
  startingChat: boolean;
  sessionPhase: SessionPhase;
  /** Homepage hand-off: what the visitor typed on the marketing site. */
  initialAddressText?: string;
  substrates: SubstrateGroups;
  planFileCount: number;
  facadeFileCount: number;
  /** A file the customer chose is going up. Labels may say so. */
  uploading: boolean;
  /** The session has not landed. Disables, but never reads as "Uploading…". */
  sessionBlocked?: boolean;
  planInputRef: React.RefObject<HTMLInputElement | null>;
  facadeInputRef: React.RefObject<HTMLInputElement | null>;
  onPlanFiles: (files: File[]) => void;
  onFacadeFiles: (files: File[]) => void;
  /** Read the floorplan off the pasted listing (interior jobs). */
  onImportListingPlan: () => void;
}) {
  const basics = state.basics;
  const isExterior = state.jobType === "exterior";
  const needsFacades = state.jobType !== "interior" && !state.listingUrl.trim();
  /** Both reasons disable the upload controls; only one may be spoken aloud. */
  const blocked = busyReason({ uploading, sessionPhase: sessionBlocked ? "connecting" : "ready" }) !== null;
  // A1: the customer's address line as typed (structured only once picked),
  // and the immediate service-area answer for the polite early message.
  const [addressText, setAddressText] = useState(initialAddressText);
  const [outOfArea, setOutOfArea] = useState(false);
  // Phase 2: a customer sees the controls of the way in they chose; staff see everything.
  // Read as they type: a matcher, not a model call, so it costs nothing and
  // can only notice words they actually wrote (lib/wizard/condition-brief.ts).
  const showListing = !isCustomer || entry === "upload";
  const showBasics = Boolean(state.noPlan && basics) && state.jobType !== "exterior" && (!isCustomer || entry === "questions");
  const showFacades = needsFacades && (!isCustomer || entry === "upload");

  const jobTypeSeg = (
    <Seg
      options={[
        { v: "interior" as const, label: "Interior" },
        { v: "exterior" as const, label: "Exterior" },
        { v: "both" as const, label: "Both" },
      ]}
      value={state.jobType}
      onPick={(v) => {
        if (v === state.jobType) return;
        // A2: the job type decides which substrate lists page 2 offers —
        // re-tick the defaults for the new type so an exterior job never
        // carries interior ticks (and vice versa). R2: pure exterior gets
        // the exterior question set; its answers drive the tick list.
        const ext = v === "exterior" ? (state.exterior ?? defaultExterior()) : state.exterior;
        set({
          jobType: v,
          exterior: v === "exterior" ? ext : v === "interior" ? null : state.exterior,
          surfaces: v === "exterior" && ext ? exteriorSurfaceKeys(ext) : defaultSurfacesFor(v, substrates),
          condition: { ...state.condition, darkToLightSurfaces: [] },
          // The chosen way in means the same thing for the new job type.
          ...(isCustomer && entry ? entryPatch(entry, v, v === "interior" ? null : ext, state.basics) : {}),
        });
      }}
    />
  );

  return (
    <>
      <p className="wz-kick">Step 1 of {stepsTotal} · The property</p>
      <h1>Let&rsquo;s look at the place</h1>
      {isCustomer && (
        <p className="wz-sub">About 90 seconds to your first range — and every answer can be changed afterwards.</p>
      )}

      {/* Tom, 29 Aug: "always ask for name, phone and email". Before anything
          else, because an estimate with no way to reach anyone can never join
          the customer record — which is how 15 of the first 25 ended up as an
          address with a price on it and nobody attached. */}
      {!isCustomer && (
        <div className="wz-contact">
          <p className="wz-qhead">Who is it for?</p>
          <div className="wz-crow">
            <input className="wz-field" placeholder="Name" value={state.contact.name}
              onChange={(e) => set({ contact: { ...state.contact, name: e.target.value } })} />
            <input className="wz-field" type="email" placeholder="Email" value={state.contact.email}
              onChange={(e) => set({ contact: { ...state.contact, email: e.target.value } })} />
            <input className="wz-field" placeholder="Phone" inputMode="tel" value={state.contact.phone}
              onChange={(e) => set({ contact: { ...state.contact, phone: e.target.value } })} />
          </div>
          <p className="wz-chint">
            All three, every time — it&rsquo;s what puts the job on their record instead of leaving it
            an address with a price on it.
          </p>
        </div>
      )}
      {!isCustomer && (
        <p className="wz-sub">
          {state.jobType === "exterior"
            ? <>Paste the real-estate listing if there is one — we&rsquo;ll read the photos and address. Or add two or three photos of the outside.</>
            : <>Paste the real-estate listing if there is one — we&rsquo;ll read the floorplan, photos and address. Or upload a floorplan photo.</>}
        </p>
      )}

      {!isCustomer && (
        // A1: the field captures the FULL job address (server-proxied Places,
        // AU + Melbourne bias). Tom's ruling 25 Aug: the job NAME is always
        // the first line of the job address — picking a suggestion stores the
        // structured address and names the job from its street line. Plain
        // typing still just works.
        <AddressField
          placeholder="Job address — start typing and pick it"
          value={state.address ? state.address.formatted : state.title}
          onText={(text) => set({ title: text, address: null })}
          onPick={(a) => set({
            title: a.street || a.formatted,
            address: a,
          })}
        />
      )}
      {isCustomer && state.customer && (
        <>
          <AddressField
            placeholder="Your address — start typing and pick it"
            value={state.address ? state.address.formatted : addressText}
            onText={(text) => { setAddressText(text); set({ address: null }); }}
            onPick={(a, inArea) => {
              setAddressText(a.formatted);
              setOutOfArea(inArea === false);
              set({
                address: a,
                customer: { ...state.customer!, suburb: a.suburb || state.customer!.suburb, postcode: a.postcode || state.customer!.postcode },
              });
            }}
          />
          {outOfArea && (
            <div className="wz-err">
              It looks like you&rsquo;re outside the area we currently service — we&rsquo;ll keep your
              details and let you know if that changes. You&rsquo;re welcome to continue anyway.
            </div>
          )}
        <div style={{ display: "flex", gap: 10 }}>
          <input
            className="wz-field" placeholder="Suburb" maxLength={80}
            value={state.customer.suburb}
            onChange={(e) => set({ customer: { ...state.customer!, suburb: e.target.value } })}
          />
          <input
            className="wz-field" placeholder="Postcode" inputMode="numeric" maxLength={10} style={{ maxWidth: 130 }}
            value={state.customer.postcode}
            onChange={(e) => set({ customer: { ...state.customer!, postcode: e.target.value } })}
          />
        </div>
        </>
      )}

      {/* Customers answer the three property questions BEFORE choosing a way
          in — the way in depends on the job type. Staff keep the old order. */}
      {isCustomer && (
        <>
          <p className="wz-qhead">What&rsquo;s being painted?</p>
          {jobTypeSeg}
        </>
      )}
      {isCustomer && state.customer && (
        <>
          <p className="wz-qhead">What kind of property?</p>
          <Seg
            options={[
              { v: "house" as const, label: "House" },
              { v: "townhouse" as const, label: "Townhouse" },
              { v: "unit_apartment" as const, label: "Unit / apartment" },
              { v: "commercial" as const, label: "Commercial" },
            ]}
            value={state.customer.propertyKind}
            onPick={(v) => set({ customer: { ...state.customer!, propertyKind: v } })}
          />
          {/* Tom, 8 Sep: commercial is not one thing. A few rooms or offices is
              priced here like any interior; a larger space or a strata /
              body-corporate building is seen by a person first — say so now,
              not at the end. */}
          {state.customer.propertyKind === "commercial" && (
            <>
              {/*
                Phase 7 (commercial pricing strategy): the SEGMENT question.
                One answer that selects the sector band, the substrate set and
                which gates matter. It REPLACES the 8 Sep "what sort of job"
                question for anyone answering it now; that answer stays in the
                state and in the ladder as the fallback for every session that
                predates this and for the assistant, which does not ask it.
              */}
              <p className="wz-qhead">What sort of place is it?</p>
              <Seg
                options={segmentTiles(segments).map((s) => ({ v: s.key, label: s.name }))}
                value={segmentByKey(segments, state.customer.commercialSegment)?.key ?? null}
                onPick={(v) => set({ customer: { ...state.customer!, commercialSegment: v } })}
              />
              {/* C12: the ROW decides the door — the seven gates are gone as a
                  wall. A range segment prices here (a person confirms); a brief
                  segment says so now, not at the end. */}
              {state.customer.commercialSegment != null && (() => {
                const routing = routeCommercial(state.customer!.commercialSegment, { segments, jobType: state.jobType });
                return routing.canPriceOnline ? (
                  <div className="wz-follow" data-testid="commercial-route-ok">
                    <p className="wz-q">Good — this kind of place prices online as a guide range. Keep going and you&rsquo;ll see a figure; one of us confirms it before anything is booked.</p>
                  </div>
                ) : (
                  <div className="wz-follow" data-testid="commercial-segment-stop">
                    <p className="wz-q">{gateMessage(routing)}</p>
                    <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>
                      Tell us the basics and how to reach you, and we&rsquo;ll book a time to come and look. No figure is shown online for this one.
                    </p>
                  </div>
                );
              })()}
              {state.customer.commercialSegment == null && state.customer.commercialKind === "small_interior" && (
                <div className="wz-follow" data-testid="commercial-small-note">
                  <p className="wz-q">Good — a few rooms or offices price the same way a home does. Keep going and you&rsquo;ll see a figure; one of us confirms it on site before anything is booked.</p>
                </div>
              )}
              {state.customer.commercialSegment == null && (state.customer.commercialKind === "large_interior" || state.customer.commercialKind === "strata") && (
                <div className="wz-follow" data-testid="commercial-visit-note">
                  <p className="wz-q">{state.customer.commercialKind === "strata"
                    ? "Strata and body-corporate work is priced on site — we\u2019ll need to see it."
                    : "A space that size is priced on site — we\u2019ll need to see it."}</p>
                  <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>
                    Tell us the basics and how to reach you, and we&rsquo;ll book a time to come and look. No figure is shown online for this one.
                  </p>
                </div>
              )}
            </>
          )}
          {/* Tom, 7 Sep: the heritage question is gone from page 1 — it is not a
              pricing input; heritageListed keeps its default and the policy
              treats it as "no". The assistant still asks it with the flags. */}
          {(state.customer.propertyKind === "unit_apartment" || state.customer.propertyKind === "townhouse") && (
            <>
              <p className="wz-qhead">Is there a body corporate / owners corporation?</p>
              <Seg
                options={[{ v: "no" as const, label: "No" }, { v: "yes" as const, label: "Yes" }, { v: "unsure" as const, label: "Not sure" }]}
                value={state.customer.bodyCorporate}
                onPick={(v) => set({ customer: { ...state.customer!, bodyCorporate: v } })}
              />
            </>
          )}
        </>
      )}

      {/*
        The three ways in — unchanged. What changed on 9 Sep (Tom, resolving
        ⚑14) is that "Describe it" is no longer the ONLY place a description
        belongs: the condition box below is additive, and appears on the other
        two routes as well.
        
        *"Floorplan plus describe it"* is a real combination and they were never
        alternatives — a plan says where the rooms are, a description says what
        state they are in, and no drawing has ever shown that. Making it
        additive is also what answers plan §2.1 without demoting anything: the
        route choice stays a fact about what the customer HAS, and the
        description stops depending on which card they happened to pick.
        
        The live chat bubble is untouched and unrelated — a direct line to the
        office (Tom, 8 Sep). Putting an AI feature behind it would mean tapping
        "talk to us" and getting a robot.
      */}
      {isCustomer && (
        <>
          <p className="wz-qhead">How would you like to do this?</p>
          <div className="wz-cards" data-testid="wz-entry">
            <button type="button" className={`wz-card ${entry === "describe" ? "on" : ""}`} onClick={() => onEntry("describe")} data-testid="entry-describe">
              <b>Describe it</b>
              <span>Type a few lines about the job — we build the whole estimate from them and you fine-tune it after.</span>
            </button>
            <button type="button" className={`wz-card ${entry === "questions" ? "on" : ""}`} onClick={() => onEntry("questions")} data-testid="entry-questions">
              <b>Answer a few questions</b>
              <span>{isExterior
                ? "No photos to hand? We size it from your answers and you confirm each side."
                : "There isn't a floorplan to hand — we size the rooms from typical dimensions and you confirm each one."}</span>
            </button>
            <button type="button" className={`wz-card ${entry === "upload" ? "on" : ""}`} onClick={() => onEntry("upload")} data-testid="entry-upload">
              <b>{isExterior ? "Add photos or the listing" : "Upload the floorplan or listing"}</b>
              <span>{isExterior
                ? "Two or three photos of the outside, or the real-estate listing — the most accurate start."
                : "Paste the real-estate listing or upload a floorplan photo — we read the rooms and sizes."}</span>
            </button>
          </div>
          <p className="wz-chint">
            Curious what similar homes cost? <Link href="/work" style={{ color: "var(--text)" }}>See real jobs and their prices →</Link>
          </p>
        </>
      )}

      {isCustomer && entry === "describe" && (
        <div className="wz-follow wz-alt" data-testid="describe-box">
          <p className="wz-q">Tell us about the job in your own words — rooms, what&rsquo;s being painted, the condition, anything unusual. One go is enough; you land in your estimate with every assumption marked.</p>
          <textarea className="wz-brief" data-testid="describe-job" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)}
            placeholder="e.g. 3 bedroom 1 bathroom house, colour match throughout, walls in good condition with a few minor cracks in the kitchen, all trims to be painted…" />
          <p className="wz-chint" style={{ marginTop: 8 }}>Tap Continue — your details come next, then we build the whole estimate from this.</p>
          <p style={{ marginTop: 8 }}>
            <button type="button" className="wz-linkbtn" data-testid="chat-it" disabled={sessionPhase !== "ready" || startingChat} onClick={() => startChat(false)}>
              {startingChat ? "Opening the assistant…" : "Prefer a back-and-forth? Chat it through instead →"}
            </button>
          </p>
        </div>
      )}

      {/*
        The condition box (⚑14) now lives in ConditionBox.tsx and on the quick
        look's condition screen, which is where it belongs — under "how's it
        looking?", extending that question instead of arriving beside an address
        field. It stays HERE for the UPLOAD route, which is the other way in
        that is not already a description.
      */}
      {isCustomer && entry === "upload" && (
        <ConditionBox
          brief={brief} setBrief={setBrief}
          heading="How&rsquo;s it looking?"
          sessionReady={sessionPhase === "ready"}
          startingChat={startingChat}
          onChat={() => startChat(false)}
        />
      )}

      {showListing && (
        <input
          className="wz-field"
          style={isCustomer ? { marginTop: 14 } : undefined}
          placeholder="Paste the listing URL — realestate.com.au or Domain"
          value={state.listingUrl}
          onChange={(e) => set({ listingUrl: e.target.value })}
        />
      )}
      {/* Tom, 31 Aug: an interior job can read the floorplan straight off the
          listing — one tap here instead of hunting for a file. */}
      {showListing && state.jobType !== "exterior" && state.listingUrl.trim() !== "" && state.planRunIds.length === 0 && !state.noPlan && (
        <button className="wz-upload" onClick={onImportListingPlan} disabled={blocked}>
          {uploading ? "Reading the listing…" : "📐 Read the floorplan from this listing"}
        </button>
      )}
      {/* R1.3: floorplans are an INTERIOR document — the exterior path has no
          floorplan field anywhere (a floorplan is a picture of the inside). */}
      {showListing && state.jobType !== "exterior" && (
        <>
          <div className="wz-or">OR</div>
          <input
            ref={planInputRef} type="file" hidden
            accept="image/*,application/pdf"
            onChange={(e) => { onPlanFiles([...(e.target.files ?? [])]); e.target.value = ""; }}
          />
          <button
            className={`wz-upload ${planFileCount ? "done" : ""}`}
            onClick={() => planInputRef.current?.click()}
            disabled={blocked}
          >
            {planUploadLabel({ planFileCount, uploading })}
          </button>
          {!isCustomer && (
            <button
              className="wz-linkish"
              onClick={() => set({
                noPlan: !state.noPlan,
                basics: !state.noPlan && !basics
                  ? { bedrooms: 3, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: false }
                  : state.basics,
              })}
            >
              {state.noPlan ? "✓ Using the quick basics instead — tap to undo" : "There isn't a floorplan to hand"}
            </button>
          )}
        </>
      )}

      {showBasics && basics && (
        <div className="wz-follow">
          <p className="wz-q">Not a problem — thirty seconds of basics instead.</p>
          <p className="wz-qhead" style={{ marginTop: 4 }}>Bedrooms</p>
          <Seg
            options={[
              { v: "1", label: "1" }, { v: "2", label: "2" }, { v: "3", label: "3" },
              { v: "4", label: "4" }, { v: "5", label: "5+" },
            ]}
            value={String(Math.min(basics.bedrooms, 5))}
            onPick={(v) => set({ basics: { ...basics, bedrooms: Number(v) } })}
          />
          <p className="wz-qhead">Storeys</p>
          <Seg
            options={[{ v: "single" as const, label: "Single" }, { v: "double" as const, label: "Double" }]}
            value={basics.storeys}
            onPick={(v) => set({ basics: { ...basics, storeys: v } })}
          />
          <p className="wz-qhead">Roughly how big? <small>— it sets the room sizes you&rsquo;ll confirm</small></p>
          <Seg
            options={[
              { v: "lt120" as const, label: "<120 m²" },
              { v: "s120_200" as const, label: "120–200" },
              { v: "gt200" as const, label: "200+" },
              { v: "unsure" as const, label: "Not sure" },
            ]}
            value={basics.sizeBand}
            onPick={(v) => set({ basics: { ...basics, sizeBand: v } })}
          />
          <p className="wz-qhead">Open-plan kitchen and living?</p>
          <Seg
            options={[{ v: "yes" as const, label: "Yes — one big space" }, { v: "no" as const, label: "No — separate rooms" }]}
            value={basics.openPlanKitchenLiving ? "yes" : "no"}
            onPick={(v) => set({ basics: { ...basics, openPlanKitchenLiving: v === "yes" } })}
          />
          {/* Phase 3 (6 Sep plan): the rooms the list used to assume away. */}
          <p className="wz-qhead">Bathrooms <small>— including the ensuite</small></p>
          <Seg
            options={[{ v: "1", label: "1" }, { v: "2", label: "2" }, { v: "3", label: "3+" }]}
            value={String(Math.min(basics.bathrooms ?? 1, 3))}
            onPick={(v) => set({ basics: { ...basics, bathrooms: Number(v) } })}
          />
          <p className="wz-qhead">Also being painted? <small>— tick any that apply</small></p>
          <div className="wz-chips" data-testid="basics-extras">
            {([["separateToilet", "Separate toilet"], ["garage", "Garage"], ["study", "Study"]] as const).map(([k, label]) => (
              <button key={k} type="button" className={`wz-chip ${basics[k] ? "on" : ""}`} onClick={() => set({ basics: { ...basics, [k]: !basics[k] } })}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {!isCustomer && (
        <>
          <p className="wz-qhead">What&rsquo;s being painted?</p>
          {jobTypeSeg}
        </>
      )}

      {showFacades && (
        <div className="wz-follow">
          <p className="wz-q">Exterior works best with two or three facade photos — the front and each visible side.{!isCustomer && <> No photos? You can build it from your answers instead.</>}</p>
          <input
            ref={facadeInputRef} type="file" hidden multiple accept="image/*"
            onChange={(e) => { onFacadeFiles([...(e.target.files ?? [])]); e.target.value = ""; }}
          />
          <button
            className={`wz-upload ${facadeFileCount >= 2 ? "done" : ""}`}
            onClick={() => facadeInputRef.current?.click()}
            disabled={blocked}
          >
            {facadeFileCount
              ? `✓ ${facadeFileCount} photo${facadeFileCount === 1 ? "" : "s"} added — add another?`
              : "📷 Add facade photos"}
          </button>
          {/* Tom, 31 Aug: exterior from scratch — no listing, no photos. The
              sides size from the answers and get confirmed one by one. Customers
              choose this as "Answer a few questions" above. */}
          {!isCustomer && facadeFileCount === 0 && (
            <button
              className="wz-linkish"
              onClick={() => {
                const ext = state.exterior ?? defaultExterior();
                set({ exterior: { ...ext, noPhotos: !ext.noPhotos } });
              }}
            >
              {state.exterior?.noPhotos
                ? "✓ No photos — we'll size it from your answers. Tap to undo"
                : "No photos to hand? We'll size it from your answers"}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ---- page 2: surfaces -------------------------------------------------------

function PageSurfaces({ state, set, substrates, stepsTotal }: {
  stepsTotal: number;
  state: WizardState;
  set: (p: Partial<WizardState>) => void;
  substrates: SubstrateGroups;
}) {
  const toggle = (k: WizardSurfaceKey) => {
    const on = state.surfaces.includes(k);
    const surfaces = on ? state.surfaces.filter((x) => x !== k) : [...state.surfaces, k];
    // Dark-to-light picks may only reference ticked surfaces.
    const darkToLightSurfaces = state.condition.darkToLightSurfaces.filter((x) => surfaces.includes(x));
    set({ surfaces, condition: { ...state.condition, darkToLightSurfaces } });
  };
  // A2: the offered lists follow the job type — data from the rate card,
  // never a list written into a component. "Both" shows the two as sections.
  const groups: Array<{ heading: string | null; options: SubstrateGroups["interior"] }> =
    state.jobType === "interior" ? [{ heading: null, options: substrates.interior }]
    : state.jobType === "exterior" ? [{ heading: null, options: substrates.exterior }]
    : [
        { heading: "Inside", options: substrates.interior },
        { heading: "Outside", options: substrates.exterior },
      ];
  return (
    <>
      <p className="wz-kick">Step 2 of {stepsTotal} · Surfaces</p>
      <h1>What&rsquo;s being painted?</h1>
      <p className="wz-sub">We&rsquo;ve pre-ticked the usual full repaint — untick anything that isn&rsquo;t being done.</p>
      {groups.map((g) => (
        <div key={g.heading ?? "all"}>
          {g.heading && <p className="wz-qhead">{g.heading}</p>}
          <div className="wz-tiles">
            {g.options.map((o) => (
              <button key={o.key} className={`wz-tile ${state.surfaces.includes(o.key) ? "on" : ""}`} onClick={() => toggle(o.key)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// ---- page 3: condition ------------------------------------------------------

function PageCondition({ state, set, substrates, stepsTotal, stepNo = 3, damageInputRef, hasPlanRuns, onDamageFiles }: {
  stepsTotal: number;
  stepNo?: number;
  state: WizardState;
  set: (p: Partial<WizardState>) => void;
  substrates: SubstrateGroups;
  damageInputRef: React.RefObject<HTMLInputElement | null>;
  hasPlanRuns: boolean;
  onDamageFiles: (files: File[]) => void;
}) {
  const labelFor = (k: WizardSurfaceKey) =>
    [...substrates.interior, ...substrates.exterior].find((o) => o.key === k)?.label ?? k;
  /**
   * COLOUR INTENT, not coats (estimator journey v2 §4.2, 9 Sep 2026).
   *
   * These cards used to say "1 COAT / 2 COATS / 3 COATS" and the line under
   * them said "this sets how many coats we allow for" — it did, for every
   * surface in the house at once. Coats differ BY SURFACE and a homeowner
   * cannot judge them, so the question is now the one they CAN answer, and
   * lib/pricing/systems.ts derives the coats per surface group from it.
   */
  const tiers = [
    { v: "fresh" as const, coats: "SAME", b: "The same colours again", s: "Colour-matched — a freshen up." },
    { v: "change" as const, coats: "NEW", b: "New colours", s: "New colours through the rooms we're painting." },
    { v: "dark_to_light" as const, coats: "BOLD", b: "Going much lighter, or a bold colour", s: "Covering a dark colour, or a strong accent." },
  ];
  const d = state.details;
  const damage = [
    { v: 0, b: "No damage", s: "Overall good condition." },
    { v: 1, b: "Only minor cracks or defects", s: "The usual hairline cracks and dings." },
    { v: 2, b: "Mostly minor, a few areas of concern", s: "Please attach photos of the worst areas." },
    { v: 3, b: "In real need of repair", s: "Please add photos and a short description." },
  ];
  return (
    <>
      <p className="wz-kick">Step {stepNo} of {stepsTotal} · Condition</p>
      <h1>Which describes it best?</h1>
      <p className="wz-sub">
        Colours first, then any damage. We work out the coats and the preparation for each surface from these two
        answers — you&rsquo;ll see exactly what we&rsquo;ve allowed for, and you can change any of it.
      </p>
      <div className="wz-cards">
        {tiers.map((t) => (
          <button
            key={t.v}
            className={`wz-card ${state.condition.tier === t.v ? "on" : ""}`}
            onClick={() => set({ condition: { ...state.condition, tier: t.v } })}
          >
            <span className="wz-coats">{t.coats}</span>
            <b>{t.b}</b>
            <span>{t.s}</span>
          </button>
        ))}
      </div>
      {state.condition.tier === "dark_to_light" && (
        <div className="wz-follow">
          <p className="wz-q">Which surfaces are going dark to light?</p>
          <div className="wz-chips">
            {state.surfaces.map((k) => {
              const on = state.condition.darkToLightSurfaces.includes(k);
              return (
                <button
                  key={k}
                  className={`wz-chip ${on ? "on" : ""}`}
                  onClick={() => set({
                    condition: {
                      ...state.condition,
                      darkToLightSurfaces: on
                        ? state.condition.darkToLightSurfaces.filter((x) => x !== k)
                        : [...state.condition.darkToLightSurfaces, k],
                    },
                  })}
                >
                  {labelFor(k)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Phase 2 (6 Sep plan): condition and damage are ONE page — coats and prep are the same question to a customer. */}
      <p className="wz-qhead">Any damage we should know about?</p>
      <div className="wz-cards">
        {damage.map((c) => (
          <button
            key={c.v}
            className={`wz-card ${d.damageTier === c.v ? "on" : ""}`}
            onClick={() => set({ details: { ...d, damageTier: c.v } })}
          >
            <b>{c.b}</b>
            <span>{c.s}</span>
          </button>
        ))}
      </div>
      {d.damageTier >= 2 && (
        <>
          {/* R1.3: condition photos are their own document type and NEVER
              require a floorplan — without a plan run they skip the defect
              reader and land with the estimator instead (said out loud, not
              silently). The old no-plan branch hid the input entirely while
              the customer gate still demanded photos: a dead end. */}
          <input
            ref={damageInputRef} type="file" hidden multiple accept="image/*"
            onChange={(e) => { onDamageFiles([...(e.target.files ?? [])]); e.target.value = ""; }}
          />
          <button
            className={`wz-photo-stub ${d.damagePhotoCount ? "done" : ""}`}
            onClick={() => damageInputRef.current?.click()}
          >
            {d.damagePhotoCount
              ? `✓ ${d.damagePhotoCount} photo${d.damagePhotoCount === 1 ? "" : "s"} attached — ${hasPlanRuns ? "they feed the defect reader, which prices the prep properly" : "your estimator reviews them with the estimate"}`
              : `📷 Attach photos of the worst areas — ${hasPlanRuns ? "they feed our defect reader, which prices the prep properly" : "your estimator reviews them with the estimate"}`}
          </button>
          <textarea
            className="wz-field"
            style={{ marginTop: 12, minHeight: 74 }}
            placeholder="A short description of the damage (helps whether or not there are photos)"
            value={d.damageNote}
            onChange={(e) => set({ details: { ...d, damageNote: e.target.value } })}
          />
        </>
      )}
    </>
  );
}

// ---- page 4: details --------------------------------------------------------

function PageDetails({ state, set, isCustomer = false, stepsTotal, stepNo = 4, answered, markAnswered }: {
  stepsTotal: number;
  stepNo?: number;
  answered: SafetyAnswered;
  markAnswered: (k: keyof SafetyAnswered) => void;
  state: WizardState;
  set: (p: Partial<WizardState>) => void;
  isCustomer?: boolean;
}) {
  const d = state.details;
  // Tom, 1 Sep: doors/windows unticked on page 2 answer their own "mostly"
  // question — Not applicable, auto-set; ticked, and an auto "na" backs off to
  // "Not sure". Manual picks always win over the backing-off default.
  const doorsTicked = state.surfaces.includes("doors");
  const windowsTicked = state.surfaces.includes("windows");
  useEffect(() => {
    const next: Partial<typeof d> = {};
    if (!doorsTicked && d.doorStyle !== "na") next.doorStyle = "na";
    if (doorsTicked && d.doorStyle === "na") next.doorStyle = "unsure";
    if (!windowsTicked && d.windowStyle !== "na") next.windowStyle = "na";
    if (windowsTicked && d.windowStyle === "na") next.windowStyle = "unsure";
    if (Object.keys(next).length) set({ details: { ...d, ...next } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doorsTicked, windowsTicked, d.doorStyle, d.windowStyle]);
  return (
    <>
      <p className="wz-kick">Step {stepNo} of {stepsTotal} · Details</p>
      <h1>A few quick details</h1>
      <p className="wz-sub">Pick what&rsquo;s closest — &ldquo;mostly&rdquo; is fine.</p>

      <p className="wz-qhead">What type of doors, mostly?</p>
      <div className="wz-pick">
        <button className={`wz-pk ${d.doorStyle === "panel" ? "on" : ""}`} onClick={() => set({ details: { ...d, doorStyle: "panel" } })}>
          <svg viewBox="0 0 60 64"><rect x="14" y="4" width="32" height="56" rx="2" fill="#1F262C" stroke="#39424B" /><rect x="19" y="9" width="10" height="16" fill="#12161A" stroke="#39424B" /><rect x="31" y="9" width="10" height="16" fill="#12161A" stroke="#39424B" /><rect x="19" y="29" width="10" height="26" fill="#12161A" stroke="#39424B" /><rect x="31" y="29" width="10" height="26" fill="#12161A" stroke="#39424B" /></svg>
          <small>Panel</small>
        </button>
        <button className={`wz-pk ${d.doorStyle === "flat" ? "on" : ""}`} onClick={() => set({ details: { ...d, doorStyle: "flat" } })}>
          <svg viewBox="0 0 60 64"><rect x="14" y="4" width="32" height="56" rx="2" fill="#1F262C" stroke="#39424B" /><circle cx="41" cy="33" r="1.8" fill="#8C959D" /></svg>
          <small>Flat</small>
        </button>
        <button className={`wz-pk ${d.doorStyle === "unsure" ? "on" : ""}`} onClick={() => set({ details: { ...d, doorStyle: "unsure" } })}>
          <svg viewBox="0 0 60 64"><rect x="14" y="4" width="32" height="56" rx="2" fill="#1F262C" stroke="#39424B" /><text x="30" y="40" textAnchor="middle" fill="#8C959D" fontSize="22">?</text></svg>
          <small>Not sure</small>
        </button>
        <button className={`wz-pk ${d.doorStyle === "na" ? "on" : ""}`} onClick={() => set({ details: { ...d, doorStyle: "na" } })}
          data-testid="door-style-na">
          <svg viewBox="0 0 60 64"><rect x="14" y="4" width="32" height="56" rx="2" fill="#1F262C" stroke="#39424B" /><line x1="20" y1="50" x2="40" y2="14" stroke="#8C959D" strokeWidth="2" /></svg>
          <small>Not applicable</small>
        </button>
      </div>
      {!doorsTicked && (
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>
          Doors aren&rsquo;t in your scope, so this is set to Not applicable.
        </p>
      )}

      {/* Tom, 21 Aug: the estimator only ever listed "doors" and quietly meant
          door-and-frame. The rate card prices all three, so ask — STAFF. C9
          strips it from the customer path: a customer cannot judge it, and the
          details screen asks only what a person can see. */}
      {!isCustomer && (
        <>
          <p className="wz-qhead">And what gets painted with each door?</p>
          <Seg
            options={[
              { v: "door" as const, label: "Door only" },
              { v: "frame" as const, label: "Door + frame" },
            ]}
            value={(d.doorScope ?? "frame") === "architrave" ? "frame" : (d.doorScope ?? "frame")}
            onPick={(v) => set({ details: { ...d, doorScope: v } })}
          />
        </>
      )}
      {/* C9 (⚑5, prototype `s-systems`): are the doors and skirtings shiny?
          Shiny old paint is oil-based enamel, which needs a bonding primer —
          one more labour coat the engine adds (lib/pricing/systems.ts). "Not
          sure" is priced as no and a person checks on site. */}
      {doorsTicked && (
        <>
          <p className="wz-qhead">Are the doors and skirtings shiny?</p>
          <Seg
            options={[
              { v: "yes" as const, label: "Shiny" },
              { v: "no" as const, label: "Flat" },
              { v: "unsure" as const, label: "Not sure" },
            ]}
            value={state.paint.trimsOilBased ?? "unsure"}
            onPick={(v) => set({ paint: { ...state.paint, trimsOilBased: v } })}
          />
          <p className="wz-chint">Shiny old paint needs an extra primer, so it&rsquo;s worth knowing. Not sure is fine — we check.</p>
        </>
      )}

      <p className="wz-qhead">Ceiling height <small>— approximate is fine</small></p>
      <Seg
        options={[
          { v: "2.4" as const, label: "2.4 m" },
          { v: "2.7" as const, label: "2.7 m" },
          { v: "3.0" as const, label: "3 m+" },
          { v: "unsure" as const, label: "Not sure" },
        ]}
        value={d.ceilingHeight}
        onPick={(v) => set({ details: { ...d, ceilingHeight: v } })}
      />

      <p className="wz-qhead">What type of windows, mostly?</p>
      <div className="wz-pick">
        <button className={`wz-pk ${d.windowStyle === "casement" ? "on" : ""}`} onClick={() => set({ details: { ...d, windowStyle: "casement" } })}>
          <svg viewBox="0 0 60 64"><rect x="10" y="8" width="40" height="48" fill="#12161A" stroke="#39424B" /><line x1="30" y1="8" x2="30" y2="56" stroke="#39424B" /><path d="M30 12 L46 32 L30 52" fill="none" stroke="#2F3941" strokeDasharray="3 2" /></svg>
          <small>Casement</small>
        </button>
        <button className={`wz-pk ${d.windowStyle === "sash" ? "on" : ""}`} onClick={() => set({ details: { ...d, windowStyle: "sash" } })}>
          <svg viewBox="0 0 60 64"><rect x="10" y="8" width="40" height="48" fill="#12161A" stroke="#39424B" /><rect x="13" y="11" width="34" height="20" fill="none" stroke="#39424B" /><rect x="13" y="33" width="34" height="20" fill="none" stroke="#39424B" /><line x1="10" y1="32" x2="50" y2="32" stroke="#4A555F" strokeWidth="2" /></svg>
          <small>Sash</small>
        </button>
        <button className={`wz-pk ${d.windowStyle === "colonial" ? "on" : ""}`} onClick={() => set({ details: { ...d, windowStyle: "colonial" } })}>
          <svg viewBox="0 0 60 64"><rect x="10" y="8" width="40" height="48" fill="#12161A" stroke="#39424B" /><line x1="30" y1="8" x2="30" y2="56" stroke="#39424B" /><line x1="10" y1="24" x2="50" y2="24" stroke="#39424B" /><line x1="10" y1="40" x2="50" y2="40" stroke="#39424B" /></svg>
          <small>Colonial</small>
        </button>
        <button className={`wz-pk ${d.windowStyle === "winder" ? "on" : ""}`} onClick={() => set({ details: { ...d, windowStyle: "winder" } })}>
          <svg viewBox="0 0 60 64"><rect x="10" y="8" width="40" height="48" fill="#12161A" stroke="#39424B" /><rect x="10" y="40" width="40" height="16" fill="#1A2027" stroke="#39424B" /><path d="M14 52 L30 43 L46 52" fill="none" stroke="#2F3941" strokeDasharray="3 2" /></svg>
          <small>Winder</small>
        </button>
        <button className={`wz-pk ${d.windowStyle === "unsure" ? "on" : ""}`} onClick={() => set({ details: { ...d, windowStyle: "unsure" } })}>
          <svg viewBox="0 0 60 64"><rect x="10" y="8" width="40" height="48" fill="#12161A" stroke="#39424B" /><text x="30" y="40" textAnchor="middle" fill="#8C959D" fontSize="22">?</text></svg>
          <small>Not sure</small>
        </button>
        <button className={`wz-pk ${d.windowStyle === "na" ? "on" : ""}`} onClick={() => set({ details: { ...d, windowStyle: "na" } })}
          data-testid="window-style-na">
          <svg viewBox="0 0 60 64"><rect x="10" y="8" width="40" height="48" fill="#12161A" stroke="#39424B" /><line x1="16" y1="50" x2="44" y2="14" stroke="#8C959D" strokeWidth="2" /></svg>
          <small>Not applicable</small>
        </button>
      </div>
      {!windowsTicked && (
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>
          Windows aren&rsquo;t in your scope, so this is set to Not applicable.
        </p>
      )}

      {/* Tom, 7 Sep (late): "built before 1970" is not asked anywhere in the
          wizard any more — the office finds the build year itself. The field
          stays "unsure" in the state; the policy no longer acts on "unsure". */}
      {/* Tom, 8 Sep: a commercial job is not asked about asbestos sheeting or
          whether anyone lives there — the site visit covers both. */}
      {isCustomer && state.customer && state.customer.propertyKind !== "commercial" && (
        <>
          <p className="wz-qhead">Any chance of asbestos sheeting in the areas being painted?</p>
          <Seg
            options={[{ v: "no" as const, label: "No" }, { v: "yes" as const, label: "Yes" }, { v: "unsure" as const, label: "Not sure" }]}
            value={answered.asbestos ? state.customer.asbestosSuspected : null}
            onPick={(v) => { markAnswered("asbestos"); set({ customer: { ...state.customer!, asbestosSuspected: v } }); }}
          />
        </>
      )}

      {/* Tom, 7 Sep: a lived-in home is set up and packed down every day —
          priced with the Staging modifier, and said out loud. */}
      {state.customer?.propertyKind !== "commercial" && (
        <>
          <p className="wz-qhead">Will anyone be living there while we paint?</p>
          <Seg
            options={[{ v: "no" as const, label: "No — it'll be empty" }, { v: "yes" as const, label: "Yes — we'll be living there" }]}
            value={d.occupied ?? null}
            onPick={(v) => set({ details: { ...d, occupied: v } })}
          />
        </>
      )}
      {d.occupied === "yes" && (
        <div className="wz-follow" data-testid="occupied-note">
          <p className="wz-q">That&rsquo;s fine — we set up and pack down each day, and it&rsquo;s allowed for.</p>
          <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>
            The price may still vary a little depending on whether our floor and furniture coverings can stay down
            between visits. We&rsquo;ll talk that through with you before anything is fixed.
          </p>
        </div>
      )}
    </>
  );
}

// ---- page 5: paint ----------------------------------------------------------

function PagePaint({ state, set, embedded = false, stepsTotal = 5 }: { state: WizardState; set: (p: Partial<WizardState>) => void; embedded?: boolean; stepsTotal?: number }) {
  const p = state.paint;
  // Tom, 7 Sep (late): the water/oil question (and its oil-trim follow-up)
  // is interior-only, never for a commercial property.
  const askBase = state.jobType !== "exterior" && state.customer?.propertyKind !== "commercial";
  // Tom, 1 Sep: five brands + Not sure. "Not sure" is exclusive — picking it
  // clears the brands, picking a brand clears it.
  const BRAND_LABEL = { dulux: "Dulux", haymes: "Haymes", taubmans: "Taubmans", porters: "Porters", wattyl: "Wattyl", unsure: "Not sure" } as const;
  const brand = (b: keyof typeof BRAND_LABEL) => (
    <button
      key={b}
      className={`wz-tile ${p.brands.includes(b) ? "on" : ""}`}
      data-testid={`brand-${b}`}
      onClick={() => set({
        paint: {
          ...p,
          brands: p.brands.includes(b)
            ? p.brands.filter((x) => x !== b)
            : b === "unsure" ? ["unsure"] : [...p.brands.filter((x) => x !== "unsure"), b],
        },
      })}
    >
      {BRAND_LABEL[b]}
    </button>
  );
  return (
    <>
      {!embedded && (
        <>
          <p className="wz-kick">Step 5 of {stepsTotal} · Paint &amp; colours</p>
          <h1>Paint and colours</h1>
          <p className="wz-sub">Tick anything that applies — perfectly fine to leave blank.</p>
        </>
      )}
      {embedded && <p className="wz-qhead" style={{ marginTop: 24 }}>Paint preferences <small style={{ color: "var(--muted)", fontWeight: 400 }}>— fine to leave blank</small></p>}
      <p className="wz-qhead">Which brand of paint would you like to use?</p>
      <div className="wz-tiles">
        {(["dulux", "haymes", "taubmans", "porters", "wattyl", "unsure"] as const).map(brand)}
      </div>

      {p.brands.length > 0 && (
        <div className="wz-follow">
          <p className="wz-q">Do you know which colours, or would you like some advice?</p>
          <div className="wz-chips">
            {([["known", "I know the colours"], ["advice", "Looking for advice"]] as const).map(([v, label]) => (
              <button
                key={v}
                className={`wz-chip ${p.colourHelp === v ? "on" : ""}`}
                onClick={() => set({ paint: { ...p, colourHelp: v } })}
              >
                {label}
              </button>
            ))}
          </div>
          {p.colourHelp === "advice" && (
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
              Perfect — we&rsquo;ll bring the fan decks. Our colour consultant can walk the home with you.
            </p>
          )}
          {p.colourHelp === "known" && (
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }} data-testid="test-pots-note">
              Great — please let us know if you would like any free test pots to try
              any of your colour choices.
            </p>
          )}
        </div>
      )}

      {/* Tom, 1 Sep: water vs oil is its own question. Picking "water" keeps
          the old waterBasedOnly flag in step, so the oil-trim prep follow-up
          and the merge deferrals behave exactly as before. */}
      {askBase && (
      <div className="wz-follow">
        <p className="wz-q">Are you wanting to paint using water based or oil based paints?</p>
        <div className="wz-chips">
          {([["water", "Water based"], ["oil", "Oil based"], ["unsure", "Not sure"]] as const).map(([v, label]) => (
            <button
              key={v}
              className={`wz-chip ${p.base === v ? "on" : ""}`}
              data-testid={`paint-base-${v}`}
              onClick={() => set({
                paint: {
                  ...p,
                  base: v,
                  waterBasedOnly: v === "water",
                  trimsOilBased: v === "water" ? (p.trimsOilBased ?? "unsure") : null,
                },
              })}
            >
              {label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
          If we are painting water based over oil based paint, extra coats and
          preparation will be required.
        </p>
      </div>
      )}

      {askBase && p.waterBasedOnly && (
        <div className="wz-follow">
          <p className="wz-q">Are the trims currently painted in oil-based enamel?</p>
          <div className="wz-chips">
            {([["yes", "Yes — oil-based"], ["no", "No — water-based"], ["unsure", "Not sure"]] as const).map(([v, label]) => (
              <button
                key={v}
                className={`wz-chip ${p.trimsOilBased === v ? "on" : ""}`}
                onClick={() => set({ paint: { ...p, trimsOilBased: v } })}
              >
                {label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
            If they&rsquo;re oil, switching to water-based needs extra preparation — we allow for it so there are no surprises.
          </p>
        </div>
      )}
    </>
  );
}

// ---- R2: the exterior question set (recovery plan §2, one-page instruction) --
// Pure-exterior jobs replace pages 2–5 with these. Every answer syncs
// state.surfaces through exteriorSurfaceKeys, so the merge, the scaffold and
// the editor all read the ONE tick list they always have.

function useExt(state: WizardState, set: (p: Partial<WizardState>) => void) {
  const ext = state.exterior ?? defaultExterior();
  const setExt = (p: Partial<WizardExterior>) => {
    const next = { ...ext, ...p };
    set({ exterior: next, surfaces: exteriorSurfaceKeys(next) });
  };
  return { ext, setExt };
}

/**
 * The customer's contact step — the LAST page, right before the AI builds
 * (Tom, 31 Aug: "name, phone and email needs to be one of the last questions
 * asked before the ai tool starts the search"). Trade and portal members
 * whose account already carries all three never see it.
 */
function PageContact({ state, set, stepsTotal }: { state: WizardState; set: (p: Partial<WizardState>) => void; stepsTotal: number }) {
  // Phase 2 (6 Sep plan): the paint preferences ride this page — they barely
  // move the price, so they stopped being a page of their own.
  const c = state.contact;
  return (
    <>
      <p className="wz-kick">Step {stepsTotal} of {stepsTotal} · Your details</p>
      <h1>Who should we send your estimate to?</h1>
      <p className="wz-sub">
        You&rsquo;ll see it on screen the moment it&rsquo;s built — this saves it to your email so
        you can come back, tweak it, and share it.
      </p>
      <div className="wz-crow">
        <input className="wz-field" placeholder="Your name" value={c.name}
          onChange={(e) => set({ contact: { ...c, name: e.target.value } })} />
        <input className="wz-field" type="email" placeholder="Email" value={c.email}
          onChange={(e) => set({ contact: { ...c, email: e.target.value } })} />
        <input className="wz-field" placeholder="Phone" inputMode="tel" value={c.phone}
          onChange={(e) => set({ contact: { ...c, phone: e.target.value } })} />
      </div>
      <p className="wz-chint">
        We use the phone only if there&rsquo;s something we can&rsquo;t work out from your answers.
        No spam, no obligation — and you can stop hearing from us in one click, any time.
      </p>
      {/* Tom, 7 Sep (item 4): requesting an estimate = agreeing to hear about THIS job. */}
      <p className="wz-chint wz-consent" data-testid="wizard-consent">
        By requesting your estimate you agree to receive messages about your project — the estimate itself, visit
        times, job updates and invoices — by email and text. You can change how we contact you any time in your account.
      </p>
      {/* C8: PagePaint used to ride this page. The contact page is customer-only,
          and the paint picks are derived by the office from the answers — a
          customer choosing sheens before seeing a price was the old flow's toll. */}
    </>
  );
}

function PageExteriorHouse({ state, set, substrates, stepsTotal, stepNo = 2 }: {
  stepsTotal: number; stepNo?: number; state: WizardState; set: (p: Partial<WizardState>) => void; substrates: SubstrateGroups;
}) {
  const { ext, setExt } = useExt(state, set);
  const house = ext.targets.includes("house");
  // A tick that cannot price is never offered: a cladding appears only once
  // its rate row exists on the active card (concrete 20261204, cement sheet
  // 20270128; stucco and Colorbond have had rows all along).
  const offers = (k: string) => substrates.exterior.some((o) => o.key === k);
  // Tom, 7 Sep: "What are we painting? tick all that apply" — the house and
  // the freestanding things. Each target keeps its own follow-up questions
  // (the next page) and its own line in the estimate.
  const setTargets = (targets: WizardExterior["targets"]) => setExt({
    targets,
    extras: {
      ...ext.extras,
      deck: targets.includes("deck"),
      fence: targets.includes("fence"),
      ...(targets.includes("fence") ? {} : { fenceMetres: null }),
    },
    shed: targets.includes("shed") ? (ext.shed ?? { substrate: "colorbond" }) : null,
    wall: targets.includes("wall") ? (ext.wall ?? { substrate: "brick", metres: null }) : null,
    floor: targets.includes("floor") ? (ext.floor ?? { m2: null }) : null,
    painting: { ...ext.painting, body: targets.includes("house") && !ext.substrates.includes("none") },
  });
  const target = (k: WizardExterior["targets"][number], label: string, sub?: string) => (
    <button
      key={k}
      className={`wz-tile ${ext.targets.includes(k) ? "on" : ""}`}
      data-testid={`ext-target-${k}`}
      onClick={() => setTargets(ext.targets.includes(k) ? ext.targets.filter((x) => x !== k) : [...ext.targets, k])}
    >
      {label}
      {sub && <span style={{ display: "block", fontSize: 12, color: "var(--muted)", fontWeight: 400 }}>{sub}</span>}
    </button>
  );
  // "None" is exclusive (no wall painting — trims only); everything else mixes.
  const setCladding = (next: WizardExterior["substrates"]) => setExt({
    substrates: next,
    painting: { ...ext.painting, body: next.length > 0 && !next.includes("none") },
  });
  const sub = (k: WizardExterior["substrates"][number], label: string) => (
    <button
      key={k}
      className={`wz-tile ${ext.substrates.includes(k) ? "on" : ""}`}
      data-testid={`ext-cladding-${k}`}
      onClick={() => {
        const has = ext.substrates.includes(k);
        if (k === "none") { setCladding(has ? [] : ["none"]); return; }
        setCladding(has ? ext.substrates.filter((x) => x !== k) : [...ext.substrates.filter((x) => x !== "none"), k]);
      }}
    >
      {label}
    </button>
  );
  // The trims, one tick each; the older `painting` summary stays in step so
  // the scaffold and every earlier reader see the same answer.
  const el = exteriorElements(ext);
  const setElements = (next: NonNullable<WizardExterior["elements"]>) => setExt({
    elements: next,
    painting: { body: ext.painting.body, windowsDoors: next.windows || next.doors, roofline: next.eaves || next.fascias || next.gutters, garage: next.garage },
  });
  const element = (k: keyof NonNullable<WizardExterior["elements"]>, label: string) => (
    <button key={k} className={`wz-tile ${el[k] ? "on" : ""}`} data-testid={`ext-element-${k}`} onClick={() => setElements({ ...el, [k]: !el[k] })}>
      {label}
    </button>
  );
  const sides = exteriorSides(ext);
  const allSides = sides.length === 4;
  const side = (k: "front" | "left" | "back" | "right", label: string) => (
    <button
      key={k}
      className={`wz-tile ${!allSides && sides.includes(k) ? "on" : ""}`}
      data-testid={`ext-side-${k}`}
      onClick={() => {
        const cur = allSides ? [] : sides;
        const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
        setExt({ sides: next.length === 0 || next.length === 4 ? undefined : next });
      }}
    >
      {label}
    </button>
  );
  return (
    <>
      <p className="wz-kick">Step {stepNo} of {stepsTotal} · What we&rsquo;re painting</p>
      <h1>What are we painting?</h1>
      <p className="wz-sub">Tick everything that applies — the house, and anything standing on its own.</p>
      <div className="wz-tiles" data-testid="ext-targets">
        {target("house", "The house", "walls, trims, roofline")}
        {target("fence", "Fence")}
        {target("floor", "Floor coatings")}
        {target("deck", "Deck")}
        {target("shed", "Garage / workshop / shed")}
        {target("wall", "Wall", "a boundary or retaining wall")}
      </div>

      {house && (
        <>
          <p className="wz-qhead">Single or double storey?</p>
          <div className="wz-pick">
            <button className={`wz-pk ${ext.storeys === "single" ? "on" : ""}`} onClick={() => setExt({ storeys: "single" })}>
              <svg viewBox="0 0 60 64"><polygon points="8,28 30,12 52,28" fill="#1F262C" stroke="#39424B" /><rect x="12" y="28" width="36" height="24" fill="#12161A" stroke="#39424B" /><rect x="26" y="38" width="8" height="14" fill="#152A31" stroke="#2FB9CB" /></svg>
              <small>Single storey</small>
              <em className="wz-pksub">up to 4 metres</em>
            </button>
            <button className={`wz-pk ${ext.storeys === "double" ? "on" : ""}`} onClick={() => setExt({ storeys: "double" })}>
              <svg viewBox="0 0 60 64"><polygon points="8,20 30,6 52,20" fill="#1F262C" stroke="#39424B" /><rect x="12" y="20" width="36" height="36" fill="#12161A" stroke="#39424B" /><line x1="12" y1="38" x2="48" y2="38" stroke="#39424B" /><rect x="26" y="44" width="8" height="12" fill="#152A31" stroke="#2FB9CB" /></svg>
              <small>Double storey</small>
              <em className="wz-pksub">over 4 metres</em>
            </button>
          </div>

          {/* Phase 3 (6 Sep plan): the footprint band scales the typical side lengths. */}
          <p className="wz-qhead">Roughly how big is the footprint? <small style={{ color: "var(--muted)", fontWeight: 400 }}>— the ground floor, near enough</small></p>
          <div className="wz-seg" data-testid="ext-size-band">
            {([["lt120", "<120 m²"], ["s120_200", "120–200"], ["gt200", "200+"], ["unsure", "Not sure"]] as const).map(([v, label]) => (
              <button key={v} type="button" className={ext.sizeBand === v ? "on" : ""} onClick={() => setExt({ sizeBand: v })}>{label}</button>
            ))}
          </div>

          <p className="wz-qhead">What&rsquo;s the house made of? <small style={{ color: "var(--muted)", fontWeight: 400 }}>— a mix? Tick everything that&rsquo;s there</small></p>
          <div className="wz-tiles" data-testid="ext-cladding">
            {sub("render", "Render")}
            {sub("weatherboards", "Weatherboards")}
            {sub("brick", "Brick")}
            {offers("stucco") && sub("stucco", "Stucco")}
            {offers("cement_sheet") && sub("cement_sheet", "Cement sheet")}
            {offers("colorbond") && sub("colorbond", "Colorbond")}
            {offers("concrete") && sub("concrete", "Tilt slab / concrete")}
            {sub("other", "Other")}
            {sub("none", "None — not painting the walls")}
          </div>
          {ext.substrates.includes("other") && (
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
              We&rsquo;ll price the walls as weatherboard for now and confirm the material with you before anything is fixed.
            </p>
          )}

          <p className="wz-qhead">Also being painted on the house? <small style={{ color: "var(--muted)", fontWeight: 400 }}>— tick all that apply</small></p>
          <div className="wz-tiles" data-testid="ext-elements">
            {element("windows", "Windows")}
            {element("doors", "Doors")}
            {element("eaves", "Eaves")}
            {element("fascias", "Fascias")}
            {element("gutters", "Gutters & downpipes")}
            {element("garage", "Garage door")}
          </div>

          <p className="wz-qhead">Where are we painting? <small style={{ color: "var(--muted)", fontWeight: 400 }}>— tick all that apply</small></p>
          <div className="wz-tiles" data-testid="ext-sides">
            <button className={`wz-tile ${allSides ? "on" : ""}`} data-testid="ext-side-all" onClick={() => setExt({ sides: undefined })}>The full exterior</button>
            {side("front", "Front")}
            {side("left", "Left side")}
            {side("back", "Back")}
            {side("right", "Right side")}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
            This seeds the side-by-side list you&rsquo;ll confirm in a moment — near enough is fine.
          </p>
        </>
      )}
    </>
  );
}

/** Tom, 7 Sep: the follow-ups for everything that isn't the house — fence
 * type and length, what the shed is made of, what the wall is made of. Shown
 * only when one of those was ticked. */
function PageExteriorScope({ state, set, substrates, stepsTotal, stepNo = 3 }: { state: WizardState; set: (p: Partial<WizardState>) => void; substrates: SubstrateGroups; stepsTotal: number; stepNo?: number }) {
  const { ext, setExt } = useExt(state, set);
  const offers = (k: string) => substrates.exterior.some((o) => o.key === k);
  const metresInput = (value: number | null, onChange: (v: number | null) => void, placeholder: string, testId: string) => (
    <input
      className="wz-field"
      style={{ maxWidth: 240 }}
      placeholder={placeholder}
      inputMode="decimal"
      data-testid={testId}
      defaultValue={value ?? ""}
      onBlur={(e) => {
        const v = e.target.value.trim().toLowerCase();
        const m = parseFloat(v.replace(/[^0-9.]/g, ""));
        onChange(v && !v.includes("not") && !isNaN(m) ? Math.min(2000, Math.max(1, m)) : null);
      }}
    />
  );
  const clad = <K extends string>(current: K, options: ReadonlyArray<readonly [K, string]>, pick: (v: K) => void, testId: string) => (
    <div className="wz-tiles" data-testid={testId}>
      {options.map(([v, label]) => (
        <button key={v} className={`wz-tile ${current === v ? "on" : ""}`} onClick={() => pick(v)}>{label}</button>
      ))}
    </div>
  );
  const shedOptions = ([
    ["colorbond", "Colorbond"], ["weatherboards", "Weatherboards"], ["render", "Render"], ["brick", "Brick"],
    ...(offers("stucco") ? [["stucco", "Stucco"] as const] : []),
    ...(offers("cement_sheet") ? [["cement_sheet", "Cement sheet"] as const] : []),
    ...(offers("concrete") ? [["concrete", "Tilt slab / concrete"] as const] : []),
    ["other", "Other"],
  ] as const) as ReadonlyArray<readonly [NonNullable<WizardExterior["shed"]>["substrate"], string]>;
  const wallOptions = ([
    ["brick", "Brick"], ["render", "Render"], ["colorbond", "Colorbond"],
    ...(offers("cement_sheet") ? [["cement_sheet", "Cement sheet"] as const] : []),
  ] as const) as ReadonlyArray<readonly [NonNullable<WizardExterior["wall"]>["substrate"], string]>;
  return (
    <>
      <p className="wz-kick">Step {stepNo} of {stepsTotal} · The rest of it</p>
      <h1>A little more on those</h1>
      <p className="wz-sub">Near enough is fine — we measure on the day.</p>

      {ext.targets.includes("fence") && (
        <div className="wz-follow" data-testid="ext-fence">
          <p className="wz-q">What kind of fence?</p>
          <div className="wz-seg">
            {([["paling", "Paling"], ["picket_hand", "Picket (brushed)"], ["picket_spray", "Picket (sprayed)"], ["metal", "Metal"]] as const).map(([v, label]) => (
              <button key={v} className={ext.extras.fenceType === v ? "on" : ""} onClick={() => setExt({ extras: { ...ext.extras, fenceType: v } })}>{label}</button>
            ))}
          </div>
          {ext.extras.fenceType === "metal" && (
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "8px 0 0" }}>A metal fence is priced by your estimator — it&rsquo;s noted on the estimate, not in the range.</p>
          )}
          <p className="wz-q" style={{ marginTop: 12 }}>Roughly how many metres of fence? &ldquo;Not sure&rdquo; is fine — we&rsquo;ll measure on the day.</p>
          {metresInput(ext.extras.fenceMetres, (v) => setExt({ extras: { ...ext.extras, fenceMetres: v == null ? null : Math.min(500, v) } }), "metres — or 'not sure'", "ext-fence-metres")}
        </div>
      )}

      {ext.targets.includes("shed") && (
        <div className="wz-follow" data-testid="ext-shed">
          <p className="wz-q">What&rsquo;s the garage / workshop / shed made of?</p>
          {clad(ext.shed?.substrate ?? "colorbond", shedOptions, (v) => setExt({ shed: { substrate: v } }), "ext-shed-cladding")}
        </div>
      )}

      {ext.targets.includes("wall") && (
        <div className="wz-follow" data-testid="ext-wall">
          <p className="wz-q">What&rsquo;s the wall made of?</p>
          {clad(ext.wall?.substrate ?? "brick", wallOptions, (v) => setExt({ wall: { substrate: v, metres: ext.wall?.metres ?? null } }), "ext-wall-cladding")}
          <p className="wz-q" style={{ marginTop: 12 }}>Roughly how long is it? &ldquo;Not sure&rdquo; is fine.</p>
          {metresInput(ext.wall?.metres ?? null, (v) => setExt({ wall: { substrate: ext.wall?.substrate ?? "brick", metres: v == null ? null : Math.min(500, v) } }), "metres — or 'not sure'", "ext-wall-metres")}
        </div>
      )}

      {ext.targets.includes("floor") && (
        <div className="wz-follow" data-testid="ext-floor">
          <p className="wz-q">Floor coatings — roughly how many square metres?</p>
          {metresInput(ext.floor?.m2 ?? null, (v) => setExt({ floor: { m2: v } }), "m² — or 'not sure'", "ext-floor-m2")}
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "8px 0 0" }}>Floor coatings are priced by your estimator — the product and preparation depend on the floor.</p>
        </div>
      )}

      {ext.targets.includes("deck") && (
        <div className="wz-follow" data-testid="ext-deck">
          <p className="wz-q">Deck — noted.</p>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>We oil or paint it to suit the timber; it&rsquo;s measured on the day and confirmed before your price is fixed.</p>
        </div>
      )}
    </>
  );
}

function PageExteriorCondition({ state, set, stepsTotal, stepNo = 4 }: {
  state: WizardState; set: (p: Partial<WizardState>) => void;
  stepsTotal: number; stepNo?: number;
}) {
  const { ext, setExt } = useExt(state, set);
  const cond = (v: NonNullable<WizardExterior["condition"]>, b: string, s: string) => (
    <button key={v} className={`wz-card ${ext.condition === v ? "on" : ""}`} onClick={() => setExt({ condition: v })}>
      <b>{b}</b><span>{s}</span>
    </button>
  );
  const gear = (v: WizardExterior["accessEquipment"][number], label: string) => (
    <button
      key={v}
      className={`wz-chip ${ext.accessEquipment.includes(v) ? "on" : ""}`}
      onClick={() => setExt({
        accessEquipment: ext.accessEquipment.includes(v)
          ? ext.accessEquipment.filter((x) => x !== v)
          : [...ext.accessEquipment, v],
      })}
    >
      {label}
    </button>
  );
  const acc = (v: WizardExterior["access"][number], label: string) => (
    <button
      key={v}
      className={`wz-chip ${ext.access.includes(v) ? "on" : ""}`}
      onClick={() => setExt({ access: ext.access.includes(v) ? ext.access.filter((x) => x !== v) : [...ext.access, v] })}
    >
      {label}
    </button>
  );
  return (
    <>
      <p className="wz-kick">Step {stepNo} of {stepsTotal} · Condition</p>
      <h1>How&rsquo;s it holding up?</h1>
      <p className="wz-sub">Honest is best — it sets the preparation we allow for.</p>

      <p className="wz-qhead">How&rsquo;s the paintwork holding up?</p>
      <div className="wz-cards">
        {cond("good", "Good overall", "Sound paint, the odd mark — a repaint, not a rescue.")}
        {cond("weathered", "Weathered", "Chalky or faded in places — extra preparation allowed for.")}
        {cond("peeling", "Peeling & flaking", "Coming away in places — needs a proper look before a fixed price.")}
      </div>

      {/* Tom, 7 Sep (late): the "built before 1970" question is gone — the office finds the build year itself. */}
      <p className="wz-qhead">Anything tricky about access? <small style={{ color: "var(--muted)", fontWeight: 400 }}>— tick any that apply</small></p>
      <div className="wz-chips">
        {acc("steep", "Steep block")}
        {acc("tight", "Tight side access")}
        {acc("high", "Double-height entry")}
        <button
          className={`wz-chip ${ext.access.length === 0 ? "on" : ""}`}
          onClick={() => setExt({ access: [] })}
        >
          None of these ✓
        </button>
      </div>

      {/* Tom, 29 Aug: the gear question — and the promise that goes with it.
          Hire, delivery and setup of access equipment are NOT priced here;
          the estimator confirms them with the customer. */}
      <p className="wz-qhead">Any special access equipment required? <small style={{ color: "var(--muted)", fontWeight: 400 }}>— tick any that apply</small></p>
      <div className="wz-chips">
        {gear("scissor_lift", "Scissor lift")}
        {gear("boom_lift", "Boom lift")}
        {gear("scaffold", "Scaffold / platform")}
        <button
          className={`wz-chip ${ext.accessEquipment.length === 0 ? "on" : ""}`}
          onClick={() => setExt({ accessEquipment: [] })}
        >
          None needed ✓
        </button>
      </div>
      {ext.accessEquipment.length > 0 && (
        <div className="wz-follow">
          <p className="wz-q">No access equipment costs are included in this estimate.</p>
          <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>
            Hire, delivery and set-up of {gearPhrase(ext.accessEquipment)} sit outside the price you&rsquo;ll see
            here — your estimator will confirm what&rsquo;s needed, and what it costs, with you.
          </p>
        </div>
      )}
    </>
  );
}

/** "a scissor lift and a scaffold / platform" — the ticked gear, read aloud. */
function gearPhrase(keys: WizardExterior["accessEquipment"]): string {
  const names = keys.map((k) => GEAR_LABEL[k].toLowerCase());
  if (names.length === 1) return `a ${names[0]}`;
  return `a ${names.slice(0, -1).join(", a ")} and a ${names[names.length - 1]}`;
}

const GEAR_LABEL: Record<WizardExterior["accessEquipment"][number], string> = {
  scissor_lift: "Scissor lift",
  boom_lift: "Boom lift",
  scaffold: "Scaffold / platform",
};

function PageExteriorExtras({ state, set, stepsTotal, stepNo = 5, embedPaint = true }: { state: WizardState; set: (p: Partial<WizardState>) => void; stepsTotal: number; stepNo?: number; embedPaint?: boolean }) {
  const { ext, setExt } = useExt(state, set);
  // Tom, 7 Sep: deck and fence are answered on "What are we painting?" now;
  // this page keeps the things that are easy to forget.
  const extra = (k: "pergola" | "balustrade", label: string) => (
    <button
      key={k}
      className={`wz-tile ${ext.extras[k] ? "on" : ""}`}
      onClick={() => setExt({ extras: { ...ext.extras, [k]: !ext.extras[k] } })}
    >
      {label}
    </button>
  );
  return (
    <>
      <p className="wz-kick">Step {stepNo} of {stepsTotal} · {embedPaint ? <>Extras &amp; paint</> : "Extras"}</p>
      <h1>Anything else out there?</h1>
      <p className="wz-sub">The things that are easy to forget.</p>
      <div className="wz-tiles">
        {extra("pergola", "Pergola")}
        {extra("balustrade", "Balustrades & hand rails")}
      </div>
      {embedPaint && <PagePaint state={state} set={set} embedded stepsTotal={stepsTotal} />}
    </>
  );
}
