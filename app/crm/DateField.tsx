/**
 * The CRM's date box moved to app/components/DateField.tsx on 20 Sep 2026 so
 * the home dashboard's custom range could use the same calendar. One
 * component, two surfaces (CLAUDE.md: never fork a component); this file
 * keeps every CRM import path working.
 */
export { default, formatDay, todayDay } from "@/app/components/DateField";
