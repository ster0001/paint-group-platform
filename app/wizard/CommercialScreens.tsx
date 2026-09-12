"use client";

import { CHANGING_GROUPS, CONDITION_BANDS, JOB_TYPES, toggleChanging, type QuickLook } from "@/lib/wizard/quick-look";
import {
  OPEN_CEILINGS, OPEN_HEIGHTS, OPEN_SIZES, openCount, routeTag, segmentTiles,
  type CommercialAnswers, type Segment,
} from "@/lib/wizard/segments";
import { gateMessage, routeCommercial } from "@/lib/wizard/commercial";
import { WH_AREAS, WH_HEIGHTS, WH_MATERIALS, WH_RACKING, WH_SURFACES, toggleWarehouseMaterial, type WarehouseSurfaceKey } from "@/lib/wizard/warehouse";

/**
 * C12 — the commercial screens (prototype `s-commercial`, `s-com-areas`,
 * `s-com-job`), rendered FROM THE ROW.
 *
 * Addendum §4.11: *"The wizard renders counts, open-space blocks, also-areas,
 * surfaces, hours and occupied from `commercial_segments`. No segment-specific
 * JSX beyond the two patterns (areas + job, warehouse) and the brief."* So
 * there is no `if (segment === "office")` anywhere in this file: the office,
 * the clinic, the school and the café all come through the same three
 * functions, and adding a ninth segment is a row and a seed.
 *
 * Presentational, like QuickLook.tsx: WizardApp owns the state, the routing
 * (`quickNext`), the photo upload and the submit. This file owns the
 * questions, and its only words of its own are the frame around the row's.
 */

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// ---------------------------------------------------------------------------
// Screen: which kind of space (s-commercial)
// ---------------------------------------------------------------------------

