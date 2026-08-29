import { describe, expect, it } from "vitest";
import { CALL_THRESHOLD_CENTS, draftCallVerdict, leftAgo, progressPct, shouldCall, uploadedSomething } from "./progress";
import { defaultWizardState } from "./state";

const NOW = new Date("2026-08-30T10:00:00+10:00");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const signals = (over: Partial<Parameters<typeof shouldCall>[0]> = {}) => ({
  progressPct: 90, uploaded: true, visits: 1, estValueCents: 1_420_000, ...over,
});

describe("progressPct", () => {
  it("is zero for someone who has done nothing", () => {
    expect(progressPct({})).toBe(0);
  });

  it("uses the page they reached, because defaults make answers lie", () => {
    // Found live: someone who had ticked three surfaces on step 2 scored 91%,
    // because ceiling height, door style and damage tier all carry defaults
    // and read as answered before the question is ever shown.
    expect(progressPct({}, 2, 5)).toBe(20);
    expect(progressPct({}, 3, 5)).toBe(40);
    expect(progressPct({}, 5, 5)).toBe(80);
    expect(progressPct({}, 1, 5)).toBe(0);
  });

  it("falls back to counting answers when no page is recorded", () => {
    expect(progressPct({ jobType: "interior", noPlan: true })).toBeGreaterThan(0);
  });

  it("climbs as they answer", () => {
    const early = progressPct({ jobType: "interior", noPlan: true });
    const later = progressPct({
      jobType: "interior", noPlan: true,
      customer: { ...defaultWizardState().customer, suburb: "Camberwell", email: "a@b.co" } as never,
      surfaces: ["walls"] as never,
      basics: { bedrooms: 3, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: true },
      condition: { tier: "sound" } as never,
    });
    expect(later).toBeGreaterThan(early);
  });

  it("scores an exterior run against exterior questions only", () => {
    // The trap: score every path against every question and a finished
    // exterior job reads as half-done forever, so it never looks warm.
    const exterior = progressPct({
      jobType: "exterior",
      listingUrl: "https://www.realestate.com.au/x",
      contact: { name: "A", email: "a@b.co", phone: "0412" },
      exterior: {
        storeys: "single", substrates: ["render"],
        painting: { body: true, windowsDoors: true, roofline: true, garage: false },
        condition: "good", access: [],
        extras: { deck: false, fence: false, fenceMetres: null, pergola: false, balustrade: false },
      } as never,
      paint: { brands: ["dulux"] } as never,
    });
    expect(exterior).toBeGreaterThanOrEqual(90);
  });

  it("never exceeds 100 or drops below 0", () => {
    const full = progressPct({
      jobType: "both", noPlan: true, listingUrl: "https://x.realestate.com.au",
      contact: { name: "A", email: "a@b.co", phone: "0412345678" },
      surfaces: ["walls"] as never,
      basics: { bedrooms: 3, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: true },
      condition: { tier: "sound" } as never,
      details: { ceilingHeight: "2.4", doorStyle: "flat", damageTier: 0 } as never,
      exterior: {
        storeys: "single", substrates: ["render"],
        painting: { body: true, windowsDoors: false, roofline: false, garage: false },
        condition: "good", access: [],
        extras: {},
      } as never,
      paint: { brands: ["dulux"] } as never,
    });
    expect(full).toBeLessThanOrEqual(100);
    expect(full).toBeGreaterThan(0);
  });
});

describe("the signals survive whatever a half-finished form looks like", () => {
  it("never throws on a raw, part-answered object", () => {
    // The autosave hands these functions the state as it is mid-typing — no
    // schema, no defaults, sometimes nonsense. The route cannot loosen the
    // schema first: wizardStateSchema has refinements, so .partial() throws
    // at runtime while TypeScript accepts it. That was a 500 on every save.
    const junk: unknown[] = [
      {}, { jobType: "exterior" }, { exterior: null }, { details: null },
      { surfaces: null }, { paint: {} }, { contact: {} },
      { jobType: "both", exterior: { painting: null } },
    ];
    for (const j of junk) {
      expect(() => progressPct(j as never)).not.toThrow();
      expect(() => uploadedSomething(j as never)).not.toThrow();
      expect(progressPct(j as never)).toBeGreaterThanOrEqual(0);
      expect(progressPct(j as never)).toBeLessThanOrEqual(100);
    }
  });
});

describe("uploadedSomething", () => {
  it("counts a plan, facade photos or damage photos", () => {
    expect(uploadedSomething({ planRunIds: ["r1"] })).toBe(true);
    expect(uploadedSomething({ facadeRunIds: ["r1"] })).toBe(true);
    expect(uploadedSomething({ details: { damagePhotoCount: 2 } as never })).toBe(true);
    expect(uploadedSomething({})).toBe(false);
  });
});

