"use client";

import type { ReactNode } from "react";
import type { ExteriorV2 } from "@/lib/wizard/state";
import { typicalFor, WALL_MATERIALS, type ExteriorTypicalRow, type WallMaterial } from "@/lib/wizard/exterior-typicals";
import { setSidePaint } from "@/lib/wizard/exterior-model";
import { EXTERIOR_SIDE_KEYS } from "@/lib/wizard/exterior-typicals";
import { anyBrick, anyVerticalTimber, EXTRA_LABEL } from "@/lib/wizard/exterior-model";
import { EXT_ACCESS, EXT_COLOURS, EXT_WINDOW_TYPES, toggleAccess, type ExteriorAccessAnswer, type ExteriorColour } from "@/lib/wizard/exterior-quick-look";
import { WINDOW_DRAWINGS } from "@/app/estimate/scope/StyleTiles";

/**
 * ABOUT IT — "Tell us about what you ticked" (Exterior wizard v2 brief §7.3, S3).
 *
 * A card per ticked part that needs more: the walls (one material on a single
 * storey; downstairs and upstairs on a double storey, "Same as downstairs"
 * first — ⚑ 18), painted or bare brick whenever brick is chosen anywhere (⚑ 5),
 * a stain note for vertical timber, the gable's fill (⚑ 4), the window type
 * (the drawing changes), single or double garage, the posts (⚑ 8), the extras'
 * rough sizes. Then the colours and the access — the same three cards and
 * four chips the outside screen always had (Tom, 12 Oct: before the gate).
 * No storeys question: the shape knows. The picture's texture follows every
 * answer.
 */

export const WALL_MATERIAL_LABEL: Record<WallMaterial, string> = {
  weatherboards: "Weatherboards", render: "Render", brick: "Brick", stucco: "Stucco",
  cement_sheet: "Cement sheet / panel", colorbond: "Colorbond / metal", vertical_timber: "Vertical timber (stained)", concrete: "Tilt slab / concrete",
};
const GABLE_FILL: ReadonlyArray<{ value: NonNullable<ExteriorV2["gableFill"]>; label: string; hint?: string }> = [
  { value: "stucco", label: "Stucco" }, { value: "boards", label: "Weatherboards" }, { value: "strap", label: "Strapping over render" },
  { value: "shingles", label: "Shingles", hint: "Priced by your estimator" },
];
const POST_KIND: ReadonlyArray<{ value: NonNullable<ExteriorV2["postKind"]>; label: string }> = [
  { value: "posts", label: "Timber posts" }, { value: "columns", label: "Brick or stucco columns" }, { value: "lace", label: "Iron posts with lacework" },
];
/** The extras that take a size, and the unit asked. */
const EXTRA_SIZE: ReadonlyArray<{ extra: ExteriorV2["extras"][number]; key: string; unit: string; hint: string }> = [
  { extra: "paling_fence", key: "fence", unit: "m", hint: "about how many metres" },
  { extra: "picket_fence", key: "fence", unit: "m", hint: "about how many metres" },
  { extra: "deck", key: "deck", unit: "m²", hint: "about the floor area" },
  { extra: "wall", key: "wall", unit: "m", hint: "about how long" },
];

