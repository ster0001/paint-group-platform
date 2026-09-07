import { describe, expect, it } from "vitest";
import { at, blockIsFree, freeStarts, offeredWindows, parseWindowKey, pickSlot, windowLabel } from "./availability";
import { DEFAULT_VISITS_SETTINGS, mergeVisitsSettings, type StaffAvailability } from "./types";

// Monday 7 Sep 2026, 10:00 Melbourne (AEST, +10).
const NOW = at("2026-09-07", "10:00");
const S = DEFAULT_VISITS_SETTINGS;
const tom: StaffAvailability = { staffId: "tom", name: "Tom", takesVisits: true, days: [1, 2, 3, 4, 5], dayStart: "08:30", dayEnd: "17:00", visitMinutes: 60, zone: "melbourne-metro" };
const sam: StaffAvailability = { ...tom, staffId: "sam", name: "Sam", days: [2, 4], dayStart: "13:00", dayEnd: "18:00" };

describe("offeredWindows — zone half-days from real availability", () => {
  it("offers morning and afternoon on working days, skipping anything inside the cutoff", () => {
    const w = offeredWindows([tom], [], S, NOW);
    // Monday's windows end before now + 24h; Tuesday morning ends 12:00 Tue = 26h away → offered.
    expect(w[0].key).toBe("2026-09-08|am");
    expect(w[0].label).toBe("Tue 8 Sep · morning (9–12)");
    expect(w[1].key).toBe("2026-09-08|pm");
    // Ten business days = Tue 8 … Mon 21 Sep, weekends skipped.
    const dates = [...new Set(w.map((x) => x.date))];
    expect(dates).toHaveLength(10);
    expect(dates).not.toContain("2026-09-12");
    expect(dates[dates.length - 1]).toBe("2026-09-21");
  });

  it("an estimator who only works afternoons on Tuesdays adds nothing to a Monday and only the pm on Tuesday", () => {
    const w = offeredWindows([sam], [], S, NOW);
    expect(w.every((x) => x.part === "pm")).toBe(true);
    expect(w.map((x) => x.date).slice(0, 2)).toEqual(["2026-09-08", "2026-09-10"]);
  });

  it("a window full of bookings is not offered; the freer estimator is listed first", () => {
    const busy = [
      // Tom: Tuesday morning solid 09:00–12:00.
      { staffId: "tom", startsAt: at("2026-09-08", "09:00").toISOString(), endsAt: at("2026-09-08", "12:00").toISOString() },
      // Sam: one visit Tuesday pm.
      { staffId: "sam", startsAt: at("2026-09-08", "13:00").toISOString(), endsAt: at("2026-09-08", "14:00").toISOString() },
    ];
    const w = offeredWindows([tom, sam], busy, S, NOW);
    expect(w.find((x) => x.key === "2026-09-08|am")).toBeUndefined();
    const pm = w.find((x) => x.key === "2026-09-08|pm")!;
    expect(pm.staffIds).toEqual(["tom", "sam"]);
  });

  it("nobody takes visits → nothing offered", () => {
    expect(offeredWindows([{ ...tom, takesVisits: false }], [], S, NOW)).toEqual([]);
  });
});

describe("pickSlot — a window becomes an estimator and a real block", () => {
  it("earliest free block of the estimator with the most room", () => {
    const busy = [{ staffId: "tom", startsAt: at("2026-09-08", "09:00").toISOString(), endsAt: at("2026-09-08", "10:00").toISOString() }];
    const slot = pickSlot("2026-09-08|am", [tom], busy, S, NOW)!;
    expect(slot.staffId).toBe("tom");
    expect(new Date(slot.startsAt).toISOString()).toBe(at("2026-09-08", "10:00").toISOString());
    expect(new Date(slot.endsAt).toISOString()).toBe(at("2026-09-08", "11:00").toISOString());
  });

  it("a window that filled since it was offered returns null", () => {
    const busy = [{ staffId: "tom", startsAt: at("2026-09-08", "09:00").toISOString(), endsAt: at("2026-09-08", "12:00").toISOString() }];
    expect(pickSlot("2026-09-08|am", [tom], busy, S, NOW)).toBeNull();
    expect(pickSlot("junk", [tom], [], S, NOW)).toBeNull();
  });

  it("freeStarts respects the visit length against the window end", () => {
    const starts = freeStarts("tom", at("2026-09-08", "09:00"), at("2026-09-08", "12:00"), 60, []);
    expect(starts[0].toISOString()).toBe(at("2026-09-08", "09:00").toISOString());
    expect(starts[starts.length - 1].toISOString()).toBe(at("2026-09-08", "11:00").toISOString());
  });

  it("blockIsFree is the same overlap rule the database enforces", () => {
    const busy = [{ staffId: "tom", startsAt: at("2026-09-08", "09:00").toISOString(), endsAt: at("2026-09-08", "10:00").toISOString() }];
    expect(blockIsFree("tom", at("2026-09-08", "09:30").toISOString(), at("2026-09-08", "10:30").toISOString(), busy)).toBe(false);
    expect(blockIsFree("tom", at("2026-09-08", "10:00").toISOString(), at("2026-09-08", "11:00").toISOString(), busy)).toBe(true);
    expect(blockIsFree("sam", at("2026-09-08", "09:30").toISOString(), at("2026-09-08", "10:30").toISOString(), busy)).toBe(true);
  });
});

describe("settings and keys", () => {
  it("mergeVisitsSettings clamps and falls back", () => {
    expect(mergeVisitsSettings(null)).toEqual(DEFAULT_VISITS_SETTINGS);
    expect(mergeVisitsSettings({ horizonDays: 500, windows: { am: ["08:00", "11:00"] } }))
      .toMatchObject({ horizonDays: 60, windows: { am: ["08:00", "11:00"], pm: ["13:00", "16:00"] } });
  });
  it("window keys round-trip and labels read in Melbourne time", () => {
    expect(parseWindowKey("2026-09-08|pm")).toEqual({ date: "2026-09-08", part: "pm" });
    expect(windowLabel("2026-09-08", "pm", S)).toBe("Tue 8 Sep · afternoon (1–4)");
  });
});
