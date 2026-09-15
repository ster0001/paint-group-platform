"use client";
import type { ReactElement } from "react";
import type { Choice } from "@/lib/wizard/quick-look";

/**
 * Tom, 15 Sep (late, item 2): "What are we painting?" on the outside screen —
 * smaller square tiles with a drawing and the wording underneath, the same
 * style as the window and door pictures, so they sit side by side.
 *
 * Multi-select: each tile is its own tick. The testids are the ones the
 * exterior specs already use (`ql-ext-el-<key>`, `ql-ext-sep-<key>`).
 */
const S = "#39424B";
const F = "#12161A";
const P = "#1F262C";
const C = "#2FB9CB";

const D: Record<string, ReactElement> = {
  body: <svg viewBox="0 0 60 64"><polygon points="8,26 30,10 52,26" fill={P} stroke={S} /><rect x="12" y="26" width="36" height="28" fill={F} stroke={S} /><rect x="16" y="30" width="28" height="20" fill="none" stroke={C} strokeDasharray="2 2" /></svg>,
  windows: <svg viewBox="0 0 60 64"><rect x="12" y="10" width="36" height="44" fill={F} stroke={S} /><line x1="30" y1="10" x2="30" y2="54" stroke={S} /><line x1="12" y1="32" x2="48" y2="32" stroke={S} /><rect x="12" y="10" width="36" height="44" fill="none" stroke={C} strokeDasharray="2 2" /></svg>,
  doors: <svg viewBox="0 0 60 64"><rect x="16" y="6" width="28" height="52" rx="2" fill={P} stroke={S} /><rect x="20" y="10" width="9" height="16" fill={F} stroke={S} /><rect x="31" y="10" width="9" height="16" fill={F} stroke={S} /><rect x="20" y="30" width="20" height="24" fill={F} stroke={S} /><circle cx="38" cy="36" r="1.6" fill="#8C959D" /></svg>,
  fascias: <svg viewBox="0 0 60 64"><polygon points="6,30 30,12 54,30" fill={P} stroke={S} /><rect x="6" y="30" width="48" height="5" fill={F} stroke={C} /><rect x="12" y="35" width="36" height="20" fill={F} stroke={S} /></svg>,
  gutters: <svg viewBox="0 0 60 64"><polygon points="6,28 30,12 54,28" fill={P} stroke={S} /><path d="M6 30 h48 v5 a3 3 0 0 1 -3 3 h-42 a3 3 0 0 1 -3 -3 z" fill={F} stroke={C} /><line x1="48" y1="38" x2="48" y2="58" stroke={C} strokeWidth="2" /><rect x="12" y="38" width="30" height="18" fill={F} stroke={S} /></svg>,
  eaves: <svg viewBox="0 0 60 64"><polygon points="4,30 30,12 56,30" fill={P} stroke={S} /><rect x="14" y="30" width="32" height="24" fill={F} stroke={S} /><line x1="4" y1="30" x2="14" y2="30" stroke={C} strokeWidth="3" /><line x1="46" y1="30" x2="56" y2="30" stroke={C} strokeWidth="3" /></svg>,
  garage_door: <svg viewBox="0 0 60 64"><rect x="8" y="14" width="44" height="42" fill={F} stroke={S} /><line x1="8" y1="26" x2="52" y2="26" stroke={S} /><line x1="8" y1="38" x2="52" y2="38" stroke={S} /><line x1="8" y1="50" x2="52" y2="50" stroke={S} /><rect x="8" y="14" width="44" height="42" fill="none" stroke={C} strokeDasharray="2 2" /></svg>,
  paling_fence: <svg viewBox="0 0 60 64">{[10, 19, 28, 37, 46].map((x) => <rect key={x} x={x} y="16" width="7" height="40" fill={F} stroke={S} />)}<line x1="8" y1="26" x2="54" y2="26" stroke={C} /><line x1="8" y1="46" x2="54" y2="46" stroke={C} /></svg>,
  picket_fence: <svg viewBox="0 0 60 64">{[10, 20, 30, 40, 50].map((x) => <polygon key={x} points={`${x - 3},56 ${x - 3},22 ${x},16 ${x + 3},22 ${x + 3},56`} fill={F} stroke={S} />)}<line x1="6" y1="30" x2="54" y2="30" stroke={C} /><line x1="6" y1="46" x2="54" y2="46" stroke={C} /></svg>,
  deck: <svg viewBox="0 0 60 64">{[14, 22, 30, 38, 46].map((y) => <rect key={y} x="8" y={y} width="44" height="6" fill={F} stroke={S} />)}<line x1="14" y1="52" x2="14" y2="60" stroke={C} strokeWidth="2" /><line x1="46" y1="52" x2="46" y2="60" stroke={C} strokeWidth="2" /></svg>,
  shed: <svg viewBox="0 0 60 64"><polygon points="8,26 30,14 52,26" fill={P} stroke={S} /><rect x="10" y="26" width="40" height="30" fill={F} stroke={S} /><rect x="24" y="36" width="12" height="20" fill={P} stroke={C} /></svg>,
  wall: <svg viewBox="0 0 60 64">{[16, 26, 36, 46].map((y, i) => <g key={y}>{[0, 1, 2].map((j) => <rect key={j} x={6 + j * 16 + (i % 2) * 8} y={y} width="15" height="9" fill={F} stroke={S} />)}</g>)}<line x1="6" y1="56" x2="54" y2="56" stroke={C} strokeWidth="2" /></svg>,
  front: <svg viewBox="0 0 60 64"><rect x="10" y="10" width="40" height="44" fill={F} stroke={S} /><line x1="10" y1="54" x2="50" y2="54" stroke={C} strokeWidth="4" /><rect x="24" y="44" width="12" height="10" fill={P} stroke={C} /></svg>,
  back: <svg viewBox="0 0 60 64"><rect x="10" y="10" width="40" height="44" fill={F} stroke={S} /><line x1="10" y1="10" x2="50" y2="10" stroke={C} strokeWidth="4" /></svg>,
  left: <svg viewBox="0 0 60 64"><rect x="10" y="10" width="40" height="44" fill={F} stroke={S} /><line x1="10" y1="10" x2="10" y2="54" stroke={C} strokeWidth="4" /></svg>,
  right: <svg viewBox="0 0 60 64"><rect x="10" y="10" width="40" height="44" fill={F} stroke={S} /><line x1="50" y1="10" x2="50" y2="54" stroke={C} strokeWidth="4" /></svg>,
  all: <svg viewBox="0 0 60 64"><rect x="10" y="10" width="40" height="44" fill={F} stroke={C} strokeWidth="4" /></svg>,
};

export function ExteriorPickTiles<T extends string>({ options, on, onPick, name }: {
  options: Choice<T>[]; on: readonly T[]; onPick: (v: T) => void; name: string;
}) {
  return (
    <div className="wz-pick sc-tiles wz-exttiles" data-testid={`ql-${name}`}>
      {options.map((o) => {
        const isOn = on.includes(o.value);
        return (
          <button key={o.value} type="button" className={`wz-pk ${isOn ? "on" : ""}`} aria-pressed={isOn}
            data-testid={`ql-${name}-${o.value}`} onClick={() => onPick(o.value)}>
            {D[o.value] ?? D.body}
            <small>{o.label}</small>
            {o.hint && <em className="wz-pksub">{o.hint}</em>}
          </button>
        );
      })}
    </div>
  );
}