describe("shouldCall", () => {
  it("rings for a big job someone put real effort into, recently", () => {
    const v = shouldCall(signals(), hoursAgo(1), NOW);
    expect(v.call).toBe(true);
    expect(v.why).toContain("Uploaded a plan or photos");
  });

  it("does not ring for a small job, however complete", () => {
    // Tom's own reasoning: the threshold is what an hour of the office's time
    // is worth. A 95%-finished $900 hallway is not worth the call.
    expect(shouldCall(signals({ estValueCents: 90_000 }), hoursAgo(1), NOW).call).toBe(false);
    expect(shouldCall(signals({ estValueCents: CALL_THRESHOLD_CENTS - 1 }), hoursAgo(1), NOW).call).toBe(false);
    expect(shouldCall(signals({ estValueCents: CALL_THRESHOLD_CENTS }), hoursAgo(1), NOW).call).toBe(true);
  });

  it("does not ring for a big job nobody engaged with", () => {
    const idle = signals({ uploaded: false, progressPct: 20, visits: 1 });
    expect(shouldCall(idle, hoursAgo(1), NOW).call).toBe(false);
  });

  it("counts coming back as effort in its own right", () => {
    // A second visit days apart beats anything done in one sitting.
    const returner = signals({ uploaded: false, progressPct: 30, visits: 2 });
    expect(shouldCall(returner, hoursAgo(2), NOW).call).toBe(true);
    expect(shouldCall(returner, hoursAgo(2), NOW).why.join(" ")).toMatch(/Came back 2 times/);
  });

  it("stops ringing once it is stale — that is an email, not a call", () => {
    expect(shouldCall(signals(), hoursAgo(71), NOW).call).toBe(true);
    expect(shouldCall(signals(), hoursAgo(73), NOW).call).toBe(false);
  });

  it("gives its reasons even when it says no, so the card can explain itself", () => {
    const v = shouldCall(signals({ estValueCents: 100_000 }), hoursAgo(1), NOW);
    expect(v.call).toBe(false);
    expect(v.why.length).toBeGreaterThan(0);
  });

  it("takes the threshold as an argument, so it is settable without a deploy", () => {
    expect(shouldCall(signals({ estValueCents: 300_000 }), hoursAgo(1), NOW, 250_000).call).toBe(true);
  });
});

describe("leftAgo", () => {
  it("reads the way someone would say it", () => {
    expect(leftAgo(hoursAgo(0.01), NOW)).toBe("just now");
    expect(leftAgo(hoursAgo(0.67), NOW)).toBe("40 minutes ago");
    expect(leftAgo(hoursAgo(3), NOW)).toBe("3 hours ago");
    expect(leftAgo(hoursAgo(50), NOW)).toBe("2 days ago");
  });
});

describe("draftCallVerdict — a draft usually has no price", () => {
  it("with no value, Tom's own 80% rule decides", () => {
    // His words for funnel two: "answered more than 80% … instant prompt for
    // a call". The wizard prices at submit, so a drop-out has no value to
    // gate on — the $7,500 rule waits for a value to exist.
    const near = { progressPct: 85, uploaded: false, visits: 1, estValueCents: null };
    const early = { progressPct: 30, uploaded: false, visits: 1, estValueCents: null };
    expect(draftCallVerdict(near, hoursAgo(2), NOW).call).toBe(true);
    expect(draftCallVerdict(early, hoursAgo(2), NOW).call).toBe(false);
  });

  it("an upload counts the same as 80% — nobody photographs their house idly", () => {
    const uploaded = { progressPct: 30, uploaded: true, visits: 1, estValueCents: null };
    expect(draftCallVerdict(uploaded, hoursAgo(2), NOW).call).toBe(true);
    expect(draftCallVerdict(uploaded, hoursAgo(2), NOW).why).toContain("Uploaded a plan or photos");
  });

  it("goes quiet after 72 hours — that is an email, not a call", () => {
    const near = { progressPct: 90, uploaded: true, visits: 2, estValueCents: null };
    expect(draftCallVerdict(near, hoursAgo(80), NOW).call).toBe(false);
  });

  it("with a value known, the full $7,500 rule takes over", () => {
    const smallJob = { progressPct: 95, uploaded: true, visits: 2, estValueCents: 90_000 };
    expect(draftCallVerdict(smallJob, hoursAgo(2), NOW).call).toBe(false);
    const bigJob = { ...smallJob, estValueCents: CALL_THRESHOLD_CENTS };
    expect(draftCallVerdict(bigJob, hoursAgo(2), NOW).call).toBe(true);
  });
});
