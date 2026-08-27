"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { checkUpload } from "@/lib/uploads/validate";
import {
  defaultCustomer,
  defaultExterior,
  defaultWizardState,
  exteriorSurfaceKeys,
  pageForPath,
  type WizardExterior,
  type WizardState,
  type WizardSurfaceKey,
} from "@/lib/wizard/state";
import { defaultSurfacesFor, type SubstrateGroups } from "@/lib/estimate/substrates";
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
import CustomerResult, { type CustomerOutcome } from "./CustomerResult";
import Wordmark from "./Wordmark";

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

type Screen = "pages" | "processing" | "editor";

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

export default function WizardApp({ roomTypes, substrates, mode = "internal", prefill, prefillState, logoUrl }: {
  roomTypes: string[];
  /** A2: the offered surface lists, derived server-side from the rate card. */
  substrates: SubstrateGroups;
  mode?: "internal" | "customer";
  /** The Settings logo (logo 1) for the header — wordmark when unset. */
  logoUrl?: string | null;
  /** 3a-6: a signed-in portal customer arrives known — email from their
   * verified session (the gate page disappears), address from the chosen
   * property. Same component, same flow; a returning customer just starts
   * closer to a price. */
  prefill?: {
    email: string;
    address: { street: string; suburb: string; state: string; postcode: string; formatted: string } | null;
  };
  /** 3a-7: one-tap rebook (§6 W3) — a prior job's SANITISED wizard answers
   * as the starting point, so the walk only asks what's changed. The server
   * strips file/run references before it hands this over. */
  prefillState?: WizardState;
}) {
  const [state, setState] = useState<WizardState>(() => {
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
          },
          address: prefill?.address ?? seed.address,
        }
      : seed;
    return prefillState
      ? base // the rebook keeps the prior job's chosen surfaces
      : { ...base, surfaces: defaultSurfacesFor(base.jobType, substrates) };
  });
  const [page, setPage] = useState(1);
  const [screen, setScreen] = useState<Screen>("pages");
  const isCustomer = mode === "customer";
  // The email gate exists to capture identity — a signed-in customer already
  // proved theirs, so the page simply isn't there for them.
  const lastPage = isCustomer && !prefill?.email ? 6 : 5;
  const [outcome, setOutcome] = useState<CustomerOutcome | null>(null);
  const [customerResult, setCustomerResult] = useState<(CustomerPayload & { estimateId: string; planUrl: string | null; photoWarnings?: string[] }) | null>(null);

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

  async function runSubmit() {
    setScreen("processing");
    setError(null);
    try {
      await runSubmitInner();
    } catch {
      // A dropped connection must never strand the customer on the spinner -
      // their answers are all still in state, so send them back to retry.
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

  async function runSubmitInner() {
    setProcLine(1);
    // 1. Let every background read finish.
    await Promise.all(readsRef.current);
    setProcLine(2);
    // 2. Damage photos feed the defect reader on the primary run.
    const photoIssues = await analyseDamagePhotos();
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
    const submitState = {
      ...state,
      planRunIds: footprintRunId ? [...state.planRunIds, footprintRunId] : state.planRunIds,
      conditionSourceIds: conditionSourceIdsRef.current,
    };
    const res = await fetch("/api/wizard/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: submitState }),
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
      // R1.3: photo-analysis failures reach the CUSTOMER too — they used to
      // be attached on the staff branch only, so a customer whose photos
      // failed was told nothing at all.
      setCustomerResult({
        ...(j as CustomerPayload & { estimateId: string; planUrl: string | null }),
        photoWarnings: photoIssues,
      });
      setScreen("editor");
      return;
    }
    // Tom (20 Aug): staff land in the NEW confirm-loop editor — the same
    // view the customer gets (R1.1 parity), replacing the old W3 internal
    // editor screen. Margin and deep surgery stay in /quote; photo issues
    // ride the estimate as review deferrals either way.
    const landed = j as SubmitResult;
    router.push(`/estimate/scope?id=${landed.estimateId}`);
  }

  // ---- client-side page gates (server re-validates everything) --------------

  function pageBlocker(): string | null {
    if (page === 1) {
      const wantsInterior = state.jobType !== "exterior";
      if (isCustomer && (!state.customer || state.customer.suburb.trim() === "" || state.customer.postcode.trim() === "")) {
        return "Where's the property? Suburb and postcode, please.";
      }
      if (wantsInterior && !state.noPlan && state.planRunIds.length === 0) {
        return "Upload a floorplan, or choose the quick basics instead.";
      }
      if (state.noPlan && !state.basics) return "A couple of basics first, please.";
      if (state.jobType !== "interior" && !state.listingUrl.trim() && state.facadeRunIds.length < 2) {
        return "Exterior needs the listing, or two to three facade photos — front and each visible side.";
      }
    }
    if (page === 6 && isCustomer) {
      const email = state.customer?.email.trim() ?? "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "A valid email, so your estimate has somewhere to live.";
    }
    // R2: the exterior pages' own gates.
    if (state.jobType === "exterior") {
      const ext = state.exterior;
      if (page === 2 && (ext?.substrates.length ?? 0) === 0) return "What's the house made of? Tick at least one.";
      if (page === 3 && ext && !Object.values(ext.painting).some(Boolean)) return "Tick at least one thing we're painting.";
      if (page === 4 && ext?.condition == null) return "How's the paintwork holding up?";
      return null;
    }
    if (page === 2 && state.surfaces.length === 0) return "Tick at least one surface.";
    if (page === 3 && state.condition.tier === "dark_to_light" && state.condition.darkToLightSurfaces.length === 0) {
      return "Which surfaces are going dark to light?";
    }
    if (page === 4 && state.details.damageTier >= 2 && state.details.damagePhotoCount === 0) {
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
    void runSubmit();
  }

  function back() {
    setError(null);
    if (page > 1) { setPage(page - 1); window.scrollTo({ top: 0 }); }
  }

  // ---- render ---------------------------------------------------------------

  /** Why Continue is unavailable, kept apart from what it is unavailable FOR. */
  const nav = continueState({ uploading, sessionPhase });

  if (screen === "editor" && isCustomer && (outcome || customerResult)) {
    return <CustomerResult outcome={outcome} reveal={customerResult} roomTypes={roomTypes} logoUrl={logoUrl} />;
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
        {!isCustomer && <a className="wz-exit" href="/estimates">Exit</a>}
      </header>

      {screen === "processing" ? (
        <div className="wz-wrap wz-proc">
          <div className="wz-ring" />
          <p className={`wz-ln ${procLine >= 1 ? "on" : ""}`}>
            {state.jobType === "exterior" ? "LOOKING OVER THE OUTSIDE…"
              : state.noPlan || state.planRunIds.length === 0 ? "BUILDING THE ROOM LIST…" : "READING YOUR FLOORPLAN…"}
          </p>
          <p className={`wz-ln ${procLine >= 2 ? "on" : ""}`}>
            {state.jobType === "exterior" ? "SETTING OUT THE ELEVATIONS…"
              : state.noPlan || state.planRunIds.length === 0 ? "SIZING ROOMS FROM TYPICAL DIMENSIONS…" : "MEASURING THE ROOMS…"}
          </p>
          {state.details.damagePhotoCount > 0 && (
            <p className={`wz-ln ${procLine >= 2 ? "on" : ""}`}>ANALYSING THE DAMAGE PHOTOS…</p>
          )}
          <p className={`wz-ln ${procLine >= 3 ? "on" : ""}`}>PRICING EVERY SURFACE…</p>
        </div>
      ) : (
        <div className="wz-wrap">
          <div className="wz-step" key={page}>
            {page === 1 && (
              <PageProperty
                state={state} set={set} isCustomer={isCustomer} substrates={substrates}
                planFileCount={planFileCount} facadeFileCount={facadeFileCount}
                uploading={uploading}
                /* P1: a fast tap before anonymous sign-in completed got a
                   staff-only 403, so the controls still wait for the session —
                   but as a SEPARATE reason, so no label claims a file is
                   uploading when none was chosen (S0.3). */
                sessionBlocked={sessionPhase !== "ready"}
                planInputRef={planInputRef} facadeInputRef={facadeInputRef}
                onPlanFiles={uploadPlans} onFacadeFiles={uploadFacades}
              />
            )}
            {/* R2: the wizard BRANCHES at job type — a pure-exterior customer
                gets the exterior question set and never sees ceiling heights,
                interior door styles or the interior damage intake. */}
            {page === 2 && (state.jobType === "exterior"
              ? <PageExteriorHouse state={state} set={set} />
              : <PageSurfaces state={state} set={set} substrates={substrates} />)}
            {page === 3 && (state.jobType === "exterior"
              ? <PageExteriorScope state={state} set={set} />
              : <PageCondition state={state} set={set} substrates={substrates} />)}
            {page === 4 && state.jobType === "exterior" && (
              <PageExteriorCondition state={state} set={set} isCustomer={isCustomer} />
            )}
            {page === 4 && state.jobType !== "exterior" && (
              <PageDetails
                state={state} set={set} damageInputRef={damageInputRef} isCustomer={isCustomer}
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
            {page === 5 && (state.jobType === "exterior"
              ? <PageExteriorExtras state={state} set={set} />
              : <PagePaint state={state} set={set} />)}
            {page === 6 && isCustomer && state.customer && (
              <>
                <p className="wz-kick">One last thing</p>
                <h1>Where should we send your estimate?</h1>
                <p className="wz-sub">You&rsquo;ll see it on screen right now — this saves it so you can come back, tweak it, and share it.</p>
                <input
                  className="wz-field" type="email" placeholder="you@email.com"
                  value={state.customer.email}
                  onChange={(e) => set({ customer: { ...state.customer!, email: e.target.value } })}
                />
                <p style={{ fontSize: 12.5, color: "var(--muted)" }}>No spam, no obligation. Opt out any time.</p>
              </>
            )}
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
        </div>
      )}

      {screen === "pages" && (
        <nav className="wz-nav">
          <button className="wz-btn wz-bg" onClick={back} style={{ visibility: page > 1 ? "visible" : "hidden" }}>
            Back
          </button>
          <button className="wz-btn wz-bp" onClick={next} disabled={nav.disabled} title={nav.note ?? undefined}>
            {page === lastPage ? "See my estimate" : page === 5 && isCustomer ? "Nearly there" : "Continue"}
          </button>
          {/* S0.3: the honest reason, beside the button rather than inside a
              label that claims a file is going up when none was chosen. */}
          {nav.note && <span className="wz-navnote">{nav.note}</span>}
        </nav>
      )}
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
  state, set, isCustomer = false, substrates, planFileCount, facadeFileCount, uploading, sessionBlocked = false, planInputRef, facadeInputRef, onPlanFiles, onFacadeFiles,
}: {
  state: WizardState;
  set: (p: Partial<WizardState>) => void;
  isCustomer?: boolean;
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
}) {
  const basics = state.basics;
  const needsFacades = state.jobType !== "interior" && !state.listingUrl.trim();
  /** Both reasons disable the upload controls; only one may be spoken aloud. */
  const blocked = busyReason({ uploading, sessionPhase: sessionBlocked ? "connecting" : "ready" }) !== null;
  // A1: the customer's address line as typed (structured only once picked),
  // and the immediate service-area answer for the polite early message.
  const [addressText, setAddressText] = useState("");
  const [outOfArea, setOutOfArea] = useState(false);
  return (
    <>
      <p className="wz-kick">Step 1 of 5 · The property</p>
      <h1>Let&rsquo;s look at the place</h1>
      <p className="wz-sub">
        {state.jobType === "exterior"
          ? <>Paste the real-estate listing if there is one — we&rsquo;ll read the photos and address. Or add two or three photos of the outside.</>
          : <>Paste the real-estate listing if there is one — we&rsquo;ll read the floorplan, photos and address. Or upload a floorplan photo.</>}
      </p>

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
      <input
        className="wz-field"
        placeholder="Paste the listing URL — realestate.com.au or Domain"
        value={state.listingUrl}
        onChange={(e) => set({ listingUrl: e.target.value })}
      />
      {/* R1.3: floorplans are an INTERIOR document — the exterior path has no
          floorplan field anywhere (a floorplan is a picture of the inside). */}
      {state.jobType !== "exterior" && (
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
        </>
      )}

      {state.noPlan && basics && (
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
          <p className="wz-qhead">Roughly how big?</p>
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
        </div>
      )}

      <p className="wz-qhead">What&rsquo;s being painted?</p>
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
          });
        }}
      />

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
          <p className="wz-qhead">Heritage listed? <small>— many period homes aren&rsquo;t</small></p>
          <Seg
            options={[{ v: "no" as const, label: "No" }, { v: "yes" as const, label: "Yes" }, { v: "unsure" as const, label: "Not sure" }]}
            value={state.customer.heritageListed}
            onPick={(v) => set({ customer: { ...state.customer!, heritageListed: v } })}
          />
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

      {needsFacades && (
        <div className="wz-follow">
          <p className="wz-q">Exterior without a listing needs two or three facade photos — the front and each visible side.</p>
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
        </div>
      )}
    </>
  );
}

