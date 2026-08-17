/**
 * The booking-offer state machine, as the screens see it.
 *
 * The authoritative machine is in Postgres (`respond_to_offer` re-checks expiry
 * server-side, and a partial unique index enforces one live offer per job).
 * What is tested here is the display half — the rules a stale browser applies —
 * and `suburbOnly`, which decides how much of a customer's address a contractor
 * can see before they have committed to the job.
 */
import { test, expect, vi, afterEach } from "vitest";
import {
  effectiveState,
  isLive,
  isReschedule,
  suburbOnly,
  formatDMY,
  formatCountdown,
  msRemaining,
  expiryFromNow,
  OFFER_WINDOW_HOURS,
  type BookingOffer,
  type OfferState,
} from "./offers.ts";

afterEach(() => vi.useRealTimers());

const NOW = new Date("2026-09-01T09:00:00+10:00");
const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * 3600_000).toISOString();
const offer = (state: OfferState, expiresIn: number): Pick<BookingOffer, "state" | "expires_at"> => ({
  state,
  expires_at: at(expiresIn),
});

// ---- expiry ----------------------------------------------------------------

test("an unanswered offer past its deadline reads as expired", () => {
  vi.setSystemTime(NOW);
  expect(effectiveState(offer("offered", -1))).toBe("expired");
  expect(effectiveState(offer("offered", 1))).toBe("offered");
});

test("a PROPOSAL never lapses — it is waiting on staff", () => {
  vi.setSystemTime(NOW);
  // Expiring a proposal would silently drop a job the contractor answered in
  // time. This is a deliberate rule, not an oversight.
  expect(effectiveState(offer("proposed", -240))).toBe("proposed");
});

test("a settled offer is never rewritten by the clock", () => {
  vi.setSystemTime(NOW);
  for (const s of ["accepted", "declined", "withdrawn", "cancelled", "expired"] as OfferState[]) {
    expect(effectiveState(offer(s, -240))).toBe(s);
  }
});

test("expiry is exact at the boundary", () => {
  vi.setSystemTime(NOW);
  const exactly = { state: "offered" as const, expires_at: NOW.toISOString() };
  expect(effectiveState(exactly)).toBe("offered"); // not yet past
  vi.setSystemTime(new Date(NOW.getTime() + 1));
  expect(effectiveState(exactly)).toBe("expired");
});

test("only offered and proposed hold a job", () => {
  expect(isLive("offered")).toBe(true);
  expect(isLive("proposed")).toBe(true);
  for (const s of ["accepted", "declined", "expired", "withdrawn", "cancelled"] as OfferState[]) {
    expect(isLive(s)).toBe(false);
  }
});

test("a proposal carrying a prior start date is a reschedule of a booked job", () => {
  expect(isReschedule({ prior_start_date: "2026-09-01" })).toBe(true);
  expect(isReschedule({ prior_start_date: null })).toBe(false);
});

test("the offer window is 24 hours", () => {
  vi.setSystemTime(NOW);
  expect(OFFER_WINDOW_HOURS).toBe(24);
  expect(Date.parse(expiryFromNow()) - NOW.getTime()).toBe(24 * 3600_000);
  expect(Date.parse(expiryFromNow(4)) - NOW.getTime()).toBe(4 * 3600_000);
});

// ---- the privacy gate's address rule ---------------------------------------

test("suburbOnly keeps the suburb and drops the street", () => {
  expect(suburbOnly("12 Baker Street, Richmond VIC 3121")).toBe("Richmond");
  expect(suburbOnly("1/40 Chapel St, South Yarra, VIC 3141")).toBe("South Yarra");
  expect(suburbOnly("Unit 3, 22 Smith Road, Kew East VIC 3102")).toBe("Kew East");
});

test("suburbOnly never returns anything containing a street number", () => {
  const addresses = [
    "12 Baker Street, Richmond VIC 3121",
    "1/40 Chapel St, South Yarra, VIC 3141",
    "Unit 3, 22 Smith Road, Kew East VIC 3102",
    "Level 2, 400 Collins Street, Melbourne VIC 3000",
  ];
  for (const a of addresses) expect(suburbOnly(a)).not.toMatch(/\d/);
});

test("an unrecognised address says nothing rather than guessing", () => {
  // The conservative branch matters more than the clever one: a wrong guess
  // here hands out a street address.
  expect(suburbOnly("12 Baker Street")).toBe("Location on acceptance");
  expect(suburbOnly("")).toBe("Location on acceptance");
  expect(suburbOnly(null)).toBe("Location on acceptance");
  expect(suburbOnly(undefined)).toBe("Location on acceptance");
  expect(suburbOnly("   ")).toBe("Location on acceptance");
  expect(suburbOnly("12 Baker Street, 3121")).toBe("Location on acceptance");
});

// ---- display ---------------------------------------------------------------

test("formatDMY reads as dd-mm-yy and does not shift the day", () => {
  expect(formatDMY("2026-09-01")).toBe("01-09-26");
  expect(formatDMY("2026-12-31")).toBe("31-12-26");
  expect(formatDMY(null)).toBe("—");
  expect(formatDMY("")).toBe("—");
});

test("a countdown floors at zero rather than running negative", () => {
  vi.setSystemTime(NOW);
  expect(msRemaining(at(-5))).toBe(0);
  expect(msRemaining(at(2))).toBe(2 * 3600_000);
});

test("the countdown is zero-padded hours:minutes:seconds", () => {
  expect(formatCountdown(0)).toBe("00:00:00");
  expect(formatCountdown(23 * 3600_000 + 41 * 60_000 + 7_000)).toBe("23:41:07");
  expect(formatCountdown(59_999)).toBe("00:00:59");
});
