import type { ReactElement } from "react";
import type { EquipmentCategory, MovementKind } from "./types";

/**
 * Movements — the icon set (brief §3.1, ruling 18): one icon per register type, drawn once
 * from design/reference/pc-movements-mockup.html, used on gear chips, on the board, in the
 * chip sheet and (Session 6) on the Gear register and the map. A new category needs an icon
 * here before it can be created. Stroke = currentColor, so the surface's colour applies.
 */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const svg = (children: ReactElement | ReactElement[], width = 1.6) => (
  <svg viewBox="0 0 24 24" {...P} strokeWidth={width} aria-hidden="true">{children}</svg>
);

export const GEAR_ICONS: Record<EquipmentCategory, ReactElement> = {
  step_ladder: svg([<path key="a" d="M9 3h6l4 18M9 3L5 21" />, <path key="b" d="M8.2 8h7.6M7.4 12.5h9.2M6.6 17h10.8" />, <path key="c" d="M15 3l-1.2 5.4" />]),
  ext_ladder_7: svg([<path key="a" d="M6 21V7M12 21V7" />, <path key="b" d="M6 10h6M6 14h6M6 18h6" />, <path key="c" d="M12 15V3M18 15V3" />, <path key="d" d="M12 6h6M12 9h6M12 12h6" />]),
  ext_ladder_10: svg([<path key="a" d="M4 22V10M9 22V10" />, <path key="b" d="M4 13h5M4 16h5M4 19h5" />, <path key="c" d="M9 16V6M14 16V6" />, <path key="d" d="M9 9h5M9 12h5" />, <path key="e" d="M14 10V2M19 10V2" />, <path key="f" d="M14 5h5M14 8h5" />]),
  platform_ladder: svg([<path key="a" d="M8 7h8l3 14M8 7L5 21" />, <path key="b" d="M7 7h10v-2H7z" />, <path key="c" d="M7.3 12h9.4M6.5 16.5h11" />, <path key="d" d="M9 5V3M15 5V3" />]),
  spray_gun: svg([<path key="a" d="M3 9h11l3-2v6l-3-2H9v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />, <path key="b" d="M9 14l-1 7h4" />, <path key="c" d="M19 7h2M19 11h2M20 9h3" opacity=".7" />]),
  planex_sander: svg([<circle key="a" cx="7" cy="16" r="4.5" />, <circle key="b" cx="7" cy="16" r="1.5" />, <path key="c" d="M10.5 12.5L21 2" />, <path key="d" d="M19 3l2 2" />]),
  festool_vacuum: svg([<rect key="a" x="4" y="9" width="12" height="9" rx="2" />, <circle key="b" cx="7" cy="20" r="1.5" />, <circle key="c" cx="13" cy="20" r="1.5" />, <path key="d" d="M16 12c3 0 4-1 4-4s-2-4-4-4" />, <path key="e" d="M6 9V7h8v2" />]),
  mobile_scaffold: svg([<path key="a" d="M5 20V4M19 20V4" />, <path key="b" d="M5 8h14M5 14h14" />, <path key="c" d="M5 8l14 6M19 8L5 14" />, <circle key="d" cx="5" cy="21" r="1.4" />, <circle key="e" cx="19" cy="21" r="1.4" />, <path key="f" d="M4 4h16" />]),
  fall_protection: svg([<path key="a" d="M12 3a4 4 0 0 1 4 4v3l3 7H5l3-7V7a4 4 0 0 1 4-4z" />, <path key="b" d="M12 10v7M9 14h6" />, <path key="c" d="M12 17v3" />, <circle key="d" cx="12" cy="21" r="1.2" />]),
  other: svg([<path key="a" d="M4 7h16v12H4z" />, <path key="b" d="M4 11h16" />]),
};

export const GEAR_LABELS: Record<EquipmentCategory, string> = {
  step_ladder: "Step ladder", ext_ladder_7: "Extension ladder 7 m", ext_ladder_10: "Extension ladder 10 m", platform_ladder: "Platform ladder",
  spray_gun: "Spray gun", planex_sander: "Planex wall sander", festool_vacuum: "Festool vacuum", mobile_scaffold: "Mobile scaffold",
  fall_protection: "Fall protection", other: "Other gear",
};

/** The four need icons (ruling 21): paint · materials · gear · rubbish. */
export const KIND_ICONS = {
  paint: svg([<path key="a" d="M5 9h14v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />, <path key="b" d="M8 9V6a4 4 0 0 1 8 0v3" />, <path key="c" d="M5 13h14" opacity=".6" />], 1.7),
  materials: svg([<path key="a" d="M3 8l9-4 9 4-9 4z" />, <path key="b" d="M3 8v8l9 4 9-4V8" />, <path key="c" d="M12 12v8" />], 1.7),
  gear: GEAR_ICONS.mobile_scaffold,
  rubbish: svg([<path key="a" d="M4 7h16l-2 13H6z" />, <path key="b" d="M9 7V4h6v3" />, <path key="c" d="M10 11v6M14 11v6" />], 1.7),
} as const;

/** The icon a movement carries: its first item's type for gear, else its kind's. */
export function movementIcon(m: { kind: MovementKind }, firstCategory?: EquipmentCategory | null): ReactElement {
  switch (m.kind) {
    case "paint": return KIND_ICONS.paint;
    case "materials": case "restock": return KIND_ICONS.materials;
    case "rubbish_in": case "rubbish_out": return KIND_ICONS.rubbish;
    case "hire_on": case "hire_off": return GEAR_ICONS.mobile_scaffold;
    default: return firstCategory ? GEAR_ICONS[firstCategory] : KIND_ICONS.gear;
  }
}
