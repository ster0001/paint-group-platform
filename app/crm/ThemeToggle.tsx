"use client";

import { useEffect, useState } from "react";

export type CrmTheme = "dark" | "light";
export const THEME_COOKIE = "crm_theme";

/**
 * Dark or light, for the whole CRM (Tom, 7 Sep). The choice rides a cookie so
 * the server renders the right palette on the next load (no flash), and
 * localStorage so a signed-out browser remembers it too. The palette itself
 * is CSS variables on `.crm[data-theme]` — every screen follows.
 */
export default function ThemeToggle({ initial }: { initial: CrmTheme }) {
  const [theme, setTheme] = useState<CrmTheme>(initial);

  useEffect(() => {
    // A browser that chose before the cookie existed.
    try {
      const saved = window.localStorage.getItem(THEME_COOKIE) as CrmTheme | null;
      if (saved && saved !== theme && (saved === "dark" || saved === "light")) apply(saved);
    } catch { /* storage blocked: the cookie still works */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(next: CrmTheme) {
    setTheme(next);
    document.querySelector(".crm")?.setAttribute("data-theme", next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    try { window.localStorage.setItem(THEME_COOKIE, next); } catch { /* ignore */ }
  }

  const next: CrmTheme = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="themebtn" onClick={() => apply(next)} data-testid="theme-toggle"
      aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
      <span className="themelbl">{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}
