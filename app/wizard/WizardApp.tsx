"use client";

import { useEffect, useRef, useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  defaultCustomer,
  defaultWizardState,
  pageForPath,
  WIZARD_SURFACE_KEYS,
  type WizardState,
  type WizardSurfaceKey,
} from "@/lib/wizard/state";
import type { CustomerPayload, WizardEditorPayload } from "@/lib/wizard/view";
import Editor from "./Editor";
import CustomerResult, { type CustomerOutcome } from "./CustomerResult";

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

const SURFACE_LABELS: Record<WizardSurfaceKey, string> = {
  walls: "Walls",
  ceilings: "Ceilings",
  cornices: "Cornices",
  doors: "Doors",
  architraves: "Architraves",
  skirting: "Skirting boards",
  windows: "Windows",
  staircase: "Staircase",
};

type Screen = "pages" | "processing" | "editor";

type SubmitResult = WizardEditorPayload & {
  estimateId: string;
  openAt: string;
  planUrl: string | null;
  skipped: Array<{ name: string; reason: string }>;
  warnings: string[];
};

export default function WizardApp({ roomTypes, mode = "internal" }: { roomTypes: string[]; mode?: "internal" | "customer" }) {
  const [state, setState] = useState<WizardState>(() =>
    mode === "customer"
      ? { ...defaultWizardState(), mode: "customer", customer: defaultCustomer() }
      : defaultWizardState(),
  );
  const [page, setPage] = useState(1);
  const [screen, setScreen] = useState<Screen>("pages");
  const isCustomer = mode === "customer";
  const lastPage = isCustomer ? 6 : 5; // customers get the email gate
  const [outcome, setOutcome] = useState<CustomerOutcome | null>(null);
  const [customerResult, setCustomerResult] = useState<(CustomerPayload & { estimateId: string; planUrl: string | null }) | null>(null);

  // A customer needs an identity before they can upload or submit —
  // an anonymous Supabase session, promoted to an account if they save.
  const [sessionReady, setSessionReady] = useState(!isCustomer);
  const [error, setError] = useState<string | null>(null);
  const [procLine, setProcLine] = useState(0);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [planFileCount, setPlanFileCount] = useState(0);
  const [facadeFileCount, setFacadeFileCount] = useState(0);
  const [uploading, setUploading] = useState(false);

  /** Reads fired in the background; the processing screen awaits them. */
  const readsRef = useRef<Array<Promise<unknown>>>([]);
  const primaryRunRef = useRef<string | null>(null);
  const damageFilesRef = useRef<File[]>([]);
  const planInputRef = useRef<HTMLInputElement>(null);
  const facadeInputRef = useRef<HTMLInputElement>(null);
  const damageInputRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));

  useEffect(() => {
    if (!isCustomer) return;
    const supabase = createBrowserClient();
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) { setSessionReady(true); return; }
      const { error: signInError } = await supabase.auth.signInAnonymously();
      if (!signInError) setSessionReady(true);
      else setError("The estimate wizard isn't available just now — please try again shortly, or give us a call.");
    });
  }, [isCustomer]);

  // ---- page-1 uploads -------------------------------------------------------

  async function uploadPlans(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of files.slice(0, 5)) fd.append("file", f);
      const res = await fetch("/api/extract/floorplan?kind=floorplan", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "The upload didn't work — try again."); return; }
      const ids: string[] = j.runIds ?? [];
      if (!primaryRunRef.current) primaryRunRef.current = j.primaryRunId ?? ids[0] ?? null;
      // Kick every page's read off now, in the background.
      for (const runId of ids) {
        readsRef.current.push(
          fetch(`/api/extract/${runId}/read`, { method: "POST" }).catch(() => null),
        );
      }
      setState((s) => ({ ...s, planRunIds: [...s.planRunIds, ...ids], noPlan: false }));
      setPlanFileCount((n) => n + files.length);
    } finally {
      setUploading(false);
    }
  }

  async function uploadFacades(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of files.slice(0, 5)) fd.append("file", f);
      const res = await fetch("/api/extract/floorplan?kind=elevation", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "The photos didn't upload — try again."); return; }
      const ids: string[] = j.runIds ?? [];
      // E2: each facade starts its elevation read in the background, same as
      // plan pages — the envelope assembles from whatever has finished.
      for (const runId of ids) {
        readsRef.current.push(
          fetch(`/api/extract/${runId}/read`, { method: "POST" }).catch(() => null),
        );
      }
      setState((s) => ({ ...s, facadeRunIds: [...s.facadeRunIds, ...ids] }));
      setFacadeFileCount((n) => n + files.length);
    } finally {
      setUploading(false);
    }
  }

  // ---- submit ---------------------------------------------------------------

  async function runSubmit() {
    setScreen("processing");
    setError(null);
    setProcLine(1);
    // 1. Let every background read finish.
    await Promise.all(readsRef.current);
    setProcLine(2);
    // 2. Damage photos feed the defect reader on the primary run.
    if (damageFilesRef.current.length && primaryRunRef.current) {
      const fd = new FormData();
      for (const f of damageFilesRef.current.slice(0, 12)) fd.append("file", f);
      await fetch(`/api/extract/${primaryRunRef.current}/photos`, { method: "POST", body: fd }).catch(() => null);
    }
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
    // 4. The submit rebuilds, merges, prices and scores server-side. With no
    // plan run there is nowhere for damage photos to have gone — say so
    // rather than letting the count suppress the review deferral (the server
    // independently checks the readings for real defect observations).
    const submitState = {
      ...state,
      planRunIds: footprintRunId ? [...state.planRunIds, footprintRunId] : state.planRunIds,
      details: primaryRunRef.current ? state.details : { ...state.details, damagePhotoCount: 0 },
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
      setCustomerResult(j as CustomerPayload & { estimateId: string; planUrl: string | null });
      setScreen("editor");
      return;
    }
    setResult(j as SubmitResult);
    setScreen("editor");
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
    if (page === 2 && state.surfaces.length === 0) return "Tick at least one surface.";
    if (page === 3 && state.condition.tier === "dark_to_light" && state.condition.darkToLightSurfaces.length === 0) {
      return "Which surfaces are going dark to light?";
    }
    if (page === 4 && state.details.damageTier >= 2
      && state.details.damagePhotoCount === 0 && state.details.damageNote.trim() === "") {
      return "Damage at this level needs photos, or a short description.";
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

  if (screen === "editor" && result) {
    return <Editor initial={result} roomTypes={roomTypes} />;
  }
  if (screen === "editor" && isCustomer && (outcome || customerResult)) {
    return <CustomerResult outcome={outcome} reveal={customerResult} roomTypes={roomTypes} />;
  }

  return (
    <>
      <header className="wz-top">
        <div className="wz-wm">PAINT<span>—</span>GROUP</div>
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
            {state.noPlan || state.planRunIds.length === 0 ? "BUILDING THE ROOM LIST…" : "READING THE FLOORPLAN…"}
          </p>
          <p className={`wz-ln ${procLine >= 2 ? "on" : ""}`}>
            {state.noPlan || state.planRunIds.length === 0 ? "SIZING ROOMS FROM TYPICAL DIMENSIONS…" : "MEASURING THE ROOMS…"}
          </p>
          <p className={`wz-ln ${procLine >= 3 ? "on" : ""}`}>PRICING EVERY SURFACE…</p>
        </div>
      ) : (
        <div className="wz-wrap">
          <div className="wz-step" key={page}>
            {page === 1 && (
              <PageProperty
                state={state} set={set} isCustomer={isCustomer}
                planFileCount={planFileCount} facadeFileCount={facadeFileCount} uploading={uploading}
                planInputRef={planInputRef} facadeInputRef={facadeInputRef}
                onPlanFiles={uploadPlans} onFacadeFiles={uploadFacades}
              />
            )}
            {page === 2 && <PageSurfaces state={state} set={set} />}
            {page === 3 && <PageCondition state={state} set={set} />}
            {page === 4 && (
              <PageDetails
                state={state} set={set} damageInputRef={damageInputRef} isCustomer={isCustomer}
                hasPlanRuns={state.planRunIds.length > 0}
                onDamageFiles={(files) => {
                  damageFilesRef.current = [...damageFilesRef.current, ...files];
                  set({ details: { ...state.details, damagePhotoCount: state.details.damagePhotoCount + files.length } });
                }}
              />
            )}
            {page === 5 && <PagePaint state={state} set={set} />}
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
            {error && <div className="wz-err">{error}</div>}
          </div>
        </div>
      )}

      {screen === "pages" && (
        <nav className="wz-nav">
          <button className="wz-btn wz-bg" onClick={back} style={{ visibility: page > 1 ? "visible" : "hidden" }}>
            Back
          </button>
          <button className="wz-btn wz-bp" onClick={next} disabled={uploading || !sessionReady}>
            {page === lastPage ? "See my estimate" : page === 5 && isCustomer ? "Nearly there" : "Continue"}
          </button>
        </nav>
      )}
    </>
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
  state, set, isCustomer = false, planFileCount, facadeFileCount, uploading, planInputRef, facadeInputRef, onPlanFiles, onFacadeFiles,
}: {
  state: WizardState;
  set: (p: Partial<WizardState>) => void;
  isCustomer?: boolean;
  planFileCount: number;
  facadeFileCount: number;
  uploading: boolean;
  planInputRef: React.RefObject<HTMLInputElement | null>;
  facadeInputRef: React.RefObject<HTMLInputElement | null>;
  onPlanFiles: (files: File[]) => void;
  onFacadeFiles: (files: File[]) => void;
}) {
  const basics = state.basics;
  const needsFacades = state.jobType !== "interior" && !state.listingUrl.trim();
  return (
    <>
      <p className="wz-kick">Step 1 of 5 · The property</p>
      <h1>Let&rsquo;s look at the place</h1>
      <p className="wz-sub">
        Paste the real-estate listing if there is one — we&rsquo;ll read the floorplan, photos and address.
        Or upload a floorplan photo.
      </p>

      {!isCustomer && (
        <input
          className="wz-field"
          placeholder="Job name or address (shows on the estimates list)"
          value={state.title}
          onChange={(e) => set({ title: e.target.value })}
        />
      )}
      {isCustomer && state.customer && (
        <div style={{ display: "flex", gap: 10 }}>
          <input
            className="wz-field" placeholder="Suburb"
            value={state.customer.suburb}
            onChange={(e) => set({ customer: { ...state.customer!, suburb: e.target.value } })}
          />
          <input
            className="wz-field" placeholder="Postcode" inputMode="numeric" style={{ maxWidth: 130 }}
            value={state.customer.postcode}
            onChange={(e) => set({ customer: { ...state.customer!, postcode: e.target.value } })}
          />
        </div>
      )}
      <input
        className="wz-field"
        placeholder="Paste the listing URL — realestate.com.au or Domain"
        value={state.listingUrl}
        onChange={(e) => set({ listingUrl: e.target.value })}
      />
      <div className="wz-or">OR</div>
      <input
        ref={planInputRef} type="file" hidden multiple
        accept="image/*,application/pdf"
        onChange={(e) => { onPlanFiles([...(e.target.files ?? [])]); e.target.value = ""; }}
      />
      <button
        className={`wz-upload ${planFileCount ? "done" : ""}`}
        onClick={() => planInputRef.current?.click()}
        disabled={uploading}
      >
        {planFileCount
          ? `✓ ${planFileCount} file${planFileCount === 1 ? "" : "s"} uploaded — reading in the background. Add another?`
          : uploading ? "Uploading…" : "📐 Upload a floorplan — photo or PDF"}
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
        onPick={(v) => set({ jobType: v })}
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
            disabled={uploading}
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

function PageSurfaces({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
  const toggle = (k: WizardSurfaceKey) => {
    const on = state.surfaces.includes(k);
    const surfaces = on ? state.surfaces.filter((x) => x !== k) : [...state.surfaces, k];
    // Dark-to-light picks may only reference ticked surfaces.
    const darkToLightSurfaces = state.condition.darkToLightSurfaces.filter((x) => surfaces.includes(x));
    set({ surfaces, condition: { ...state.condition, darkToLightSurfaces } });
  };
  return (
    <>
      <p className="wz-kick">Step 2 of 5 · Surfaces</p>
      <h1>What&rsquo;s being painted?</h1>
      <p className="wz-sub">We&rsquo;ve pre-ticked the usual full repaint — untick anything that isn&rsquo;t being done.</p>
      <div className="wz-tiles">
        {WIZARD_SURFACE_KEYS.map((k) => (
          <button key={k} className={`wz-tile ${state.surfaces.includes(k) ? "on" : ""}`} onClick={() => toggle(k)}>
            {SURFACE_LABELS[k]}
          </button>
        ))}
      </div>
    </>
  );
}

// ---- page 3: condition ------------------------------------------------------

function PageCondition({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
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
                  {SURFACE_LABELS[k]}
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
          {hasPlanRuns ? (
            <>
              <input
                ref={damageInputRef} type="file" hidden multiple accept="image/*"
                onChange={(e) => { onDamageFiles([...(e.target.files ?? [])]); e.target.value = ""; }}
              />
              <button
                className={`wz-photo-stub ${d.damagePhotoCount ? "done" : ""}`}
                onClick={() => damageInputRef.current?.click()}
              >
                {d.damagePhotoCount
                  ? `✓ ${d.damagePhotoCount} photo${d.damagePhotoCount === 1 ? "" : "s"} attached — they feed the defect reader, which prices the prep properly`
                  : "📷 Attach photos of the worst areas — they feed our defect reader, which prices the prep properly"}
              </button>
            </>
          ) : (
            <p className="wz-photo-stub" style={{ cursor: "default" }}>
              Without a floorplan the photo reader has nothing to attach to — describe the damage below and
              it goes to the review queue; photos can be added in the builder afterwards.
            </p>
          )}
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

function PagePaint({ state, set }: { state: WizardState; set: (p: Partial<WizardState>) => void }) {
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
      <p className="wz-kick">Step 5 of 5 · Paint &amp; colours</p>
      <h1>Paint and colours</h1>
      <p className="wz-sub">Tick anything that applies — perfectly fine to leave blank.</p>
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
