import { describe, expect, it } from "vitest";
import { areaPhrase, composeUpdate, greeting, groupTicks, listPhrase, longDateMelbourne, opensWithGreeting, plainSurface, smsSummary, type TickEvent } from "./updates";

const tick = (heading: string, label: string, to: string, from = "todo"): TickEvent =>
  ({ heading, label, from, to });

// Fixed Melbourne afternoon, so the greeting is deterministic. The suite runs
// under TZ=Australia/Melbourne (see vitest config / npm script).
const afternoon = new Date("2026-08-21T15:30:00+10:00");
const morning = new Date("2026-08-21T08:15:00+10:00");
const evening = new Date("2026-08-21T19:05:00+10:00");

describe("the day with nothing in it", () => {
  it("writes no update at all rather than filling the silence", () => {
    expect(composeUpdate({ customerFirstName: "Melissa", ticks: [], photoCount: 0, now: afternoon }))
      .toBeNull();
  });

  it("writes nothing when the only movement was an undone mis-tap", () => {
    const undone = [tick("Front", "Walls", "todo", "prepped")];
    expect(composeUpdate({ customerFirstName: "Melissa", ticks: undone, photoCount: 0, now: afternoon }))
      .toBeNull();
  });

  it("does not invent photos it does not have", () => {
    const text = composeUpdate({
      customerFirstName: "Melissa", ticks: [tick("Front", "Walls", "done")],
      photoCount: 0, now: afternoon,
    });
    expect(text).not.toContain("Photos");
  });
});

describe("a real day's work", () => {
  const ticks = [
    tick("Front", "Walls — weatherboard and render", "done"),
    tick("Front", "Windows × 3", "done"),
    tick("Front", "Entry door", "done"),
    tick("Left", "Walls — weatherboard", "prepped"),
  ];

  it("reads as short labelled sections a customer can scan (Tom, 21 Oct 2026)", () => {
    const text = composeUpdate({ customerFirstName: "Melissa", ticks, photoCount: 6, now: afternoon })!;
    expect(text).toBe([
      "Hi Melissa,",
      "Here is today's progress (Friday 21 August):",
      "Finished today\n• Front of the house: walls (weatherboard and render), 3 windows and entry door",
      "Prepped and ready for paint\n• Left-hand side: walls (weatherboard) — we will be back on these tomorrow",
      "6 new photos are on your job page.",
      "Any questions, just reply to this message.\nThe Paint Group team",
    ].join("\n\n"));
  });

  it("leaves out a section the day did not earn", () => {
    const text = composeUpdate({ customerFirstName: "Melissa", ticks: [tick("Front", "Walls", "done")], photoCount: 1, now: afternoon })!;
    expect(text).toContain("Finished today");
    expect(text).not.toContain("Prepped and ready");
    expect(text).toContain("1 new photo is on your job page.");
  });

  it("turns tick labels into words a customer uses", () => {
    expect(plainSurface("Walls — weatherboard and render")).toBe("walls (weatherboard and render)");
    expect(plainSurface("Windows × 3")).toBe("3 windows");
    expect(plainSurface("Entry door")).toBe("entry door");
    expect(plainSurface("Ceiling")).toBe("ceiling");
  });

  it("dates the update by the Melbourne calendar", () => {
    expect(longDateMelbourne(new Date("2026-08-21T15:30:00+10:00"))).toBe("Friday 21 August");
    // 9am UTC on the 21st is already the 21st in Melbourne; 3pm UTC is the 22nd.
    expect(longDateMelbourne(new Date("2026-08-21T15:00:00Z"))).toBe("Saturday 22 August");
  });

  it("shortens itself for a text message without the sign-off", () => {
    const text = composeUpdate({ customerFirstName: "Melissa", ticks, photoCount: 6, now: afternoon })!;
    const sms = smsSummary(text);
    expect(sms.startsWith("Hi Melissa, Here is today's progress")).toBe(true);
    expect(sms).toContain("Finished today Front of the house: walls");
    expect(sms).not.toContain("\n");
    expect(sms).not.toContain("The Paint Group team");
    expect(sms.length).toBeLessThanOrEqual(240);
  });

  it("names only surfaces that were actually ticked", () => {
    const text = composeUpdate({ customerFirstName: "Melissa", ticks, photoCount: 0, now: afternoon })!;
    expect(text).toContain("3 windows");
    expect(text).not.toContain("Right");
    expect(text).not.toContain("Fence");
  });

  it("counts a surface once even when it was ticked twice", () => {
    const twice = [
      tick("Front", "Walls", "prepped"),
      tick("Front", "Walls", "done", "prepped"),
    ];
    const groups = groupTicks(twice);
    expect(groups).toHaveLength(1);
    expect(groups[0].done).toEqual(["Walls"]);
    expect(groups[0].prepped).toEqual([]);
  });

  it("greets by name, never by the time of day (Tom, 14 Oct 2026)", () => {
    for (const when of [morning, afternoon, evening]) {
      expect(greeting(when, "Melissa")).toBe("Hi Melissa");
    }
    const text = composeUpdate({ customerFirstName: "Melissa", ticks, photoCount: 0, now: evening })!;
    expect(text).not.toMatch(/good (morning|afternoon|evening)/i);
  });

  it("copes with no name rather than writing 'Hi ,'", () => {
    expect(greeting(afternoon, "")).toBe("Hi there");
    const text = composeUpdate({
      customerFirstName: "", ticks: [tick("Front", "Walls", "done")], photoCount: 0, now: afternoon,
    })!;
    expect(text.startsWith("Hi there,\n\nHere is today's progress")).toBe(true);
  });

  it("tells delivery whether the draft already says hello", () => {
    expect(opensWithGreeting("Hi Melissa — today we completed the front.")).toBe(true);
    expect(opensWithGreeting("Hello Melissa, the front is done.")).toBe(true);
    expect(opensWithGreeting("Good afternoon Melissa — the front is finished.")).toBe(true);
    expect(opensWithGreeting("The front is finished and looks terrific.")).toBe(false);
    expect(opensWithGreeting("Hiding the old colour took two coats.")).toBe(false);
  });
});

describe("how it talks about the house", () => {
  it("says what a person would say", () => {
    expect(areaPhrase("Front")).toBe("the front of the house");
    expect(areaPhrase("Left")).toBe("the left-hand side");
    expect(areaPhrase("Right")).toBe("the right-hand side");
    expect(areaPhrase("Back")).toBe("the back of the house");
  });

  it("leaves an interior room's own name alone", () => {
    expect(areaPhrase("Main bedroom")).toBe("Main bedroom");
  });

  it("joins lists the way English does", () => {
    expect(listPhrase(["walls"])).toBe("walls");
    expect(listPhrase(["walls", "windows"])).toBe("walls and windows");
    expect(listPhrase(["walls", "windows", "doors"])).toBe("walls, windows and doors");
    expect(listPhrase([])).toBe("");
  });

  it("keeps the tone plain rather than matey", () => {
    const text = composeUpdate({
      customerFirstName: "Melissa",
      ticks: [tick("Front", "Walls", "done")],
      photoCount: 1, now: afternoon,
    })!;
    for (const australianism of ["knocked over", "arvo", "no worries", "mate", "heaps"]) {
      expect(text.toLowerCase()).not.toContain(australianism);
    }
  });
});
