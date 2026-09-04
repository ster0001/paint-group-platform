import { test, expect } from "vitest";
import { STORY_BEATS, STORY_END_MS, UPDATE_TEXT, storyFinalState, storyStateAt } from "./progressStory";

test("eight beats, 22 s total, in the brief's order", () => {
  expect(STORY_BEATS.map((b) => b.at)).toEqual([0, 2000, 5000, 8000, 11000, 14500, 17500, 20000]);
  expect(STORY_END_MS).toBeGreaterThanOrEqual(21500);
  expect(STORY_END_MS).toBeLessThanOrEqual(22500);
});

test("captions and phone beats never drift: at every beat boundary both flip on the same millisecond", () => {
  const checks: Array<[number, (s: ReturnType<typeof storyStateAt>) => boolean]> = [
    [2000, (s) => s.banner?.bold === "Felipe M." && s.progress === 8],
    [5000, (s) => s.photos === 2 && s.areas.living.state === "prepped"],
    [8000, (s) => s.day === 3 && s.areas.living.state === "done" && s.progress === 48],
    [11000, (s) => s.update !== null],
    [14500, (s) => s.variation === "waiting" && s.update === null],
    [17500, (s) => s.day === 5 && s.progress === 100],
    [20000, (s) => s.signed],
  ];
  for (const [at, ok] of checks) {
    const before = storyStateAt(at - 1);
    const on = storyStateAt(at);
    const idxBefore = STORY_BEATS.findIndex((b) => b.at === at) - 1;
    expect(before.captionIndex).toBe(idxBefore);
    expect(on.captionIndex).toBe(idxBefore + 1);
    expect(ok(before)).toBe(false);
    expect(ok(on)).toBe(true);
  }
});

test("the beats' inner choreography", () => {
  expect(storyStateAt(8399).areas.hall.state).toBe("todo");
  expect(storyStateAt(8400).areas.hall.state).toBe("prepped");
  // the update types itself at 22 ms/char and is complete before the variation beat
  expect(storyStateAt(11000 + 22 * 10).update).toBe(UPDATE_TEXT.slice(0, 10));
  expect(storyStateAt(14499).update).toBe(UPDATE_TEXT);
  // approve presses itself then flips
  expect(storyStateAt(15999).variation).toBe("waiting");
  expect(storyStateAt(16000).variation).toBe("pressed");
  expect(storyStateAt(16200).variation).toBe("approved");
  // remaining areas tick 0.3 s apart, then the walkthrough banner
  expect(storyStateAt(17500).areas.hall.state).toBe("done");
  expect(storyStateAt(17500).areas.bed1.state).toBe("todo");
  expect(storyStateAt(17800).areas.bed1.state).toBe("done");
  expect(storyStateAt(18400).areas.kitchen.state).toBe("done");
  expect(storyStateAt(18900).banner?.bold).toBe("Walkthrough booked");
  expect(storyStateAt(20000).banner).toBeNull();
});

test("the end state is Day 5, everything done, signed off; before play nothing has happened", () => {
  const end = storyFinalState();
  expect(end.done).toBe(true);
  expect(end.day).toBe(5);
  expect(Object.values(end.areas).every((a) => a.state === "done")).toBe(true);
  expect(end.signed).toBe(true);
  const pre = storyStateAt(-1);
  expect(pre.captionIndex).toBe(-1);
  expect(pre.progress).toBe(0);
});

test("nothing in the script mentions remote sign-off, ratings or start dates", () => {
  const text = JSON.stringify(STORY_BEATS) + UPDATE_TEXT;
  expect(text).not.toMatch(/remote|rating|\bstars?\b|start date|next available/i);
});
