"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Tom, 17 Sep 2026: "if you click onto a different page without saving, it
 * saves the estimate or invoice first before opening the new page".
 *
 * One hook, two guards:
 *  - an in-app link (the sidebar, a breadcrumb, any same-origin anchor): when
 *    there is unsaved work, the click is held, `save()` runs, and the page
 *    then opens where the click was going. A save that FAILS keeps you on
 *    the page — its own message says why — rather than losing the edit.
 *  - closing the tab, refreshing, or typing a URL: the browser's own
 *    "leave site?" prompt, the only hook a browser offers there.
 *
 * `dirty` and `save` are read through refs, so the caller passes fresh
 * closures every render without re-installing the listeners.
 */
export function useSaveBeforeLeave({ dirty, save }: {
  dirty: () => boolean;
  /** Resolve true when the work is saved (or there was nothing to save). */
  save: () => Promise<boolean>;
}) {
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  const saveRef = useRef(save);
  const savingRef = useRef(false);
  // Fresh closures after every commit; the listeners below read the refs.
  useEffect(() => {
    dirtyRef.current = dirty;
    saveRef.current = save;
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;
      const href = a.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || /^(mailto|tel|sms|javascript):/i.test(href)) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!dirtyRef.current()) return;
      // Hold the click, save, then go where it was going.
      e.preventDefault();
      e.stopPropagation();
      if (savingRef.current) return;
      savingRef.current = true;
      void (async () => {
        let ok = false;
        try { ok = await saveRef.current(); } catch { ok = false; }
        savingRef.current = false;
        if (ok) router.push(url.pathname + url.search + url.hash);
      })();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current()) return;
      e.preventDefault();
      // Chrome still needs returnValue set to show the prompt.
      e.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [router]);
}
