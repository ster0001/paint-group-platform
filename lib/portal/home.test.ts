import { describe, expect, it } from "vitest";
import { dayOfJob, homeState, type PortalEstimate, type PortalWorkOrder } from "./home";

const PHONE = "(03) 9000 0000";
const TODAY = "2026-08-27";

function est(over: Partial<PortalEstimate>): PortalEstimate {
  return {
    id: over.id ?? "e1",
    title: "12 Acacia Street",
    status: "draft",
    source: "customer_intake",
    total_cents: null,
    share_token: null,
    sent_at: null,
    created_at: "2026-08-20T00:00:00Z",
    ...over,
  };
}
function wo(over: Partial<PortalWorkOrder>): PortalWorkOrder {
  return { estimate_id: "e1", stage: "in_progress", start_date: null, end_date: null, ...over };
}

describe("homeState — one headline, one primary action, by precedence", () => {
  it("no history at all: welcome, CTA into the wizard", () => {
    const s = homeState([], [], TODAY, PHONE);
    expect(s.key).toBe("welcome");
    expect(s.cta.href).toBe("/estimate");
  });

  it("a saved draft: honest holding copy, CTA is the phone (never a dead end)", () => {
    const s = homeState([est({})], [], TODAY, PHONE);
    expect(s.key).toBe("estimate_saved");
    expect(s.cta.href).toBe("tel:(03)90000000");
  });

  it("no phone configured: the CTA still goes somewhere, never tel:nothing", () => {
    const s = homeState([est({})], [], TODAY, "");
    expect(s.cta.href).toBe("/account/messages");
  });

  it("a sent estimate beats a draft, shows the price and links the token view", () => {
    const s = homeState(
      [est({ id: "e2", status: "sent", share_token: "tok123", total_cents: 845_000 }), est({})],
      [],
      TODAY,
      PHONE,
    );
    expect(s.key).toBe("estimate_ready");
    expect(s.headline).toContain("$8,450.00");
    expect(s.cta.href).toBe("/e/tok123");
  });

  it("accepted with a pre-start work order reads as booked", () => {
    const s = homeState([est({ status: "accepted" })], [wo({ stage: "pre_start", start_date: "2026-09-01" })], TODAY, PHONE);
    expect(s.key).toBe("booked");
    expect(s.chip).toContain("2026-09-01");
  });

  it("an in-progress job beats everything below it and carries Day N of M", () => {
    const s = homeState(
      [est({ status: "accepted" }), est({ id: "e2", status: "sent", share_token: "t" })],
      [wo({ start_date: "2026-08-25", end_date: "2026-08-30" })],
      TODAY,
      PHONE,
    );
    expect(s.key).toBe("underway");
    expect(s.chip).toBe("Day 3 of 6");
    expect(s.headline).toContain("12 Acacia Street");
    expect(s.cta.href).toBe("/account/project");
  });

  it("walkthrough outranks in-progress", () => {
    const s = homeState(
      [est({ status: "accepted" }), est({ id: "e2", status: "accepted" })],
      [wo({ stage: "walkthrough" }), wo({ estimate_id: "e2", stage: "in_progress" })],
      TODAY,
      PHONE,
    );
    expect(s.key).toBe("walkthrough");
  });

  it("a closed job with nothing newer reads as finished, records kept", () => {
    const s = homeState([est({ status: "accepted" })], [wo({ stage: "closed" })], TODAY, PHONE);
    expect(s.key).toBe("finished");
  });

  it("a work order for someone else's estimate is ignored", () => {
    const s = homeState([est({})], [wo({ estimate_id: "not-mine" })], TODAY, PHONE);
    expect(s.key).toBe("estimate_saved");
  });

  it("Untitled quotes never leak into the headline", () => {
    const s = homeState([est({ title: "Untitled quote", status: "accepted" })], [wo({ stage: "in_progress" })], TODAY, PHONE);
    expect(s.headline).toBe("Your painting is underway");
  });
});

describe("dayOfJob — Melbourne calendar days, inclusive", () => {
  it("first day is Day 1", () => expect(dayOfJob("2026-08-27", "2026-08-29", TODAY)).toBe("Day 1 of 3"));
  it("mid-job counts inclusively", () => expect(dayOfJob("2026-08-25", "2026-08-30", TODAY)).toBe("Day 3 of 6"));
  it("before the start: nothing", () => expect(dayOfJob("2026-08-28", "2026-08-30", TODAY)).toBeNull());
  it("after the end: nothing", () => expect(dayOfJob("2026-08-20", "2026-08-26", TODAY)).toBeNull());
  it("missing dates: nothing", () => expect(dayOfJob(null, "2026-08-30", TODAY)).toBeNull());
});
