import { describe, expect, it } from "vitest";
import {
  busyReason,
  continueState,
  establishSession,
  planUploadLabel,
  SESSION_ATTEMPTS,
  type SessionPhase,
} from "./session";

/** No real clock in any of these — the backoff and the deadline are injected. */
const instant = async () => {};

/** A promise that never settles: the stalled phone request S0 was really about. */
const stalls = () => new Promise<boolean>(() => {});

describe("establishSession — the retry path", () => {
  it("returns ready on the first attempt when sign-in works", async () => {
    let calls = 0;
    const out = await establishSession(async () => { calls++; return true; }, { delay: instant });
    expect(out).toEqual({ phase: "ready" });
    expect(calls).toBe(1);
  });

  it("retries a failed sign-in and succeeds on a later attempt", async () => {
    let calls = 0;
    const out = await establishSession(async () => { calls++; return calls === 3; }, { delay: instant });
    expect(out).toEqual({ phase: "ready" });
    expect(calls).toBe(3);
  });

  it("gives up after the attempt budget and reports how many it spent", async () => {
    let calls = 0;
    const out = await establishSession(async () => { calls++; return false; }, { delay: instant });
    expect(out).toEqual({ phase: "failed", reason: "error", attempts: SESSION_ATTEMPTS });
    expect(calls).toBe(SESSION_ATTEMPTS);
  });

  it("treats a thrown sign-in as a retryable failure, not a crash", async () => {
    let calls = 0;
    const out = await establishSession(async () => {
      calls++;
      if (calls < 2) throw new Error("network");
      return true;
    }, { delay: instant });
    expect(out).toEqual({ phase: "ready" });
    expect(calls).toBe(2);
  });

  it("waits the backoff between attempts, and not before the first", async () => {
    const waited: number[] = [];
    await establishSession(async () => false, {
      delay: async (ms) => { waited.push(ms); },
      attempts: 3,
      timeoutMs: 9_999,
      retryDelaysMs: [10, 20],
    });
    // Each attempt arms one deadline (9999); the two backoffs sit between them.
    expect(waited.filter((m) => m !== 9_999)).toEqual([10, 20]);
  });
});

describe("establishSession — the timeout path", () => {
  it("a request that never settles becomes a failure, not a spinner for ever", async () => {
    const out = await establishSession(stalls, { delay: instant });
    expect(out).toEqual({ phase: "failed", reason: "timeout", attempts: SESSION_ATTEMPTS });
  });

  it("recovers when a later attempt beats the deadline", async () => {
    let calls = 0;
    const out = await establishSession(() => {
      calls++;
      return calls < 2 ? stalls() : Promise.resolve(true);
    }, { delay: instant });
    expect(out).toEqual({ phase: "ready" });
    expect(calls).toBe(2);
  });

  it("reports the last failure kind, so a stall is distinguishable from a refusal", async () => {
    let calls = 0;
    const stallThenRefuse = await establishSession(() => {
      calls++;
      return calls === 1 ? stalls() : Promise.resolve(false);
    }, { delay: instant });
    expect(stallThenRefuse).toMatchObject({ phase: "failed", reason: "error" });
  });

  it("does not mistake a genuine false for the deadline firing", async () => {
    const out = await establishSession(async () => false, { delay: instant, attempts: 1 });
    expect(out).toEqual({ phase: "failed", reason: "error", attempts: 1 });
  });
});

describe("establishSession — speaking up before the whole budget is spent", () => {
  it("reports the first failure while another attempt is still coming", async () => {
    const seen: Array<{ attempt: number; willRetry: boolean; reason: string }> = [];
    await establishSession(stalls, {
      delay: instant,
      onAttemptFailed: (i) => seen.push({ attempt: i.attempt, willRetry: i.willRetry, reason: i.reason }),
    });
    expect(seen).toEqual([
      { attempt: 1, willRetry: true, reason: "timeout" },
      { attempt: 2, willRetry: true, reason: "timeout" },
      { attempt: 3, willRetry: false, reason: "timeout" },
    ]);
  });

  it("fires before the backoff, not after it — the message must beat the wait", async () => {
    const order: string[] = [];
    await establishSession(async () => false, {
      attempts: 2,
      timeoutMs: 9_999,
      retryDelaysMs: [50],
      delay: async (ms) => { if (ms !== 9_999) order.push(`wait:${ms}`); },
      onAttemptFailed: (i) => order.push(`told:${i.attempt}`),
    });
    expect(order).toEqual(["told:1", "wait:50", "told:2"]);
  });

  it("says nothing when the session lands first time", async () => {
    let told = 0;
    const out = await establishSession(async () => true, { delay: instant, onAttemptFailed: () => { told++; } });
    expect(out).toEqual({ phase: "ready" });
    expect(told).toBe(0);
  });

  it("marks the last attempt willRetry:false so the note yields to the error", async () => {
    const last: boolean[] = [];
    await establishSession(async () => false, { delay: instant, onAttemptFailed: (i) => last.push(i.willRetry) });
    expect(last[last.length - 1]).toBe(false);
    expect(last.filter(Boolean).length).toBe(SESSION_ATTEMPTS - 1);
  });
});

describe("the button label tells the truth about why it is disabled", () => {
  const failed: SessionPhase = "failed";
  const connecting: SessionPhase = "connecting";
  const ready: SessionPhase = "ready";

  it("says Uploading… only for a file the customer actually chose", () => {
    expect(planUploadLabel({ planFileCount: 0, uploading: true })).toBe("Uploading…");
  });

  it("never says Uploading… when the session failed and no file was chosen", () => {
    const label = planUploadLabel({ planFileCount: 0, uploading: false });
    expect(label).not.toBe("Uploading…");
    expect(label).toBe("📐 Upload a floorplan — photo or PDF");
  });

  it("never says Uploading… while the session is still connecting", () => {
    expect(planUploadLabel({ planFileCount: 0, uploading: false })).not.toBe("Uploading…");
  });

  it("separates the two reasons a control is busy", () => {
    expect(busyReason({ uploading: true, sessionPhase: ready })).toBe("uploading");
    expect(busyReason({ uploading: false, sessionPhase: connecting })).toBe("session");
    expect(busyReason({ uploading: false, sessionPhase: failed })).toBe("session");
    expect(busyReason({ uploading: false, sessionPhase: ready })).toBe(null);
    // A real upload wins — it is the one the customer started.
    expect(busyReason({ uploading: true, sessionPhase: connecting })).toBe("uploading");
  });

  it("Continue explains itself: Uploading… for a file, Connecting… for the session", () => {
    expect(continueState({ uploading: true, sessionPhase: ready }))
      .toEqual({ disabled: true, note: "Uploading…" });
    expect(continueState({ uploading: false, sessionPhase: connecting }))
      .toEqual({ disabled: true, note: "Connecting…" });
  });

  it("Continue stays disabled but silent once the error and Try again are on screen", () => {
    expect(continueState({ uploading: false, sessionPhase: failed }))
      .toEqual({ disabled: true, note: null });
  });

  it("Continue is usable once the session lands and nothing is uploading", () => {
    expect(continueState({ uploading: false, sessionPhase: ready }))
      .toEqual({ disabled: false, note: null });
  });
});
