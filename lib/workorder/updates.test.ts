import { describe, expect, it } from "vitest";
import { areaPhrase, composeUpdate, greeting, groupTicks, listPhrase, type TickEvent } from "./updates";

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

  it("reads like a person wrote it", () => {
    const text = composeUpdate({ customerFirstName: "Melissa", ticks, photoCount: 6, now: afternoon })!;
    expect(text).toBe(
      "Good afternoon Melissa — today we completed the front of the house: " +
      "Walls — weatherboard and render, Windows × 3 and Entry door, and we have prepped " +
      "the left-hand side (Walls — weatherboard) and will be back on that tomorrow. " +
      "Photos attached (6).",
    );
  });

  it("names only surfaces that were actually ticked", () => {
    const text = composeUpdate({ customerFirstName: "Melissa", ticks, photoCount: 0, now: afternoon })!;
    expect(text).toContain("Windows × 3");
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

  it("greets by the hour", () => {
    expect(greeting(morning, "Melissa")).toBe("Good morning Melissa");
    expect(greeting(afternoon, "Melissa")).toBe("Good afternoon Melissa");
    expect(greeting(evening, "Melissa")).toBe("Good evening Melissa");
  });

  it("copes with no name rather than writing 'Good afternoon ,'", () => {
    expect(greeting(afternoon, "")).toBe("Good afternoon");
    const text = composeUpdate({
      customerFirstName: "", ticks: [tick("Front", "Walls", "done")], photoCount: 0, now: afternoon,
    })!;
    expect(text.startsWith("Good afternoon — today we completed")).toBe(true);
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
