import { melbourneInstant, melbourneParts } from "@/lib/time/businessHours";

/** Client-safe Melbourne date/time helpers for the visit forms. */
export function melbourneLocalParts(iso: string): { date: string; time: string } {
  const p = melbourneParts(new Date(iso));
  const two = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.y}-${two(p.m)}-${two(p.d)}`, time: `${two(p.h)}:${two(p.min)}` };
}

export function melbourneInstantFromLocal(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return melbourneInstant(y, m, d, h || 0, min || 0);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week that holds `date`. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}