function Chips<T extends string>({ options, value, onPick, name }: { options: ReadonlyArray<{ value: T; label: string; hint?: string }>; value: T | null; onPick: (v: T) => void; name: string }) {
  return (
    <div className="wz-chips" data-testid={name}>
      {options.map((o) => (
        <button key={o.value} type="button" className={`wz-tile ${value === o.value ? "on" : ""}`} aria-pressed={value === o.value} data-testid={`${name}-${o.value}`} onClick={() => onPick(o.value)}>
          {o.label}{o.hint && <span className="wz-tilesub">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

function Card({ testId, title, hint, children }: { testId: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <div data-testid={testId}>
      <p className="wz-qhead">{title}</p>
      {hint && <p className="wz-hint">{hint}</p>}
      {children}
    </div>
  );
}

const num = (v: string): number | null => { const m = parseFloat(v.replace(/[^0-9.]/g, "")); return isNaN(m) || m <= 0 ? null : Math.min(500, m); };

export default function ExteriorAboutStep({ v2, rows = [], colour, access, onChange, onColour, onAccess }: {
  v2: ExteriorV2;
  rows?: ReadonlyArray<ExteriorTypicalRow>;
  colour: ExteriorColour;
  access: ExteriorAccessAnswer[];
  onChange: (next: ExteriorV2) => void;
  onColour: (c: ExteriorColour) => void;
  onAccess: (a: ExteriorAccessAnswer[]) => void;
}) {
  const t = typicalFor(v2.propertyType, rows);
  const has = (p: ExteriorV2["parts"][number]) => v2.parts.includes(p);
  const two = t.storeys === 2;
  const mats = WALL_MATERIALS.map((m) => ({ value: m, label: WALL_MATERIAL_LABEL[m] }));
  const setWall = (patch: Partial<ExteriorV2["wall"]>) => onChange({ ...v2, wall: { ...v2.wall, ...patch } });
  const setSize = (key: string, value: number | null) => {
    const extraSizes = { ...v2.extraSizes };
    if (value == null) delete extraSizes[key]; else extraSizes[key] = value;
    onChange({ ...v2, extraSizes });
  };
  const sizeRows = EXTRA_SIZE.filter((r) => v2.extras.includes(r.extra));
  const nothingToAsk = !has("walls") && !has("gable") && !has("windows") && !has("garage") && !has("posts") && sizeRows.length === 0 && !v2.extras.includes("pergola") && !v2.extras.includes("wall");

  return (
    <>
      <p className="wz-kick">About it</p>
      <h1>Tell us about what you ticked</h1>
      <p className="wz-sub">Only the parts you ticked. The picture follows each answer.</p>
      {nothingToAsk && <p className="wz-chint" data-testid="ext-about-none">Nothing more to ask about the parts you ticked — just the colours and access below.</p>}

      {has("walls") && (
        <Card testId="ext-walls-q" title={two ? "What are the walls made of?" : "What are the walls made of?"}
          hint={two ? "Two storeys are often two materials." : "One material — if it's a mix, pick the bigger one and your estimator corrects it on the visit."}>
          {two && <p className="wz-chint" style={{ marginTop: 0 }}>Downstairs</p>}
          <Chips options={mats} value={v2.wall.down} name="ext-mat" onPick={(m) => setWall({ down: m })} />
          {two && (
            <>
              <p className="wz-chint">Upstairs</p>
              <div className="wz-chips" data-testid="ext-mat-up">
                <button type="button" className={`wz-tile ${v2.wall.up == null ? "on" : ""}`} aria-pressed={v2.wall.up == null} data-testid="ext-mat-up-same" onClick={() => setWall({ up: null })}>Same as downstairs</button>
                {mats.map((o) => (
                  <button key={o.value} type="button" className={`wz-tile ${v2.wall.up === o.value ? "on" : ""}`} aria-pressed={v2.wall.up === o.value} data-testid={`ext-mat-up-${o.value}`} onClick={() => setWall({ up: o.value })}>{o.label}</button>
                ))}
              </div>
            </>
          )}
          {anyBrick(v2) && (
            <div data-testid="ext-brick-q" style={{ marginTop: 10 }}>
              <p className="wz-chint" style={{ marginTop: 0 }}>Has the brick been painted before? Bare brick takes a sealer and an extra coat.</p>
              <Chips options={[{ value: "yes", label: "Painted before" }, { value: "no", label: "Bare brick" }]} value={v2.wall.brickPainted} name="ext-brick" onPick={(v) => setWall({ brickPainted: v })} />
            </div>
          )}
          {anyVerticalTimber(v2) && (
            <div data-testid="ext-timber-q" style={{ marginTop: 10 }}>
              <p className="wz-chint" style={{ marginTop: 0 }} data-testid="ext-timber-note">Vertical timber is usually stained, not painted — we price the stain. Tell us if yours is painted.</p>
              <Chips options={[{ value: "no", label: "Stained" }, { value: "yes", label: "Painted" }]} value={v2.wall.timberPainted ?? "no"} name="ext-timber" onPick={(v) => setWall({ timberPainted: v })} />
            </div>
          )}
        </Card>
      )}

      {has("gable") && (
        <Card testId="ext-gable-q" title="What's in the gable?" hint="The triangle under the roof.">
          <Chips options={GABLE_FILL} value={v2.gableFill} name="ext-gable" onPick={(f) => onChange({ ...v2, gableFill: f })} />
        </Card>
      )}

      {has("windows") && (
        <Card testId="ext-windows-q" title="What type of windows, mostly?">
          <div className="wz-pick sc-tiles" data-testid="ql-ext-win">
            {EXT_WINDOW_TYPES.filter((o) => o.value !== "alu" && o.value !== "unsure").map((o) => (
              <button key={o.value} type="button" className={`wz-pk ${v2.windowType === o.value ? "on" : ""}`} aria-pressed={v2.windowType === o.value}
                data-testid={`ql-ext-win-${o.value}`} onClick={() => onChange({ ...v2, windowType: o.value })}>
                {WINDOW_DRAWINGS[o.value as "casement" | "sash" | "colonial" | "winder"]}<small>{o.label}</small>{o.hint && <em className="wz-pksub">{o.hint}</em>}
              </button>
            ))}
          </div>
          <div className="wz-chips" style={{ marginTop: 8 }}>
            {EXT_WINDOW_TYPES.filter((o) => o.value === "alu" || o.value === "unsure").map((o) => (
              <button key={o.value} type="button" className={`wz-tile ${v2.windowType === o.value ? "on" : ""}`} aria-pressed={v2.windowType === o.value}
                data-testid={`ql-ext-win-${o.value}`} onClick={() => onChange({ ...v2, windowType: o.value })}>{o.label}</button>
            ))}
          </div>
          {v2.windowType === "alu" && <p className="wz-chint" data-testid="ext-alu-note">Aluminium usually isn&rsquo;t painted — your estimator will check.</p>}
          <p className="wz-chint">How many on each side comes after your range, when you tighten it.</p>
        </Card>
      )}

      {has("garage") && (
        <Card testId="ext-garage-q" title="Single or double garage door?">
          <Chips options={[{ value: "1", label: "Single" }, { value: "2", label: "Double" }]} value={v2.garageCars == null ? null : String(v2.garageCars) as "1" | "2"} name="ext-garage"
            onPick={(v) => onChange({ ...v2, garageCars: v === "2" ? 2 : 1 })} />
        </Card>
      )}

      {has("posts") && (
        <Card testId="ext-posts-q" title="What are the posts?">
          <Chips options={POST_KIND} value={v2.postKind} name="ext-posts" onPick={(k) => onChange({ ...v2, postKind: k })} />
        </Card>
      )}

      {(sizeRows.length > 0 || v2.extras.includes("pergola")) && (
        <Card testId="ext-sizes-q" title="Around the house — rough sizes" hint="Near enough is fine; we check them on the visit.">
          {sizeRows.map((r) => (
            <div className="wz-countrow" key={r.extra} data-testid={`ext-size-${r.extra}`}>
              <div className="wz-qtext">{EXTRA_LABEL[r.extra]}<small>{r.hint}</small></div>
              <input className="wz-field" style={{ width: 110, marginBottom: 0 }} inputMode="decimal" placeholder={r.unit} data-testid={`ext-size-${r.extra}-input`}
                defaultValue={v2.extraSizes[r.key] ?? ""} onBlur={(e) => setSize(r.key, num(e.target.value))} />
            </div>
          ))}
          {v2.extras.includes("wall") && (
            <Chips options={[{ value: "brick", label: "Brick wall" }, { value: "render", label: "Rendered wall" }]} value={v2.extraWallMaterial ?? "brick"} name="ext-wallmat"
              onPick={(m) => onChange({ ...v2, extraWallMaterial: m })} />
          )}
          {v2.extras.includes("pergola") && (
            <div className="wz-countrow" data-testid="ext-size-pergola">
              <div className="wz-qtext">Pergola top<small>length × width — priced on the top&rsquo;s area</small></div>
              <div className="wz-seg" style={{ alignItems: "center" }}>
                <input className="wz-field" style={{ width: 90, marginBottom: 0 }} inputMode="decimal" placeholder="length m" data-testid="ext-size-pergola-l"
                  defaultValue={v2.extraSizes.pergola_l ?? ""} onBlur={(e) => setSize("pergola_l", num(e.target.value))} />
                <input className="wz-field" style={{ width: 90, marginBottom: 0 }} inputMode="decimal" placeholder="width m" data-testid="ext-size-pergola-w"
                  defaultValue={v2.extraSizes.pergola_w ?? ""} onBlur={(e) => setSize("pergola_w", num(e.target.value))} />
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Tom, 21 Oct (item 6): which sides, asked HERE — only the ticked sides appear on Each side. */}
      <div data-testid="ext-about-sides" style={{ marginTop: 22 }}>
        <p className="wz-qhead">Which sides are we painting?</p>
        <p className="wz-chint" style={{ marginTop: 0 }}>Tick every side we&rsquo;re painting &mdash; you check each one next.{t.sharedSides.length ? " A shared wall starts unticked." : ""}</p>
        <div className="wz-chips">
          {EXTERIOR_SIDE_KEYS.map((k) => {
            const sd = v2.sides[k];
            const on = !!sd?.paint;
            const label = k === "front" ? "Front" : k === "back" ? "Back" : k === "left" ? "Left side" : "Right side";
            return (
              <button key={k} type="button" className={`wz-tile ${on ? "on" : ""}`} aria-pressed={on} data-testid={`ext-about-side-${k}`}
                onClick={() => onChange(setSidePaint(v2, k, !on))}>
                {label}{sd?.shared && <span className="wz-tilesub">usually a shared wall</span>}
              </button>
            );
          })}
        </div>
      </div>

      <p className="wz-qhead">Colours</p>
      <div className="wz-cards" data-testid="ql-ext-colour">
        {EXT_COLOURS.map((o) => (
          <button key={o.value} type="button" className={`wz-card ${colour === o.value ? "on" : ""}`} aria-pressed={colour === o.value} data-testid={`ql-ext-colour-${o.value}`} onClick={() => onColour(o.value)}>
            <b>{o.label}</b>{o.hint && <span>{o.hint}</span>}
          </button>
        ))}
      </div>

      <p className="wz-qhead">Anything tricky about getting to it?</p>
      <div className="wz-chips" data-testid="ql-ext-access">
        {EXT_ACCESS.map((o) => (
          <button key={o.value} type="button" className={`wz-tile ${access.includes(o.value) ? "on" : ""}`} aria-pressed={access.includes(o.value)} data-testid={`ql-ext-access-${o.value}`}
            onClick={() => onAccess(toggleAccess(access, o.value))}>{o.label}</button>
        ))}
      </div>
      {access.includes("lift") && (
        <p className="wz-chint" data-testid="ext-lift-note" style={{ marginTop: 10 }}>
          Nothing for scaffolding or a lift is in this price. If the job needs one we&rsquo;ll quote it with you before we start, as a separate line — never a surprise on the invoice.
        </p>
      )}
    </>
  );
}
