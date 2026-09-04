import { test, expect } from "vitest";
import {
  GHOST_EXAMPLES, GHOST_HOLD_MS, GHOST_FADE_MS, applyGhostStep, ghostInitial, ghostSchedule, ghostWorstCase, stopGhost,
} from "./ghostEstimator";

test("the four examples alternate home / business in the brief's order", () => {
  expect(GHOST_EXAMPLES.map((e) => e.mode)).toEqual(["home", "business", "home", "business"]);
  expect(GHOST_EXAMPLES[0].price).toBe("$8,400 – $9,600");
});

test("a schedule types every character 38–78 ms apart, then result, hold 3.2 s, fade", () => {
  const ex = GHOST_EXAMPLES[0];
  const steps = ghostSchedule(ex, () => 0.5);
  const types = steps.filter((s) => s.kind === "type");
  expect(types).toHaveLength(ex.address.length);
  for (let i = 1; i < types.length; i++) {
    const gap = types[i].at - types[i - 1].at;
    expect(gap).toBeGreaterThanOrEqual(38);
    expect(gap).toBeLessThanOrEqual(78);
  }
  expect(types[types.length - 1].kind === "type" && types[types.length - 1].text).toBe(ex.address);
  const result = steps.find((s) => s.kind === "result")!;
  const fade = steps.find((s) => s.kind === "fade")!;
  const clear = steps.find((s) => s.kind === "clear")!;
  expect(fade.at - result.at).toBe(GHOST_HOLD_MS);
  expect(clear.at - fade.at).toBe(GHOST_FADE_MS);
  // jitter really varies with the rng
  const fast = ghostSchedule(ex, () => 0).find((s) => s.kind === "result")!.at;
  const slow = ghostSchedule(ex, () => 0.999).find((s) => s.kind === "result")!.at;
  expect(fast).toBeLessThan(slow);
});

test("AC timing: mid-typing within 2 s, a result within 6 s, worst case", () => {
  const w = ghostWorstCase();
  expect(w.firstCharMs).toBeLessThan(2000);
  expect(w.resultMs).toBeLessThan(6000);
});

test("the state machine plays a loop and wraps to the next example", () => {
  let s = ghostInitial;
  for (const step of ghostSchedule(GHOST_EXAMPLES[0], () => 0.5)) s = applyGhostStep(s, step);
  expect(s.status).toBe("waiting");
  expect(s.index).toBe(1);
  expect(s.text).toBe("");
  let last = ghostInitial;
  for (const step of ghostSchedule(GHOST_EXAMPLES[1], () => 0.5)) { last = applyGhostStep(last, step); if (step.kind === "result") break; }
  expect(last.status).toBe("result");
  expect(last.mode).toBe("business");
  expect(last.result?.price).toBe("$3,100 – $3,600");
});

test("stopping empties everything, resets the chip to home, and is final", () => {
  let s = ghostInitial;
  const steps = ghostSchedule(GHOST_EXAMPLES[1], () => 0.5);
  for (const step of steps.slice(0, 10)) s = applyGhostStep(s, step);
  expect(s.text.length).toBeGreaterThan(0);
  expect(s.mode).toBe("business");
  s = stopGhost(s);
  expect(s).toMatchObject({ status: "stopped", text: "", result: null, mode: "home" });
  for (const step of steps.slice(10)) s = applyGhostStep(s, step);
  expect(s.status).toBe("stopped");
  expect(s.text).toBe("");
});