export function SegmentScreen({ segments, value, onPick, jobType, onJobType, onBook, phone }: {
  segments: Segment[];
  value: string | null;
  onPick: (key: string) => void;
  jobType: QuickLook["jobType"];
  onJobType: (jt: QuickLook["jobType"]) => void;
  onBook: () => void;
  phone: string | null;
}) {
  const routing = routeCommercial(value, { segments, jobType });
  return (
    <>
      <p className="wz-kick">About the space</p>
      <h1>What kind of space?</h1>
      <p className="wz-sub">
        Every one of these can be a visit — just say so. Offices, warehouses, retail and hospitality,
        schools and aged care can also be ranged online first. Strata and shop fronts are priced on site.
      </p>
      <div className="wz-cards" data-testid="ql-segment">
        {segmentTiles(segments).map((s) => (
          <button
            key={s.key} type="button"
            className={`wz-card ${value === s.key ? "on" : ""}`}
            data-testid={`ql-segment-${s.key}`}
            data-route={s.route}
            onClick={() => onPick(s.key)}
          >
            <em className={`wz-segtag ${s.route === "range" ? "" : "vis"}`}>{routeTag(s.route)}</em>
            <b>{s.name}</b>
            {s.tile_hint && <span>{s.tile_hint}</span>}
          </button>
        ))}
      </div>

      {/* v2.2: every segment asks inside / outside / both — outside goes to
          the brief, both goes to one visit. The answer IS the job type. */}
      <p className="wz-qhead">Which part?</p>
      <div className="wz-chips" data-testid="ql-cpart">
        {JOB_TYPES.map((o) => (
          <button
            key={o.value} type="button"
            className={`wz-chip ${jobType === o.value ? "on" : ""}`}
            aria-pressed={jobType === o.value}
            data-testid={`ql-cpart-${o.value}`}
            onClick={() => onJobType(o.value)}
          >{o.label}</button>
        ))}
      </div>
      <p className="wz-chint" data-testid="ql-cpart-hint">
        Outsides of commercial buildings are priced on site. Inside and outside together are one visit.
      </p>

      {value && !routing.canPriceOnline && (
        <div className="wz-follow" data-testid="segment-visit-note">
          <p className="wz-q">{gateMessage(routing)}</p>
        </div>
      )}

      <div className="wz-rather" data-testid="ql-seg-rather">
        <b>Not sure, or in a hurry?</b>
        <p>Book an estimator now. We bring the questions with us and you can skip the rest.</p>
        <div className="wz-rather-row">
          <button type="button" className="wz-btn wz-bs2" onClick={onBook} data-testid="ql-seg-book">Book someone in</button>
          {phone && (
            <a className="wz-btn wz-bs2" href={`tel:${phone.replace(/\s+/g, "")}`} data-testid="ql-seg-call">Call us</a>
          )}
        </div>
      </div>
      <p className="wz-chint" data-testid="ql-trade-note">
        Trade or property manager? <a className="wz-linkish" href="/portal">Sign in to your trade account</a> — saved specs, address book and one-tap rebook.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen: the areas (s-com-areas) — the office pattern
// ---------------------------------------------------------------------------

export function AreasScreen({ segment, answers, onAnswers, photoCount, onPhotos }: {
  segment: Segment;
  answers: CommercialAnswers;
  onAnswers: (patch: Partial<CommercialAnswers>) => void;
  /** Photos already attached (they ride the condition-photo upload). */
  photoCount: number;
  onPhotos: () => void;
}) {
  const c = segment.config;
  const n = openCount(segment, answers);
  const setCount = (key: string, delta: number) => {
    const def = c.counts?.find((x) => x[0] === key)?.[3] ?? 0;
    const next = Math.max(0, Math.min(500, (answers.counts[key] ?? def) + delta));
    onAnswers({ counts: { ...answers.counts, [key]: next } });
  };
  const toggleAlso = (label: string) =>
    onAnswers({ also: answers.also.includes(label) ? answers.also.filter((a) => a !== label) : [...answers.also, label] });

  return (
    <>
      <p className="wz-kick">{c.kick}</p>
      <h1>{c.title ?? `Tell us about the ${segment.name.toLowerCase()}`}</h1>
      {c.sub && <p className="wz-sub">{c.sub}</p>}

      {c.kindQ && (
        <>
          <p className="wz-qhead">{c.kindQ[0]}</p>
          <div className="wz-chips" data-testid="com-kind">
            {c.kindQ[1].map(([v, label]) => (
              <button
                key={v} type="button"
                className={`wz-chip ${answers.kind === v ? "on" : ""}`}
                aria-pressed={answers.kind === v}
                data-testid={`com-kind-${v}`}
                onClick={() => onAnswers({ kind: v })}
              >{label}</button>
            ))}
          </div>
        </>
      )}

      <div className="wz-counts" data-testid="com-counts">
        {(c.counts ?? []).map(([key, label, hint, def]) => {
          const val = answers.counts[key] ?? def;
          return (
            <div className="wz-countrow" key={key} data-testid={`com-count-${key}`}>
              <div className="wz-qtext">
                {label}
                {hint && <small>{hint}</small>}
              </div>
              <div className="wz-stepper">
                <button type="button" aria-label={`fewer ${label.toLowerCase()}`} data-testid={`com-count-${key}-minus`} disabled={val === 0} onClick={() => setCount(key, -1)}>−</button>
                <span data-testid={`com-count-${key}-n`}>{val}</span>
                <button type="button" aria-label={`more ${label.toLowerCase()}`} data-testid={`com-count-${key}-plus`} onClick={() => setCount(key, 1)}>+</button>
              </div>
            </div>
          );
        })}
      </div>

      {n > 0 && c.openLabel && (
        <div className="wz-opencard" data-testid="com-open">
          <p className="wz-qhead" style={{ marginTop: 0 }}>
            {c.openLabel}{n > 1 ? "s" : ""} <span className="wz-opt">{n > 1 ? "THE FIRST ONE; THE REST FOLLOW THE SAME SHAPE" : "THE SHAPE OF IT"}</span>
          </p>
          <p className="wz-chint" style={{ marginTop: 0 }}>
            {c.openCopy ?? "Open spaces are the easiest thing to misprice. Partitions look like less wall, but the cutting-in around them takes the same time. Tell us the size and the ceiling, and a photo lets your estimator check."}
          </p>
          <p className="wz-qhead">Roughly how big?</p>
          <Pills options={OPEN_SIZES} value={answers.openSize} name="com-size" onPick={(openSize) => onAnswers({ openSize })} />
          {c.openMode === "height" && (
            <>
              <p className="wz-qhead">How high are the walls?</p>
              <Pills options={OPEN_HEIGHTS} value={answers.openHeight ?? "6"} name="com-height" onPick={(openHeight) => onAnswers({ openHeight })} />
            </>
          )}
          <p className="wz-qhead">The ceiling</p>
          <Pills options={OPEN_CEILINGS} value={answers.ceiling} name="com-ceil" onPick={(ceiling) => onAnswers({ ceiling })} />
          {/* The photo rides the condition-photo upload the estimator already
              reviews; its presence is what narrows the band (⚑20). */}
          <button type="button" className={`wz-photo-stub ${photoCount ? "done" : ""}`} onClick={onPhotos} data-testid="com-photo" data-photos={photoCount}>
            {photoCount
              ? `✓ ${photoCount} photo${photoCount === 1 ? "" : "s"} added — your estimator checks the shape of it`
              : "📷 Add a photo or two — without one the range stays wider"}
          </button>
        </div>
      )}

      {(c.also ?? []).length > 0 && (
        <>
          <p className="wz-qhead">Also being painted?</p>
          <div className="wz-chips wz-tiles" data-testid="com-also">
            {(c.also ?? []).map((label) => (
              <button
                key={label} type="button"
                className={`wz-tile ${answers.also.includes(label) ? "on" : ""}`}
                aria-pressed={answers.also.includes(label)}
                data-testid={`com-also-${slug(label)}`}
                onClick={() => toggleAlso(label)}
              >
                {label}
                {c.alsoFlag?.[label] && <small className="wz-tile-flag">{c.alsoFlag[label]}</small>}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen: the job (s-com-job) — surfaces, colours, condition, hours, occupied
// ---------------------------------------------------------------------------

export function JobScreen({ segment, answers, onAnswers, quick, onQuick }: {
  segment: Segment;
  answers: CommercialAnswers;
  onAnswers: (patch: Partial<CommercialAnswers>) => void;
  quick: QuickLook;
  onQuick: (patch: Partial<QuickLook>) => void;
}) {
  const c = segment.config;
  const toggleSurface = (label: string) =>
    onAnswers({ surfaces: answers.surfaces.includes(label) ? answers.surfaces.filter((s) => s !== label) : [...answers.surfaces, label] });
  // The three bands with the SEGMENT's own examples of wear and work.
  const bands = CONDITION_BANDS.map((b) =>
    b.value === "wear" && c.wear ? { ...b, hint: c.wear }
      : b.value === "needs_work" && c.work ? { ...b, hint: c.work }
        : b,
  );

  return (
    <>
      <p className="wz-kick">The job</p>
      <h1>What&rsquo;s being painted, and how?</h1>
      <p className="wz-sub">
        Tick the surfaces. We work out the coats and preparation from your colour and condition answers,
        and show you exactly what we&rsquo;ve allowed for.
      </p>

      {c.surf && c.surf.length > 0 && (
        <div className="wz-chips wz-tiles" data-testid="com-surf">
          {c.surf.map((label) => (
            <button
              key={label} type="button"
              className={`wz-tile ${answers.surfaces.includes(label) ? "on" : ""}`}
              aria-pressed={answers.surfaces.includes(label)}
              data-testid={`com-surf-${slug(label)}`}
              onClick={() => toggleSurface(label)}
            >{label}</button>
          ))}
        </div>
      )}

      {/* C9's tiles, reused as they are — ONE colour control in the wizard. */}
      <p className="wz-qhead">What&rsquo;s changing colour?</p>
      <p className="wz-chint" style={{ marginTop: 0, marginBottom: 8 }}>
        Tick what&rsquo;s getting a new colour. Anything you leave unticked is painted the same colour it is now.
      </p>
      <div className="wz-chips" data-testid="ql-changing">
        {CHANGING_GROUPS.map((o) => (
          <button
            key={o.value} type="button"
            className={`wz-tile ${quick.changing[o.value] ? "on" : ""}`}
            aria-pressed={quick.changing[o.value]}
            data-testid={`ql-changing-${o.value}`}
            onClick={() => onQuick({ changing: toggleChanging(quick, o.value) })}
          >{o.label}</button>
        ))}
      </div>
      <p className="wz-qhead">Any of them going much lighter, or a bold colour? <span className="wz-opt">NEEDS AN UNDERCOAT FIRST — WE ALLOW FOR IT</span></p>
      <Pills options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} value={quick.bold ? "yes" : "no"} name="bold"
        onPick={(v) => onQuick({ bold: v === "yes" })} />
      <p className="wz-qhead">Still choosing colours? <span className="wz-opt">FINE — WE ALLOW FOR NEW COLOURS AND YOU DECIDE LATER</span></p>
      <Pills options={[{ value: "known", label: "I know roughly" }, { value: "undecided", label: "Still choosing" }]} value={quick.undecided ? "undecided" : "known"} name="choosing"
        onPick={(v) => onQuick({ undecided: v === "undecided" })} />

      <p className="wz-qhead">How&rsquo;s it looking?</p>
      <div className="wz-cards" data-testid="ql-condition">
        {bands.map((o) => (
          <button
            key={o.value} type="button"
            className={`wz-card ${quick.condition === o.value ? "on" : ""}`}
            data-testid={`ql-condition-${o.value}`}
            onClick={() => onQuick({ condition: o.value })}
          >
            <b>{o.label}</b>
            {o.hint && <span>{o.hint}</span>}
          </button>
        ))}
      </div>

      {c.hours.length > 0 && (
        <>
          <p className="wz-qhead">When can we work?</p>
          <Pills options={c.hours.map(([value, label]) => ({ value, label }))} value={answers.hours} name="com-hours" onPick={(hours) => onAnswers({ hours })} />
        </>
      )}
      {c.occ && (
        <>
          <p className="wz-qhead">{c.occ[0]}</p>
          <Pills options={c.occ[1].map(([value, label]) => ({ value, label }))} value={answers.occ ?? ""} name="com-occ" onPick={(occ) => onAnswers({ occ })} />
        </>
      )}
    </>
  );
}

function Pills<T extends string>({ options, value, onPick, name }: {
  options: { value: T; label: string }[]; value: T | string; onPick: (v: T) => void; name: string;
}) {
  return (
    <div className="wz-chips" data-testid={`${name.startsWith("com-") || name.startsWith("wh-") ? name : `ql-${name}`}`}>
      {options.map((o) => (
        <button
          key={o.value} type="button"
          className={`wz-chip ${value === o.value ? "on" : ""}`}
          aria-pressed={value === o.value}
          data-testid={`${name.startsWith("com-") || name.startsWith("wh-") ? name : `ql-${name}`}-${o.value}`}
          onClick={() => onPick(o.value)}
        >{o.label}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen: the warehouse (s-com-warehouse) — C13, the second pattern
// ---------------------------------------------------------------------------

export function WarehouseScreen({ segment, answers, onAnswers }: {
  segment: Segment;
  answers: CommercialAnswers;
  onAnswers: (patch: Partial<CommercialAnswers>) => void;
}) {
  const on = new Set<WarehouseSurfaceKey>(answers.whSurfaces);
  const toggle = (k: WarehouseSurfaceKey) =>
    onAnswers({ whSurfaces: on.has(k) ? answers.whSurfaces.filter((x) => x !== k) : [...answers.whSurfaces, k] });
  const step = (field: "rollerDoors" | "personnelDoors" | "offices", delta: number) =>
    onAnswers({ [field]: Math.max(0, Math.min(60, answers[field] + delta)) } as Partial<CommercialAnswers>);
  const typed = answers.lengthM != null || answers.widthM != null;
  return (
    <>
      <p className="wz-kick">{segment.config.kick || "Industrial or warehouse"}</p>
      <h1>Tell us about the space</h1>
      <p className="wz-sub">Near enough is fine — brackets are fine. We&rsquo;ll size the walls from the floor area and the height.</p>

      <p className="wz-qhead" style={{ marginTop: 0 }}>Floor area</p>
      <Pills options={WH_AREAS} value={answers.areaBracket} name="wh-area" onPick={(areaBracket) => onAnswers({ areaBracket, lengthM: null, widthM: null })} />
      <div className="wz-countrow" data-testid="wh-lw">
        <div className="wz-qtext">Or type it<small>Length × width, in metres — beats the bracket</small></div>
        <div className="wz-stepper" style={{ border: 0 }}>
          <input className="wz-in" style={{ width: 84 }} inputMode="decimal" placeholder="Length m" data-testid="wh-length" value={answers.lengthM ?? ""}
            onChange={(e) => onAnswers({ lengthM: e.target.value === "" ? null : Math.max(1, Math.min(500, Number(e.target.value) || 0)) })} />
          <span>×</span>
          <input className="wz-in" style={{ width: 84 }} inputMode="decimal" placeholder="Width m" data-testid="wh-width" value={answers.widthM ?? ""}
            onChange={(e) => onAnswers({ widthM: e.target.value === "" ? null : Math.max(1, Math.min(500, Number(e.target.value) || 0)) })} />
        </div>
      </div>
      {typed && <p className="wz-chint" data-testid="wh-typed-note">Typed size in use — the bracket above is ignored.</p>}

      <p className="wz-qhead">Height to the underside of the roof</p>
      <Pills options={WH_HEIGHTS} value={answers.roofHeight} name="wh-height" onPick={(roofHeight) => onAnswers({ roofHeight })} />
      <p className="wz-chint">Above about four metres we allow for a scissor lift — it shows as its own line, and you can tell us if you have one on site.</p>

      <p className="wz-qhead">What&rsquo;s being painted?</p>
      <div className="wz-cards" data-testid="wh-surf">
        {/* A div with the button role, like the prototype's tiles: the counted
            rows carry a stepper of real buttons, and a button inside a button
            is not HTML. */}
        {WH_SURFACES.map((o) => (
          <div
            key={o.value} role="button" tabIndex={0}
            className={`wz-card ${on.has(o.value) ? "on" : ""}`}
            aria-pressed={on.has(o.value)}
            data-testid={`wh-surf-${o.value}`}
            data-flagged={o.flagged ? "1" : undefined}
            onClick={() => toggle(o.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(o.value); } }}
          >
            <b>{o.label}</b>
            {o.hint && <span>{o.hint}{o.flagged ? " — priced on confirmation" : ""}</span>}
            {o.counted && on.has(o.value) && (
              <span className="wz-stepper" style={{ marginTop: 8, display: "inline-flex" }} onClick={(e) => e.stopPropagation()} data-testid={`wh-count-${o.counted}`}>
                <button type="button" aria-label={`fewer ${o.label.toLowerCase()}`} data-testid={`wh-count-${o.counted}-minus`} disabled={answers[o.counted] <= 0} onClick={() => step(o.counted!, -1)}>−</button>
                <span data-testid={`wh-count-${o.counted}-n`}>{answers[o.counted]}</span>
                <button type="button" aria-label={`more ${o.label.toLowerCase()}`} data-testid={`wh-count-${o.counted}-plus`} onClick={() => step(o.counted!, 1)}>+</button>
              </span>
            )}
          </div>
        ))}
      </div>

      {on.has("walls") && (
        <div data-testid="wh-materials-q">
          <p className="wz-qhead">What are the walls made of? <span className="wz-opt">TICK EVERYTHING</span></p>
          <div className="wz-chips" data-testid="wh-mat">
            {WH_MATERIALS.map((o) => (
              <button
                key={o.value} type="button"
                className={`wz-chip ${answers.materials.includes(o.value) ? "on" : ""}`}
                aria-pressed={answers.materials.includes(o.value)}
                data-testid={`wh-mat-${o.value}`}
                onClick={() => onAnswers({ materials: toggleWarehouseMaterial(answers.materials, o.value) })}
              >{o.label}</button>
            ))}
          </div>
          <p className="wz-chint">Nothing is ticked for you — precast is often left bare on purpose, so we&rsquo;d rather you told us.</p>
        </div>
      )}

      <p className="wz-qhead">Three things that change access</p>
      <div className="wz-countrow" data-testid="wh-racking">
        <div className="wz-qtext">Racking or stock against the walls?<small>We paint above it, or you clear it — it changes the price a lot</small></div>
        <Pills options={WH_RACKING} value={answers.racking} name="wh-rack" onPick={(racking) => onAnswers({ racking })} />
      </div>
      <div className="wz-countrow" data-testid="wh-operating">
        <div className="wz-qtext">Operating during the works?</div>
        <Pills options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} value={answers.operating ? "yes" : "no"} name="wh-op" onPick={(v) => onAnswers({ operating: v === "yes" })} />
      </div>
      <div className="wz-countrow" data-testid="wh-lift">
        <div className="wz-qtext">A scissor lift or forklift on site we can use?</div>
        <Pills options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} value={answers.liftOnSite ? "yes" : "no"} name="wh-lift" onPick={(v) => onAnswers({ liftOnSite: v === "yes" })} />
      </div>
    </>
  );
}
