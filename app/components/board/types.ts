import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

/**
 * The board engine — ONE lanes × days drag surface (CLAUDE.md "one board
 * engine"). Lifted from app/pc/schedule/ScheduleBoard.tsx in Movements
 * Session 2 (docs/briefs/movements-session-0-report.md item 1); the Schedule
 * board is its first consumer and must not change behaviour.
 *
 * The engine knows nothing about contractors, offers or work orders. What
 * differs between boards arrives as props: what a lane is, what a block is,
 * how a block or a tray card is drawn, whether a drop is allowed, and how
 * finely a day is sliced.
 */

/** How finely a day cell is sliced into drop targets. */
export type BoardSlots = "none" | "half" | "hour";

/** Where the pointer is, resolved from the cell's data attributes. */
export type DropTarget = {
  laneId: string;
  dayIndex: number;
  /** ISO date of the cell under the pointer. */
  day: string;
  /** `data-slot` of the sub-slot under the pointer (`am` / `pm`, or `HH:00`); null on a plain day cell. */
  slot: string | null;
};

/** What the drop check must at least say, so the engine can tint the lane and the ghost. */
export type GhostFlags = { blocked?: boolean; held?: boolean };

/** What the engine hands a block renderer: its position and its drag handle. */
export type BlockBind = {
  style: CSSProperties;
  /** Only present when the block is movable — spread it onto the block's root. */
  onPointerDown?: (e: ReactPointerEvent) => void;
  row: number;
  /** Day index of the block's first visible day and how many columns it spans in this window. */
  offset: number;
  span: number;
};

/** What the engine hands a tray item renderer: its drag handle. */
export type TrayBind = {
  onPointerDown: (e: ReactPointerEvent) => void;
};

/** Per-lane packing result: blocks in sub-rows, the row count, the busiest day's load. */
export type LaneLayout<B> = {
  placed: { block: B; row: number }[];
  rows: number;
  peak: number;
};
