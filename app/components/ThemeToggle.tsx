"use client";

import { useEffect, useState } from "react";
import { THEME_COOKIE, type UiTheme } from "@/lib/theme/cookie";

/**
 * Dark or light (Tom, 7 Sep for the CRM; 8 Sep for Projects and Payments —
 * "light and dark mode for invoicing and the projects view to match with the
 * CRM"). The choice rides a cookie so the server renders the right palette on
 * the next load (no flash), and localStorage so a signed-out browser remembers
 * it too. The palette itself is CSS variables on `[data-theme]` of the
 * surface's root — `.crm`, `.pc`, `.invx` — every screen inside follows.
 */
export default function ThemeToggle({ initial, rootSelector = ".crm", className = "themebtn" }: { initial: UiTheme; rootSelector?: string; className?: string }) {
  const [theme, setTheme] = useState<UiTheme>(initial);

  useEffect(() => {
    // A browser that chose before the cookie existed.
    try {
      const saved = window.localStorage.getItem(THEME_COOKIE) as UiTheme | null;
      if (saved && saved !== theme && (saved === "dark" || saved === "light")) apply(saved);
    } catch { /* storage blocked: the cookie still works */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(next: UiTheme) {
    setTheme(next);
    document.querySelectorAll(rootSelector).forEach((el) => el.setAttribute("data-theme", next));
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    try { window.localStorage.setItem(THEME_COOKIE, next); } catch { /* ignore */ }
  }

  const next: UiTheme = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className={className} onClick={() => apply(next)} data-testid="theme-toggle"
      aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
      <span className="themelbl">{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}
