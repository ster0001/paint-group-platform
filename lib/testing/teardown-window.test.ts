import { describe, expect, it } from "vitest";
import { resolveTeardownWindow } from "./teardown-window";

/**
 * The case that matters is the first one: on 19 Sep 2026 a run whose
 * global-setup was REFUSED by the run-lock still ran its global-teardown,
 * fell back to the machine-wide marker file, and deleted 22 users, 12
 * estimates and 3 accounts belonging to the run that held the lock.
 */
describe("resolveTeardownWindow", () => {
  const RUN = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const T = "2026-09-19T04:40:21.088Z";

  it("deletes NOTHING when global-setup did not complete in this process", () => {
    // Exactly the refused run: no run id, no env window, and a marker file
    // left on the machine by somebody else's run.
    const w = resolveTeardownWindow({
      runId: undefined,
      envSince: undefined,
      marker: { startedAt: T, runId: OTHER },
    });
    expect(w.act).toBe(false);
    expect(w).toMatchObject({ reason: expect.stringContaining("global-setup did not complete") });
  });

  it("deletes nothing when the marker belongs to another run, even with a run id of our own", () => {
    const w = resolveTeardownWindow({ runId: RUN, envSince: undefined, marker: { startedAt: T, runId: OTHER } });
    expect(w.act).toBe(false);
    expect(w).toMatchObject({ reason: expect.stringContaining(OTHER) });
  });

  it("uses the environment first — same process, same run", () => {
    expect(resolveTeardownWindow({ runId: RUN, envSince: T, marker: null })).toEqual({ act: true, since: T });
  });

  it("falls back to the marker file when it carries THIS run's id", () => {
    const w = resolveTeardownWindow({ runId: RUN, envSince: undefined, marker: { startedAt: T, runId: RUN } });
    expect(w).toEqual({ act: true, since: T });
  });

  it("deletes nothing on a marker with no run id — an older checkout's file", () => {
    // The shape written before this guard existed. It may well be this run's,
    // but it cannot be SHOWN to be, and the cost of guessing wrong is another
    // run's live users.
    const w = resolveTeardownWindow({ runId: RUN, envSince: undefined, marker: { startedAt: T } });
    expect(w.act).toBe(false);
    expect(w).toMatchObject({ reason: expect.stringContaining("no run id") });
  });

  it("deletes nothing when there is no marker at all", () => {
    expect(resolveTeardownWindow({ runId: RUN, envSince: undefined, marker: null }).act).toBe(false);
  });

  it("deletes nothing when this run's marker has no start time", () => {
    const w = resolveTeardownWindow({ runId: RUN, envSince: undefined, marker: { runId: RUN } });
    expect(w.act).toBe(false);
    expect(w).toMatchObject({ reason: expect.stringContaining("no start time") });
  });

  it("treats blank and whitespace-only values as absent, not as a window", () => {
    expect(resolveTeardownWindow({ runId: "   ", envSince: T, marker: null }).act).toBe(false);
    expect(resolveTeardownWindow({ runId: RUN, envSince: "  ", marker: { startedAt: "  ", runId: RUN } }).act).toBe(false);
  });

  it("ignores a marker whose fields are not strings", () => {
    const w = resolveTeardownWindow({
      runId: RUN, envSince: undefined,
      marker: { startedAt: 1_758_000_000 as unknown, runId: { id: RUN } as unknown },
    });
    expect(w.act).toBe(false);
  });
});
