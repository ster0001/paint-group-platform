import { describe, expect, it } from "vitest";
import { deskCheckPack, recommendedOutcome } from "./desk-check";
import { DEFAULT_POLICY, remoteConfirmVerdict, policyFromSettings } from "./policy";
import { defaultWizardState, type WizardState } from "./state";
import type { ScopeRule } from "@/lib/extract/scope";

const rules: ScopeRule[] = [];
const state = (over: Partial<WizardState> = {}): WizardState => ({ ...defaultWizardState(), ...over });

const surface = (code: string, extra: Record<string, unknown> = {}) => ({
  id: Math.floor(Math.random() * 1e6), code, count: 1, coats: 2, crewNote: "", ...extra,
});
const room = (id: number, name: string, surfaces: Array<Record<string, unknown>>, extra = {}) => ({
  id, kind: "area", name, type: "Interior", roomType: "bedroom", L: 4, W: 3, surfaces, ...extra,
});

const tree = () => [
  room(1, "Living", [surface("Walls"), surface("Ceilings")]),
  room(2, "Bed 1", [surface("Walls")]),
];
const pack = (over: Partial<Parameters<typeof deskCheckPack>[2]> = {}, blocks = tree(), s = state()) =>
  deskCheckPack(blocks, s, { totalCents: 500_000, rules, deferred: [], policy: DEFAULT_POLICY, ...over });

describe("⚑7 — the remote-confirmation door", () => {
  it("opens for an interior job under the cap", () => {
    expect(remoteConfirmVerdict(1_100_000, false).eligible).toBe(true);
    expect(remoteConfirmVerdict(1_200_000, false).eligible).toBe(true); // the cap itself is IN
  });

  it("closes over the cap, and says the number", () => {
    const v = remoteConfirmVerdict(1_200_001, false);
    expect(v.eligible).toBe(false);
    expect(v.reason).toContain("$12,000");
  });

  it("closes on any exterior work in v1", () => {
    const v = remoteConfirmVerdict(100_000, true);
    expect(v.eligible).toBe(false);
    expect(v.reason).toContain("interiors only");
  });

  it("is Tom's to widen without a deploy", () => {
    const wider = policyFromSettings({ remoteConfirmCapCents: 3_000_000, remoteConfirmInteriorOnly: false });
    expect(remoteConfirmVerdict(2_500_000, true, wider).eligible).toBe(true);
  });

  /**
   * A job that fails ⚑7 is NOT dropped — somebody still looks at every job,
   * they just don't always drive to it. That is the difference between remote
   * confirmation and self-serve.
   */
  it("still produces a pack for a job it cannot fix remotely", () => {
    const p = pack({ totalCents: 5_000_000 });
    expect(p.verdict.eligible).toBe(false);
    expect(p.rooms).toHaveLength(2);
    expect(recommendedOutcome(p)).toBe("visit");
  });
});

describe("what the estimator is shown", () => {
  it("lists every interior room with what is being painted", () => {
    const p = pack();
    expect(p.rooms.map((r) => r.name)).toEqual(["Living", "Bed 1"]);
    expect(p.rooms[0].painting.join(" ")).toContain("Walls");
  });

  it("leaves the exterior out of the room list but records that it exists", () => {
    const blocks = [...tree(), room(3, "Front", [surface("Weatherboards")], { type: "Exterior" })];
    const p = pack({}, blocks);
    expect(p.hasExterior).toBe(true);
    expect(p.rooms.map((r) => r.name)).not.toContain("Front");
  });

  it("shows only a room the customer called out, never the default", () => {
    const blocks = [
      room(1, "Living", [surface("Walls")], { roomCondition: "worse" }),
      room(2, "Bed 1", [surface("Walls")], { roomCondition: "same" }),
    ];
    const p = pack({}, blocks);
    expect(p.rooms[0].condition).toBe("Worse than the rest");
    expect(p.rooms[1].condition).toBeNull();
  });

  it("counts the repairs, and how many a person still has to price", () => {
    const blocks = [
      room(1, "Living", [
        surface("Walls"),
        surface("plaster_cracks", { internalLabel: "Repair — Crack", prepHr: 0.25, assumedFields: ["prep"], origin: "customer_stated" }),
        surface("water_damage", { internalLabel: "Repair — Water mark (to price)", prepHr: 0, assumedFields: ["prep"], origin: "customer_stated" }),
      ]),
    ];
    const p = pack({}, blocks);
    expect(p.spotCount).toBe(2);
    expect(p.spotsToPrice).toBe(1);
  });

  it("puts the derived systems in the pack, in the painter's words", () => {
    expect(pack().systems.map((l) => l.group)).toEqual(["walls", "ceilings"]);
  });

  it("turns the access answers into the words that explain the time", () => {
    const s = state();
    s.details.siteAccess = { cleared: "no", stairwell: "yes", parking: "drive", pets: "yes" };
    const p = pack({}, tree(), s);
    expect(p.access.some((a) => /furniture stays/i.test(a))).toBe(true);
    expect(p.access.some((a) => /stairwell/i.test(a))).toBe(true);
    expect(p.access).toContain("pets on site");
    // A driveway costs nothing and must not fill the pack with noise.
    expect(p.access.some((a) => /driveway/i.test(a))).toBe(false);
  });
});

describe("what it recommends", () => {
  it("says fix it when the job is eligible and nothing is open", () => {
    const p = pack();
    expect(p.clean).toBe(true);
    expect(recommendedOutcome(p)).toBe("fix");
  });

  /**
   * An open deferral means somebody wrote down that they did not know
   * something. Fixing a price over the top of that is exactly the failure
   * remote confirmation would be blamed for.
   */
  it("says ask when something is still open", () => {
    const p = pack({ deferred: [{ room: "Living", areaId: 1, what: "a door style", count: 1, needs: "flat or panel?" }] });
    expect(p.clean).toBe(false);
    expect(recommendedOutcome(p)).toBe("ask");
  });

  it("says ask when a flagged spot is still unpriced", () => {
    const blocks = [room(1, "Living", [
      surface("Walls"),
      surface("mould", { internalLabel: "Repair — Mould (to price)", prepHr: 0, assumedFields: ["prep"], origin: "customer_stated" }),
    ])];
    expect(recommendedOutcome(pack({}, blocks))).toBe("ask");
  });

  it("says visit when ⚑7 closes the door, whatever else is true", () => {
    expect(recommendedOutcome(pack({ totalCents: 9_000_000 }))).toBe("visit");
  });
});
