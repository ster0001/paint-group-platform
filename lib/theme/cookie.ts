/**
 * The dark / light choice, shared by every dark-chrome surface (CRM, Projects,
 * Payments). Server-safe on purpose: a "use client" module cannot export a
 * plain function for a layout to call, so the cookie vocabulary lives here
 * and app/components/ThemeToggle.tsx imports it.
 */
export type UiTheme = "dark" | "light";
/** One cookie for all three surfaces — choose once, it follows. */
export const THEME_COOKIE = "crm_theme";

/** The theme a cookie value names — anything but "light" is dark, as before. */
export function themeFromCookie(value: string | undefined): UiTheme {
  return value === "light" ? "light" : "dark";
}
