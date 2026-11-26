"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

/**
 * Closing a sheet by pressing its backdrop (Tom, 26 Nov 2026: "Send a message
 * keeps dropping out when trying to fill it in"). A bare `onClick` on the
 * backdrop also fires when a press STARTS inside the sheet and ends outside
 * it — selecting the text in a field with a drag, or a thumb that slides off
 * a box — because the browser hands the click to the nearest common
 * ancestor, which is the backdrop. The sheet closed and every word went with
 * it. So: the press must both start and end on the backdrop itself.
 *
 * Spread the result on the backdrop element: `<div {...backdrop}>`.
 */
export function useBackdropClose(onClose: () => void) {
  const startedOnBackdrop = useRef(false);
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => { startedOnBackdrop.current = e.target === e.currentTarget; },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const close = startedOnBackdrop.current && e.target === e.currentTarget;
      startedOnBackdrop.current = false;
      if (close) onClose();
    },
  };
}