// ---- page 2: surfaces -------------------------------------------------------

function PageSurfaces({ state, set, substrates }: {
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
      <p className="wz-kick">Step 2 of 5 · Surfaces</p>
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

function PageCondition({ state, set, substrates }: {
  state: WizardState;
  set: (p: Partial<WizardState>) => void;
  substrates: SubstrateGroups;
}) {
  const labelFor = (k: WizardSurfaceKey) =>
    [...substrates.interior, ...substrates.exterior].find((o) => o.key === k)?.label ?? k;
  const tiers = [
    { v: "fresh" as const, coats: "1 COAT", b: "Freshen up", s: "Same colours, colour-matched — one coat brings it back to life." },
    { v: "change" as const, coats: "2 COATS", b: "Change of colour", s: "New colours throughout — generally two coats to all surfaces." },
    { v: "dark_to_light" as const, coats: "3 COATS", b: "Dark to light", s: "Covering dark colours or stains — usually three coats to cover properly." },
  ];
  return (
    <>
      <p className="wz-kick">Step 3 of 5 · Condition</p>
      <h1>Which describes it best?</h1>
      <p className="wz-sub">This sets how many coats we allow for.</p>
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
    </>
  );
}

// ---- page 4: details --------------------------------------------------------

function PageDetails({ state, set, damageInputRef, hasPlanRuns, isCustomer = false, onDamageFiles }: {
  state: WizardState;
  set: (p: Partial<WizardState>) => void;
  damageInputRef: React.RefObject<HTMLInputElement | null>;
  hasPlanRuns: boolean;
  isCustomer?: boolean;
  onDamageFiles: (files: File[]) => void;
}) {
  const d = state.details;
  const damage = [
    { v: 0, b: "No damage", s: "Overall good condition." },
    { v: 1, b: "Only minor cracks or defects", s: "The usual hairline cracks and dings." },
    { v: 2, b: "Mostly minor, a few areas of concern", s: "Please attach photos of the worst areas." },
    { v: 3, b: "In real need of repair", s: "Please add photos and a short description." },
  ];
  return (
    <>
      <p className="wz-kick">Step 4 of 5 · Details</p>
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
      </div>

      {/* Tom, 21 Aug: the estimator only ever listed "doors" and quietly meant
          door-and-frame. The rate card prices all three, so ask. */}
      <p className="wz-qhead">And what gets painted with each door?</p>
      <Seg
        options={[
          { v: "door" as const, label: "Door only" },
          { v: "frame" as const, label: "Door + frame" },
          { v: "architrave" as const, label: "+ architrave" },
        ]}
        value={d.doorScope ?? "frame"}
        onPick={(v) => set({ details: { ...d, doorScope: v } })}
      />

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
      </div>

      {isCustomer && state.customer && (
        <>
          <p className="wz-qhead">Was the home built before 1970? <small>— older paint can contain lead, and we handle it properly</small></p>
          <Seg
            options={[{ v: "no" as const, label: "No" }, { v: "yes" as const, label: "Yes" }, { v: "unsure" as const, label: "Not sure" }]}
            value={state.customer.builtPre1970}
            onPick={(v) => set({ customer: { ...state.customer!, builtPre1970: v } })}
          />
          <p className="wz-qhead">Any chance of asbestos sheeting in the areas being painted?</p>
          <Seg
            options={[{ v: "no" as const, label: "No" }, { v: "yes" as const, label: "Yes" }, { v: "unsure" as const, label: "Not sure" }]}
            value={state.customer.asbestosSuspected}
            onPick={(v) => set({ customer: { ...state.customer!, asbestosSuspected: v } })}
          />
        </>
      )}

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

// ---- page 5: paint ----------------------------------------------------------

function PagePaint({ state, set, embedded = false }: { state: WizardState; set: (p: Partial<WizardState>) => void; embedded?: boolean }) {
  const p = state.paint;
  const brand = (b: "dulux" | "haymes" | "taubmans") => (
    <button
      key={b}
      className={`wz-tile ${p.brands.includes(b) ? "on" : ""}`}
      onClick={() => set({
        paint: { ...p, brands: p.brands.includes(b) ? p.brands.filter((x) => x !== b) : [...p.brands, b] },
      })}
    >
      {b[0].toUpperCase() + b.slice(1)}
    </button>
  );
  return (
    <>
      {!embedded && (
        <>
          <p className="wz-kick">Step 5 of 5 · Paint &amp; colours</p>
          <h1>Paint and colours</h1>
          <p className="wz-sub">Tick anything that applies — perfectly fine to leave blank.</p>
        </>
      )}
      {embedded && <p className="wz-qhead" style={{ marginTop: 24 }}>Paint preferences <small style={{ color: "var(--muted)", fontWeight: 400 }}>— fine to leave blank</small></p>}
      <div className="wz-tiles">
        {(["dulux", "haymes", "taubmans"] as const).map(brand)}
        <button
          className={`wz-tile ${p.waterBasedOnly ? "on" : ""}`}
          onClick={() => set({
            paint: { ...p, waterBasedOnly: !p.waterBasedOnly, trimsOilBased: !p.waterBasedOnly ? (p.trimsOilBased ?? "unsure") : null },
          })}
        >
          Water-based only
        </button>
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
        </div>
      )}
      {p.waterBasedOnly && (
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

function PageExteriorHouse({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const { ext, setExt } = useExt(state, set);
  const sub = (k: "weatherboards" | "render" | "brick", label: string) => (
    <button
      key={k}
      className={`wz-tile ${ext.substrates.includes(k) ? "on" : ""}`}
      onClick={() => {
        const has = ext.substrates.includes(k);
        const substrates = has ? ext.substrates.filter((x) => x !== k) : [...ext.substrates, k];
        setExt({ substrates });
      }}
    >
      {label}
    </button>
  );
  return (
    <>
      <p className="wz-kick">Step 2 of 5 · The house</p>
      <h1>Let&rsquo;s size up the outside</h1>
      <p className="wz-sub">Two quick looks — how tall, and what it&rsquo;s made of.</p>

      <p className="wz-qhead">Single or double storey?</p>
      <div className="wz-pick">
        <button className={`wz-pk ${ext.storeys === "single" ? "on" : ""}`} onClick={() => setExt({ storeys: "single" })}>
          <svg viewBox="0 0 60 64"><polygon points="8,28 30,12 52,28" fill="#1F262C" stroke="#39424B" /><rect x="12" y="28" width="36" height="24" fill="#12161A" stroke="#39424B" /><rect x="26" y="38" width="8" height="14" fill="#152A31" stroke="#2FB9CB" /></svg>
          <small>Single storey</small>
        </button>
        <button className={`wz-pk ${ext.storeys === "double" ? "on" : ""}`} onClick={() => setExt({ storeys: "double" })}>
          <svg viewBox="0 0 60 64"><polygon points="8,20 30,6 52,20" fill="#1F262C" stroke="#39424B" /><rect x="12" y="20" width="36" height="36" fill="#12161A" stroke="#39424B" /><line x1="12" y1="38" x2="48" y2="38" stroke="#39424B" /><rect x="26" y="44" width="8" height="12" fill="#152A31" stroke="#2FB9CB" /></svg>
          <small>Double storey</small>
        </button>
      </div>

      <p className="wz-qhead">What&rsquo;s the house made of? <small style={{ color: "var(--muted)", fontWeight: 400 }}>— a mix? Tick everything that&rsquo;s there</small></p>
      <div className="wz-tiles">
        {sub("weatherboards", "Weatherboard")}
        {sub("render", "Render")}
        {sub("brick", "Painted brick")}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
        This seeds the wall list you&rsquo;ll confirm side by side in a moment — near enough is fine.
      </p>
    </>
  );
}

function PageExteriorScope({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const { ext, setExt } = useExt(state, set);
  const tile = (k: keyof WizardExterior["painting"], label: string, sub?: string) => (
    <button
      key={k}
      className={`wz-tile ${ext.painting[k] ? "on" : ""}`}
      onClick={() => setExt({ painting: { ...ext.painting, [k]: !ext.painting[k] } })}
      style={{ textAlign: "left" }}
    >
      {label}
      {sub && <span style={{ display: "block", fontSize: 12, color: "var(--muted)", fontWeight: 400 }}>{sub}</span>}
    </button>
  );
  return (
    <>
      <p className="wz-kick">Step 3 of 5 · The scope</p>
      <h1>What are we painting?</h1>
      <p className="wz-sub">The usual full exterior is pre-ticked — untick anything that isn&rsquo;t being done. You&rsquo;ll choose the sides in a moment.</p>
      <div className="wz-tiles">
        {tile("body", "The body — the walls")}
        {tile("windowsDoors", "Windows & doors")}
        {tile("roofline", "The roofline", "fascias, gutters, eaves & downpipes")}
        {tile("garage", "Garage door")}
      </div>
    </>
  );
}

function PageExteriorCondition({ state, set, isCustomer }: {
  state: WizardState; set: (p: Partial<WizardState>) => void; isCustomer: boolean;
}) {
  const { ext, setExt } = useExt(state, set);
  const cond = (v: NonNullable<WizardExterior["condition"]>, b: string, s: string) => (
    <button key={v} className={`wz-card ${ext.condition === v ? "on" : ""}`} onClick={() => setExt({ condition: v })}>
      <b>{b}</b><span>{s}</span>
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
      <p className="wz-kick">Step 4 of 5 · Condition</p>
      <h1>How&rsquo;s it holding up?</h1>
      <p className="wz-sub">Honest is best — it sets the preparation we allow for.</p>

      <p className="wz-qhead">How&rsquo;s the paintwork holding up?</p>
      <div className="wz-cards">
        {cond("good", "Good overall", "Sound paint, the odd mark — a repaint, not a rescue.")}
        {cond("weathered", "Weathered", "Chalky or faded in places — extra preparation allowed for.")}
        {cond("peeling", "Peeling & flaking", "Coming away in places — needs a proper look before a fixed price.")}
      </div>

      {isCustomer && state.customer && (
        <>
          <p className="wz-qhead">Was the home built before 1970? <small>— older paint can contain lead, and we handle it properly</small></p>
          <Seg
            options={[
              { v: "yes" as const, label: "Yes" },
              { v: "no" as const, label: "No" },
              { v: "unsure" as const, label: "Not sure" },
            ]}
            value={state.customer.builtPre1970}
            onPick={(v) => set({ customer: { ...state.customer!, builtPre1970: v } })}
          />
        </>
      )}

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
    </>
  );
}

function PageExteriorExtras({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const { ext, setExt } = useExt(state, set);
  const extra = (k: "deck" | "fence" | "pergola" | "balustrade", label: string) => (
    <button
      key={k}
      className={`wz-tile ${ext.extras[k] ? "on" : ""}`}
      onClick={() => setExt({ extras: { ...ext.extras, [k]: !ext.extras[k], ...(k === "fence" && ext.extras.fence ? { fenceMetres: null } : {}) } })}
    >
      {label}
    </button>
  );
  return (
    <>
      <p className="wz-kick">Step 5 of 5 · Extras &amp; paint</p>
      <h1>Anything else out there?</h1>
      <p className="wz-sub">The freestanding things — not on a wall, easy to forget.</p>
      <div className="wz-tiles">
        {extra("deck", "Deck (oil)")}
        {extra("fence", "Fence")}
        {extra("pergola", "Pergola")}
        {extra("balustrade", "Balustrades & hand rails")}
      </div>
      {ext.extras.fence && (
        <div className="wz-follow">
          <p className="wz-q">Roughly how many metres of fence? &ldquo;Not sure&rdquo; is fine — we&rsquo;ll measure on the day.</p>
          <input
            className="wz-field"
            style={{ maxWidth: 240 }}
            placeholder="metres — or 'not sure'"
            inputMode="decimal"
            defaultValue={ext.extras.fenceMetres ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim().toLowerCase();
              const m = parseFloat(v.replace(/[^0-9.]/g, ""));
              setExt({ extras: { ...ext.extras, fenceMetres: v && !v.includes("not") && !isNaN(m) ? Math.min(500, Math.max(1, m)) : null } });
            }}
          />
        </div>
      )}
      <PagePaint state={state} set={set} embedded />
    </>
  );
}
