import { describe, expect, it } from "vitest";
import { effectiveState } from "./offers";

/**
 * The 24-hour lapse, at the level the board reasons about it.
 *
 * The full board builder needs a Supabase client, so these cover the rule the
 * tray note depends on: an offer nobody answered reads as expired the moment
 * its clock runs out, whether or not a sweep has flipped the stored state yet.
 */
const offer = (state: string, hoursFromNow: number) => ({
  state,
  expires_at: new Date(Date.now() + hoursFromNow * 3600_000).toISOString(),
});

describe("an offer nobody answered", () => {
  it("reads as expired once its 24 hours are up, before any sweep runs", () => {
    expect(effectiveState(offer("offered", -1) as never)).toBe("expired");
  });

  it("is still live inside the window", () => {
    expect(effectiveState(offer("offered", 3) as never)).toBe("offered");
  });

  it("does not retrospectively expire one they already accepted", () => {
    // The clock only governs an unanswered offer — an acceptance stands.
    expect(effectiveState(offer("accepted", -48) as never)).toBe("accepted");
  });

  it("leaves a declined offer declined", () => {
    expect(effectiveState(offer("declined", -48) as never)).toBe("declined");
  });
});
