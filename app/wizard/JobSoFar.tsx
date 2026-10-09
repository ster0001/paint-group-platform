"use client";

import { CONDITION_BANDS, SCOPE_PRESETS, type QuickLook, type QuickLookStep } from "@/lib/wizard/quick-look";
import type { ExteriorQuickLook } from "@/lib/wizard/exterior-quick-look";
import { railFor, STEP_LABELS } from "./stepRail";

/**
 * "Your job so far" (UI refresh S2, brief §7.2) — one row per answered step,
 * each with a Change link back to it, and how many steps are left. It only
 * restates answers already given; it never adds a number of its own. Hidden
 * on a phone (the progress row says how far along they are).
 */
const KIND: Record<QuickLook["propertyKind"], string> = { house: "House", townhouse: "Townhouse", unit_apartment: "Unit or apartment", commercial: "Commercial" };
const PART: Record<QuickLook["jobType"], string> = { interior: "inside", exterior: "outside", both: "inside and outside" };

export default function JobSoFar({ steps, at, quick, outside, address, roomCount, segmentName, areaCount, briefCount, onGo }: {
  steps: readonly QuickLookStep[];
  at: QuickLookStep;
  quick: QuickLook;
  outside: ExteriorQuickLook;
  address: string;
  roomCount: number;
  segmentName: string | null;
  areaCount: number;
  briefCount: number;
  onGo: (step: QuickLookStep) => void;
}) {
  const rail = railFor(steps, at);
  const done = steps.slice(0, Math.max(0, steps.indexOf(at)));
  const say = (s: QuickLookStep): [string, string] | null => {
    switch (s) {
      case "start": return [address || "Your address", `Address · ${PART[quick.jobType]}`];
      case "both": return ["One after the other", "Inside and outside"];
      case "place": return [
        quick.propertyKind === "commercial" || quick.jobType === "exterior"
          ? KIND[quick.propertyKind]
          : `${KIND[quick.propertyKind]} · ${quick.bedrooms >= 5 ? "5+" : quick.bedrooms} bed · ${quick.storeys === "double" ? "two storeys" : "single storey"}`,
        "The property",
      ];
      case "job": return [`${SCOPE_PRESETS.find((o) => o.value === quick.scope)?.label ?? "The job"}${quick.bold ? " · a bold colour" : ""}`, "The job"];
      case "rooms": return [`${roomCount} room${roomCount === 1 ? "" : "s"}`, "The rooms"];
      case "condition": return [`${CONDITION_BANDS.find((o) => o.value === quick.condition)?.label ?? ""} · ${quick.occupied === "yes" ? "lived in" : "empty"}`, "Condition"];
      case "outside": {
        const n = outside.elements.length + outside.standalone.length;
        return [`${n} thing${n === 1 ? "" : "s"} to paint`, "The outside"];
      }
      case "sides": {
        const n = (outside.sides ?? ["front", "left", "back", "right"]).length;
        return [n === 4 ? "All four sides" : `${n} side${n === 1 ? "" : "s"}`, "Which sides"];
      }
      case "segment": return [segmentName ?? "The space", `The space · ${PART[quick.jobType]}`];
      case "com_areas": return [`${areaCount} area${areaCount === 1 ? "" : "s"}`, "The areas"];
      case "com_warehouse": return ["The building", "Size and height"];
      case "com_job": return [CONDITION_BANDS.find((o) => o.value === quick.condition)?.label ?? "The job", "The job"];
      case "com_brief": return [`${briefCount} thing${briefCount === 1 ? "" : "s"} to paint`, "Your answers"];
      default: return null;
    }
  };
  const rows = done.map((s) => [s, say(s)] as const).filter((r): r is readonly [QuickLookStep, [string, string]] => r[1] != null);
  return (
    <div className="wz-sofar" data-testid="ql-sofar">
      <h3>Your job so far {rows.length > 0 && <span>{rail.remaining}</span>}</h3>
      {rows.length ? (
        <ul>
          {rows.map(([s, [value, label]]) => (
            <li key={s} data-step={s}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" /></svg>
              <span>{value}<small>{label}</small></span>
              <button type="button" onClick={() => onGo(s)} data-testid={`ql-sofar-change-${s}`}
                aria-label={`Change ${STEP_LABELS[s].long.toLowerCase()}`}>Change</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Your answers collect here as you go, so you can check and change them.</p>
      )}
    </div>
  );
}
