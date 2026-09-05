import { describe, it, expect } from "vitest";
import { addBusinessHours, melbourneInstant, melbourneParts, nextBusinessMorning, nextOpen } from "./businessHours";

const local = (d: Date) => { const p = melbourneParts(d); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")} ${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`; };

describe("Melbourne business hours", () => {
  it("measures the zone rather than assuming it: AEST in July, AEDT in December", () => {
    expect(melbourneInstant(2026, 7, 1, 9).toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(melbourneInstant(2026, 12, 1, 9).toISOString()).toBe("2026-11-30T22:00:00.000Z");
  });
  it("4 business hours from Friday 3pm lands Monday 11am (two before close, two after Monday opens)", () => {
    expect(local(addBusinessHours(melbourneInstant(2026, 9, 4, 15), 4))).toBe("2026-09-07 11:00"); // Fri 4 Sep → Mon 7 Sep
  });
  it("2 business hours from a Sunday night is Monday 11am; from Tuesday 10am it is noon", () => {
    expect(local(addBusinessHours(melbourneInstant(2026, 9, 6, 22), 2))).toBe("2026-09-07 11:00");
    expect(local(addBusinessHours(melbourneInstant(2026, 9, 8, 10), 2))).toBe("2026-09-08 12:00");
  });
  it("next business morning skips the weekend, and the DST changeover keeps 9:00 on the clock", () => {
    expect(local(nextBusinessMorning(melbourneInstant(2026, 9, 4, 11)))).toBe("2026-09-07 09:00");
    // Sat 3 Oct 2026 → clocks go forward Sun 4 Oct 02:00; Monday 5 Oct 09:00 AEDT
    const mon = nextBusinessMorning(melbourneInstant(2026, 10, 3, 14));
    expect(local(mon)).toBe("2026-10-05 09:00");
    expect(mon.toISOString()).toBe("2026-10-04T22:00:00.000Z");
    // Sat 4 Apr 2026 → clocks go back Sun 5 Apr 03:00; Monday 6 Apr 09:00 AEST
    const apr = nextBusinessMorning(melbourneInstant(2026, 4, 4, 14));
    expect(local(apr)).toBe("2026-04-06 09:00");
    expect(apr.toISOString()).toBe("2026-04-05T23:00:00.000Z");
  });
  it("nextOpen is identity inside hours and 9:00 before them", () => {
    const inHours = melbourneInstant(2026, 9, 8, 13, 30);
    expect(nextOpen(inHours).getTime()).toBe(inHours.getTime());
    expect(local(nextOpen(melbourneInstant(2026, 9, 8, 7)))).toBe("2026-09-08 09:00");
  });
});
