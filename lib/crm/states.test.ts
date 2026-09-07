import { describe, expect, it } from "vitest";
import { delayEnded, delayHolds, isQuiet, stateChip } from "./states";

const NOW = new Date("2026-09-07T10:00:00+10:00");
const later = "2026-10-01T00:00:00+10:00";
const earlier = "2026-09-01T00:00:00+10:00";

describe("relationship states (CRM v2 P4)", () => {
  it("a delay holds until its date, then it has ended", () => {
    expect(delayHolds("delayed", later, NOW)).toBe(true);
    expect(delayHolds("delayed", earlier, NOW)).toBe(false);
    expect(delayEnded("delayed", earlier, NOW)).toBe(true);
    expect(delayEnded("delayed", later, NOW)).toBe(false);
    expect(delayEnded("active", earlier, NOW)).toBe(false);
  });

  it("do-not-contact, archived and a holding delay are quiet; lost and an ended delay are not", () => {
    expect(isQuiet("do_not_contact", null, NOW)).toBe(true);
    expect(isQuiet("archived", null, NOW)).toBe(true);
    expect(isQuiet("delayed", later, NOW)).toBe(true);
    expect(isQuiet("delayed", earlier, NOW)).toBe(false);
    expect(isQuiet("lost", null, NOW)).toBe(false);
    expect(isQuiet("active", null, NOW)).toBe(false);
  });

  it("wears the chip the office reads, in the ruled wording", () => {
    expect(stateChip("delayed", later, null, NOW)).toBe("Delayed to 1 Oct");
    expect(stateChip("delayed", earlier, null, NOW)).toBe("Delay ended");
    expect(stateChip("lost", null, "too_expensive", NOW)).toBe("Lost — Too expensive");
    expect(stateChip("lost", null, "just_planning", NOW)).toBe("Lost — Was just planning");
    expect(stateChip("do_not_contact", null, null, NOW)).toBe("Do not contact");
    expect(stateChip("active", null, null, NOW)).toBeNull();
  });
});
