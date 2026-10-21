"use client";

import { Fragment, type ReactNode } from "react";
import { dayDiff } from "@/lib/scheduling/dates";
import { DayCell } from "./DayCell";
import type { BlockBind, BoardSlots, LaneLayout } from "./types";
import type { BoardDrag } from "./useBoardDrag";
import type { GhostFlags } from "./types";

export type LaneProps<L, B, P, C extends GhostFlags> = {
  lane: L;
  id: string;
  layout: LaneLayout<B>;
  days: string[];
  start: string;
  range: number;
  rowHeight: number;
  /** "fixed": the row is `rows × rowHeight` tall (the Schedule board). "content": the cells decide (Movements). */
  rowSizing: "fixed" | "content";
  slots: BoardSlots;
  slotHours: [number, number];
  drag: BoardDrag<P, C>;
  renderLaneHead: (lane: L, layout: LaneLayout<B>) => ReactNode;
  laneData?: (lane: L) => Record<string, string | undefined>;
  laneClass?: (lane: L) => string | undefined;
  renderLaneOverlay?: (lane: L) => ReactNode;
  renderBlock: (block: B, bind: BlockBind) => ReactNode;
  renderSlot?: (lane: L, day: string, slot: string) => ReactNode;
  renderCellHead?: (lane: L, day: string) => ReactNode;
  blockId: (block: B) => string;
  blockStart: (block: B) => string;
  blockEnd: (block: B) => string;
  isMovable?: (block: B) => boolean;
  blockPayload: (block: B) => P;
};

/**
 * One row of the board: the sticky lane head, then the lane — `range` day
 * cells first (the drag engine hit-tests the literal class names `lane` and
 * `bgc`), then any overlay, then the blocks positioned off `--day-w`.
 */
export function Lane<L, B, P, C extends GhostFlags>({
  lane, id, layout, days, start, range, rowHeight, rowSizing, slots, slotHours, drag,
  renderLaneHead, laneData, laneClass, renderLaneOverlay, renderBlock, renderSlot, renderCellHead, blockId, blockStart, blockEnd, isMovable, blockPayload,
}: LaneProps<L, B, P, C>) {
  const extra = laneClass?.(lane);
  return (
    <div className="crow" style={rowSizing === "fixed" ? { height: `${Math.max(1, layout.rows) * rowHeight + 14}px` } : undefined}>
      <div className="cinfo">{renderLaneHead(lane, layout)}</div>

      <div
        className={`lane${extra ? ` ${extra}` : ""}`}
        data-testid="lane"
        data-lane={id}
        {...(laneData?.(lane) ?? {})}
        ref={(el) => drag.registerLane(id, el)}
        onPointerDown={(e) => drag.beginRangeSelect(e, id)}
      >
        {days.map((d) => (
          <DayCell
            key={d}
            day={d}
            slots={slots}
            slotHours={slotHours}
            renderSlot={renderSlot ? (slot) => renderSlot(lane, d, slot) : undefined}
            head={renderCellHead?.(lane, d)}
          />
        ))}

        {renderLaneOverlay?.(lane)}

        {layout.placed.map(({ block, row }) => {
          const offset = Math.max(0, dayDiff(start, blockStart(block)));
          const endIdx = Math.min(range - 1, dayDiff(start, blockEnd(block)));
          const span = Math.max(1, endIdx - offset + 1);
          const movable = isMovable ? isMovable(block) : true;
          const bind: BlockBind = {
            style: {
              left: `calc(var(--day-w) * ${offset} + 3px)`,
              width: `calc(var(--day-w) * ${span} - 6px)`,
              top: `${7 + row * rowHeight}px`,
            },
            onPointerDown: movable ? (e) => drag.beginDrag(e, blockPayload(block)) : undefined,
            row, offset, span,
          };
          return <Fragment key={blockId(block)}>{renderBlock(block, bind)}</Fragment>;
        })}
      </div>
    </div>
  );
}
