"use client";

import { Fragment, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { TrayBind } from "./types";

export type TrayProps<T> = {
  items: T[];
  itemKey: (item: T) => string;
  /** What the search box matches against — the words staff know an item by. */
  searchText: (item: T) => string;
  searchPlaceholder: string;
  searchLabel: string;
  title: ReactNode;
  sub: ReactNode;
  /** Shown when there are no items at all. */
  emptyText: ReactNode;
  /** Shown when the search matches nothing. */
  noMatch: (query: string, total: number) => ReactNode;
  /** Anything that goes ABOVE the list (approvals, banners). */
  prelude?: ReactNode;
  /** The card. Spread `bind` onto the root of anything that can be dragged. */
  renderItem: (item: T, bind: TrayBind) => ReactNode;
  onDragStart: (e: ReactPointerEvent, item: T) => void;
  hint?: ReactNode;
};

/**
 * The tray beside the lanes: a searchable list of cards that can be dragged
 * onto a lane. Client-side substring search, no debounce (Tom, 18 Sep: find
 * a job in a long tray without scrolling it).
 */
export function Tray<T>({
  items, itemKey, searchText, searchPlaceholder, searchLabel, title, sub, emptyText, noMatch, prelude, renderItem, onDragStart, hint,
}: TrayProps<T>) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const shown = query ? items.filter((it) => searchText(it).toLowerCase().includes(query)) : items;

  return (
    <aside className="tray">
      {prelude}

      <h2>{title}</h2>
      <p className="sub">{sub}</p>
      {items.length > 0 && (
        <input
          type="search"
          className="traysearch"
          placeholder={searchPlaceholder}
          aria-label={searchLabel}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="tray-search"
        />
      )}
      {items.length === 0 ? (
        <div className="empty">{emptyText}</div>
      ) : shown.length === 0 ? (
        <div className="empty" data-testid="tray-no-match">{noMatch(search.trim(), items.length)}</div>
      ) : (
        shown.map((it) => (
          <Fragment key={itemKey(it)}>
            {renderItem(it, { onPointerDown: (e) => onDragStart(e, it) })}
          </Fragment>
        ))
      )}
      {hint !== undefined && <p className="hint">{hint}</p>}
    </aside>
  );
}
