"use client";

import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { addDays } from "@/lib/scheduling/dates";
import { Lane } from "./Lane";
import { dayParts, isWeekend, monthRuns } from "./format";
import type { BlockBind, BoardSlots, DropTarget, GhostFlags, LaneLayout } from "./types";
import type { BoardDrag } from "./useBoardDrag";
import type { BoardZoom } from "./useBoardZoom";
import "./board.css";

export type BoardProps<L, B, P, C extends GhostFlags> = {
  zoom: BoardZoom;
  drag: BoardDrag<P, C>;

  lanes: L[];
  laneId: (lane: L) => string;
  /** Which lanes to draw. Default: all. */
  filterLane?: (lane: L) => boolean;

  blocks: B[];
  blockId: (block: B) => string;
  blockLane: (block: B) => string;
  /** Inclusive ISO dates. */
  blockStart: (block: B) => string;
  blockEnd: (block: B) => string;
  /** Which blocks count toward a lane's busiest-day load (`layout.peak`). Default: all. */
  countsTowardLoad?: (block: B) => boolean;
  /** What a block becomes when it is picked up. */
  blockPayload: (block: B) => P;
  isMovable?: (block: B) => boolean;

  /** Sub-row height in px — the block grid the lane packs into. */
  rowHeight?: number;
  /**
   * "fixed" (default): a row is `rows × rowHeight` tall — the Schedule board.
   * "content": the day cells size the row — a board whose content lives INSIDE
   * the cells (Movements: hourly rows, cards in halves).
   */
  rowSizing?: "fixed" | "content";
  /** One slicing for every lane, or per lane (Movements: hourly staff lanes beside AM/PM painter lanes). */
  slots?: BoardSlots | ((lane: L) => BoardSlots);
  /** For `slots="hour"`: first hour, hour after the last. A fractional start (7.5) gives half-past rows. */
  slotHours?: [number, number];

  /** The header cell above the lane column ("Contractor"). */
  laneHeadTitle: ReactNode;
  renderLaneHead: (lane: L, layout: LaneLayout<B>) => ReactNode;
  /** Extra `data-*` attributes on the lane element. */
  laneData?: (lane: L) => Record<string, string | undefined>;
  /** Extra class names on the lane element (a lane's kind, its colour hook). */
  laneClass?: (lane: L) => string | undefined;
  /** Absolutely positioned content inside the lane, drawn under the blocks (walkthrough pins). */
  renderLaneOverlay?: (lane: L) => ReactNode;
  renderBlock: (block: B, bind: BlockBind) => ReactNode;
  /** Content INSIDE a sub-slot (`am` / `pm` / `HH:MM`): context blocks, placed cards. Needs `slots` other than "none". */
  renderSlot?: (lane: L, day: string, slot: string) => ReactNode;
  /** Content at the top of a day cell, above its slots (the Nearby pill). */
  renderCellHead?: (lane: L, day: string) => ReactNode;
  /** Inside the `.ghost`: what the thing being dragged says. */
  renderGhost: (payload: P, check: C | null, target: DropTarget | null) => ReactNode;
  /** Drawn where the lanes would be when none is visible. */
  emptyMessage?: ReactNode;

  /**
   * sessionStorage key for scroll persistence (Tom, 1 Oct): open a link from
   * the board and come back, and the board is where you left it. Omit to
   * start at the top every time.
   */
  storageKey?: string;

  /** The `.top` bar. */
  header?: ReactNode;
  /** The `<Tray>` (or anything else in the left column). */
  tray?: ReactNode;
  /** Sheets, scrims, toasts — drawn after the layout, inside `.sb`. */
  children?: ReactNode;
};

/**
 * The board: a sticky date header over lanes of day cells, a tray beside it,
 * a ghost that follows the pointer. CSS lives in app/pc/schedule/schedule.css
 * (scoped under `.sb`) plus board.css for what the engine added.
 */
