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
  /**
   * Group the SHOWN items (after the search) under a heading — the Movements
   * tray is grouped by job. Items keep their order; a group starts where its
   * key first appears. The Schedule board passes neither.
   */
  groupKey?: (item: T) => string;
  renderGroupHead?: (key: string, items: T[]) => ReactNode;
  /** Anything between the search box and the list (filter chips). */
  controls?: ReactNode;
  /** Extra class names on the aside (a phone drawer's `open`). */
  className?: string;
  /** Anything after the list (+ Add a chip). */
  after?: ReactNode;
};

/**
 * The tray beside the lanes: a searchable list of cards that can be dragged
 * onto a lane. Client-side substring search, no debounce (Tom, 18 Sep: find
 * a job in a long tray without scrolling it).
 */
export function Tray<T>({
  items, itemKey, searchText, searchPlaceholder, searchLabel, title, sub, emptyText, noMatch, prelude, renderItem, onDragStart, hint,
  groupKey, renderGroupHead, controls, className, after,
}: TrayProps<T>) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const shown = query ? items.filter((it) => searchText(it).toLowerCase().includes(query)) : items;

  const list = groupKey
    ? [...shown.reduce((m, it) => {
        const k = groupKey(it);
        m.set(k, [...(m.get(k) ?? []), it]);
        return m;
      }, new Map<string, T[]>())].map(([key, group]) => (
        <Fragment key={`group:${key}`}>
          {renderGroupHead?.(key, group)}
          {group.map((it) => <Fragment key={itemKey(it)}>{renderItem(it, { onPointerDown: (e) => onDragStart(e, it) })}</Fragment>)}
        </Fragment>
      ))
    : shown.map((it) => (
        <Fragment key={itemKey(it)}>
          {renderItem(it, { onPointerDown: (e) => onDragStart(e, it) })}
        </Fragment>
      ));

  return (
    <aside className={`tray${className ? ` ${className}` : ""}`}>
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
      {controls}
      {items.length === 0 ? (
        <div className="empty">{emptyText}</div>
      ) : shown.length === 0 ? (
        <div className="empty" data-testid="tray-no-match">{noMatch(search.trim(), items.length)}</div>
      ) : list}
      {after}
      {hint !== undefined && <p className="hint">{hint}</p>}
    </aside>
  );
}
