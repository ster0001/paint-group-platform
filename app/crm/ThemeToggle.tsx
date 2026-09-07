/**
 * The CRM's toggle moved to app/components/ThemeToggle.tsx on 8 Sep so
 * Projects and Payments could share it (one cookie, one choice); the cookie
 * vocabulary is lib/theme/cookie.ts. Kept as a re-export so nothing that
 * imported it here has to move.
 */
export { default } from "@/app/components/ThemeToggle";
export { THEME_COOKIE, themeFromCookie } from "@/lib/theme/cookie";
export type { UiTheme as CrmTheme } from "@/lib/theme/cookie";