export function Board<L, B, P, C extends GhostFlags>({
  zoom, drag, lanes, laneId, filterLane, blocks, blockId, blockLane, blockStart, blockEnd, countsTowardLoad, blockPayload, isMovable,
  rowHeight = 52, rowSizing = "fixed", slots = "none", slotHours = [7, 17],
  laneHeadTitle, renderLaneHead, laneData, laneClass, renderLaneOverlay, renderBlock, renderSlot, renderCellHead, renderGhost, emptyMessage,
  storageKey, header, tray, children,
}: BoardProps<L, B, P, C>) {
  const { dayW, range, start, days, today, setScrollerEl, scrollerEl } = zoom;
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * The board is a workspace, not a document (Tom, 18 Sep: "keep the month day
   * and date locked at the top of the screen, so you can still see when
   * dragging a job").
   *
   * The dates live INSIDE the horizontal scroller — they have to, they scroll
   * sideways with the columns — and a sticky element only ever pins to its own
   * scrollport, so pinning them to the page does nothing. The timeline has to
   * be the scroller instead, which means it has to end where the screen ends.
   *
   * That height is MEASURED, not guessed: what sits above it — the console's
   * tab rail, the board's own bar, the legend — changes height when it wraps,
   * and a guess that is 40px out either hides the bottom lane or leaves the
   * page scrolling the locked header off the top, which is the whole bug.
   */
  useEffect(() => {
    const root = rootRef.current;
    const tl = scrollerEl();
    if (!root || !tl) return;
    const fit = () => {
      // Document coordinates: the viewport-relative top moves as the page
      // scrolls, and sizing off that feeds itself.
      const top = tl.getBoundingClientRect().top + window.scrollY;
      root.style.setProperty("--sb-space", `${Math.max(260, window.innerHeight - top - 8)}px`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
  }, [scrollerEl]);

  /**
   * Tom, 1 Oct: open an estimate from the board and come back, and the board
   * is where you left it — not flicked back to the top-left. The links are
   * full navigations, so React state is gone when we return; the page scroll
   * AND the timeline's own scroller (it is the scrollport, see above) are kept
   * in sessionStorage — per tab, gone when the tab closes — and put back once
   * on the next mount. Saved on every scroll (rAF-throttled) so a tap on a
   * link never has to run first.
   */
  useEffect(() => {
    const tl = scrollerEl();
    if (!tl || !storageKey) return;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        sessionStorage.removeItem(storageKey); // restore once; a fresh visit starts at the top
        const v = JSON.parse(raw) as { y?: number; tlx?: number; tly?: number };
        if (typeof v.tlx === "number") tl.scrollLeft = v.tlx;
        if (typeof v.tly === "number") tl.scrollTop = v.tly;
        if (typeof v.y === "number") window.scrollTo(0, v.y);
      }
    } catch { /* storage blocked — the board still works, it just opens at the top */ }
    const write = () => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify({ y: window.scrollY, tlx: tl.scrollLeft, tly: tl.scrollTop }));
      } catch { /* as above */ }
    };
    let raf = 0;
    const save = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; write(); });
    };
    window.addEventListener("scroll", save, { passive: true });
    tl.addEventListener("scroll", save, { passive: true });
    window.addEventListener("pagehide", write); // no frame comes after this one — write now
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", save);
      tl.removeEventListener("scroll", save);
      window.removeEventListener("pagehide", write);
    };
  }, [scrollerEl, storageKey]);

  const visibleLanes = useMemo(() => (filterLane ? lanes.filter(filterLane) : lanes), [lanes, filterLane]);

  /**
   * Lay each lane out in sub-rows.
   *
   * A lane can hold several blocks starting the same day — that's allowed on
   * purpose. Drawn naively they'd sit on top of each other and the office would
   * see one job where there are three, so overlapping blocks are packed into
   * stacked rows and the lane grows to fit.
   */
  const laneLayout = useMemo(() => {
    const last = addDays(start, range - 1);
    const m = new Map<string, LaneLayout<B>>();

    for (const l of visibleLanes) {
      const id = laneId(l);
      const mine = blocks
        .filter((b) => blockLane(b) === id && blockEnd(b) >= start && blockStart(b) <= last)
        .sort((a, b) => blockStart(a).localeCompare(blockStart(b)) || blockEnd(a).localeCompare(blockEnd(b)));

      // Greedy interval packing: first row whose last block has already finished.
      const rowEnds: string[] = [];
      const placed = mine.map((block) => {
        let row = rowEnds.findIndex((end) => end < blockStart(block));
        if (row === -1) { row = rowEnds.length; rowEnds.push(blockEnd(block)); }
        else rowEnds[row] = blockEnd(block);
        return { block, row };
      });

      // Busiest single day, counting what the caller says is real load.
      let peak = 0;
      for (let i = 0; i < range; i++) {
        const day = days[i];
        const n = mine.filter((b) => (countsTowardLoad ? countsTowardLoad(b) : true) && blockStart(b) <= day && blockEnd(b) >= day).length;
        if (n > peak) peak = n;
      }

      m.set(id, { placed, rows: Math.max(1, rowEnds.length), peak });
    }
    return m;
  }, [blocks, visibleLanes, laneId, blockLane, blockStart, blockEnd, countsTowardLoad, start, range, days]);

  const styleVars = { ["--day-w" as string]: `${dayW}px`, ["--days" as string]: String(range) } as CSSProperties;
  const ghost = drag.ghost;

  return (
    <div className="sb" style={styleVars} ref={rootRef}>
      {header}

      <div className="layout">
        {tray}

        <main className="tl" ref={(el) => setScrollerEl(el)}>
          <div className="grid">
            {/* Tom, 18 Sep: the month, the day and the date stay locked at the
                top while you scroll down through the lanes, so you can always
                see which day you are dragging onto. One wrapper rather than
                pinning the two rows separately, so nothing depends on knowing
                how tall the month bar is. */}
            <div className="hdr" data-testid="board-header">
            <div className="mb">
              <div className="mcell spacer" />
              {monthRuns(days).map((m, i) => (
                <div key={i} className="mcell" style={{ gridColumn: `span ${m.span}` }}>
                  {m.label}
                </div>
              ))}
            </div>
            <div className="dh">
              <div className="cell lanehead">{laneHeadTitle}</div>
              {days.map((d) => {
                const p = dayParts(d);
                const we = isWeekend(p.dow);
                return (
                  <div key={d} className={`cell ${we ? "we" : ""} ${d === today ? "today" : ""}`}>
                    {/* Day name AND number, always — a column of bare numbers
                        gives no sense of where the weekends fall. Zoomed right
                        out there is only room for the initial. */}
                    <span className="dw">{dayW >= 34 ? p.short : p.short.slice(0, 1)}</span>
                    <span className="dn">{p.num}</span>
                  </div>
                );
              })}
            </div>
            </div>

            <div>
              {visibleLanes.map((l) => {
                const id = laneId(l);
                return (
                  <Lane<L, B, P, C>
                    key={id}
                    lane={l}
                    id={id}
                    layout={laneLayout.get(id) ?? { placed: [], rows: 1, peak: 0 }}
                    days={days}
                    start={start}
                    range={range}
                    rowHeight={rowHeight}
                    rowSizing={rowSizing}
                    slots={typeof slots === "function" ? slots(l) : slots}
                    slotHours={slotHours}
                    drag={drag}
                    renderLaneHead={renderLaneHead}
                    laneData={laneData}
                    laneClass={laneClass}
                    renderLaneOverlay={renderLaneOverlay}
                    renderBlock={renderBlock}
                    renderSlot={renderSlot}
                    renderCellHead={renderCellHead}
                    blockId={blockId}
                    blockStart={blockStart}
                    blockEnd={blockEnd}
                    isMovable={isMovable}
                    blockPayload={blockPayload}
                  />
                );
              })}
              {visibleLanes.length === 0 && emptyMessage !== undefined && (
                <div className="empty" style={{ margin: 20 }}>{emptyMessage}</div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* drag ghost — moved by transform only */}
      {ghost && (
        <div ref={(el) => drag.setGhostEl(el)} className={`ghost ${ghost.check?.blocked ? "blocked" : ghost.check?.held ? "held" : ""}`}>
          {renderGhost(ghost.payload, ghost.check, ghost.target)}
        </div>
      )}

      {children}
    </div>
  );
}
