import { describe, expect, it } from "vitest";
import { gapsFor, nextBatch, nextGap, type GraphBlock, type GraphInput } from "./question-graph";
import { gapSchema } from "./schemas";
import type { WizardState } from "@/lib/wizard/state";
import type { ScopeRule } from "@/lib/extract/scope";
import { ROOM_REQUIRED_QUESTIONS, SIDE_REQUIRED_QUESTIONS, roomGateError, type RoomRequiredQuestion } from "@/lib/wizard/required-questions";
import { defaultInteriorLoop, confirmRoom, type LooseBlock as RoomBlock } from "@/lib/wizard/rooms-loop";
import { WALL_CODES, defaultSidesLoop } from "@/lib/wizard/sides";

// ---- fixtures ----------------------------------------------------------------

const rule = (room_type: string, surface_type: string): ScopeRule => ({ room_type, surface_type, is_option: false, requires_confirm: false, notes: null });
const RULES: ScopeRule[] = [
  rule("bedroom", "Walls"), rule("bedroom", "Ceiling"), rule("bedroom", "Door & Frame"),
  rule("hallway", "Walls"), rule("hallway", "Ceiling"),
  rule("kitchen", "Walls"), rule("kitchen", "Ceiling"),
];
const CODES = new Set(["Walls", "Ceiling", "Kitchen Cupboard Front", "Kitchen Cupboard Interior", "Robe Door", "Robe Interior", "Flat Door and Frame (1 Side)", "Awning / Casement Window", WALL_CODES[0].code]);

function room(id: number, roomType: string, name: string, over: Partial<GraphBlock> = {}): GraphBlock {
  return {
    id, kind: "area", type: "Interior", roomType, name, L: 4, W: 3, origin: "ai_assumed", assumedFields: ["L", "W"],
    surfaces: [{ id: id * 10, code: "Walls" }, { id: id * 10 + 1, code: "Flat Door and Frame (1 Side)", count: 1 }],
    customer: { size: null, cup: null, confirmed: false },
    ...over,
  };
}
const SIDE_IDS = { front: 101, left: 102, right: 103, back: 104 } as const;
function side(key: keyof typeof SIDE_IDS, over: Partial<GraphBlock> = {}): GraphBlock {
  const name = { front: "Front", left: "Left side", right: "Right side", back: "Back" }[key];
  return {
    id: SIDE_IDS[key], kind: "area", type: "Exterior", areaType: "surface", name, L: 12, H: 2.6,
    surfaces: [{ id: SIDE_IDS[key] * 10, code: WALL_CODES[0].code, sharePct: 100 }],
    customer: { include: null, size: null, confirmed: false },
    ...over,
  };
}

function state(jobType: WizardState["jobType"], over: Partial<WizardState> = {}): Partial<WizardState> {
  const wantsExt = jobType !== "interior";
  return {
    mode: "customer", jobType, title: "", listingUrl: "", planRunIds: [], facadeRunIds: [], conditionSourceIds: [], noPlan: true,
    address: { street: "1 Test St", suburb: "Kew", state: "VIC", postcode: "3101", formatted: "1 Test St, Kew VIC 3101" },
    customer: { email: "tester@example.com", suburb: "Kew", postcode: "3101", propertyKind: "house", heritageListed: "no", bodyCorporate: "no", builtPre1970: "no", asbestosSuspected: "no" },
    basics: { bedrooms: 3, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: false },
    surfaces: ["walls", "ceilings", "doors", "windows"],
    condition: { tier: "change", darkToLightSurfaces: [] },
    details: { doorStyle: "unsure", doorScope: "frame", windowStyle: "unsure", ceilingHeight: "2.4", damageTier: 1, damageNote: "", damagePhotoCount: 0 },
    paint: { brands: [], colourHelp: null, waterBasedOnly: false, trimsOilBased: null, base: null },
    contact: { name: "", email: "", phone: "" },
    exterior: wantsExt ? {
      storeys: "single", substrates: ["weatherboards"], painting: { body: true, windowsDoors: true, roofline: true, garage: false },
      condition: "weathered", access: [], accessEquipment: [], noPhotos: true,
      extras: { deck: false, fence: false, fenceMetres: null, fenceType: "paling", pergola: false, balustrade: false },
    } : null,
    ...over,
  };
}

const FACTS = { inServiceArea: true, timing: "soon", occupied: false, email: "tester@example.com" };

function input(over: Partial<GraphInput>): GraphInput {
  return { mode: "guided", accountType: "residential", state: state("interior"), blocks: [], interior: defaultInteriorLoop(), sides: null, scopeRules: RULES, rateCodes: CODES, facts: FACTS, ...over };
}

const keys = (gaps: ReturnType<typeof gapsFor>) => gaps.map((g) => g.key);
const requiredKeys = (gaps: ReturnType<typeof gapsFor>) => gaps.filter((g) => g.kind === "required").map((g) => g.key);

/** F1 interior, quick basics, three rooms (bedroom first in the tree, hallway second). */
const F1 = () => input({ blocks: [room(1, "bedroom", "Bedroom 1"), room(2, "hallway", "Hallway"), room(3, "kitchen", "Kitchen")] });
/** F2 interior with a floorplan: sizes were READ. */
const F2 = () => input({
  state: state("interior", { planRunIds: ["7f1a7e6c-3c2b-4a1e-9f0d-2b6d1c4e8a11"], noPlan: false }),
  blocks: [
    room(1, "bedroom", "Bedroom 1", { origin: "ai_extracted", assumedFields: [] }),
    room(2, "hallway", "Hallway", { origin: "ai_extracted", assumedFields: [] }),
    room(3, "kitchen", "Kitchen", { origin: "ai_extracted", assumedFields: [] }),
  ],
});
/** F3 interior, everything answered — only the sweep is left. */
const F3 = () => input({
  state: state("interior", { details: { doorStyle: "flat", doorScope: "frame", windowStyle: "casement", ceilingHeight: "2.4", damageTier: 0, damageNote: "", damagePhotoCount: 0 }, paint: { brands: ["dulux"], colourHelp: "known", waterBasedOnly: false, trimsOilBased: null, base: null } }),
  blocks: [
    room(2, "hallway", "Hallway", { customer: { size: "yes", cup: null, confirmed: false }, customerCustom: ["nothing"] }),
    room(1, "bedroom", "Bedroom 1", { customer: { size: "yes", cup: true, cupInterior: false, confirmed: false }, customerCustom: ["nothing"] }),
  ],
});
/** F4 exterior, peeling paint on a pre-1970s home. */
const F4 = () => input({
  state: state("exterior", { customer: { ...state("exterior").customer!, builtPre1970: "yes" }, exterior: { ...state("exterior").exterior!, condition: "peeling" } }),
  blocks: [side("front"), side("left"), side("right"), side("back")], interior: null, sides: defaultSidesLoop(),
});
/** F5 exterior, straightforward, front side already included. */
const F5 = () => input({
  state: state("exterior"),
  blocks: [side("front", { customer: { include: true, size: null, confirmed: false } }), side("left"), side("right"), side("back")],
  interior: null, sides: defaultSidesLoop(),
});
/** F6 both, email not yet given. */
const F6 = () => input({
  state: state("both", { customer: { ...state("both").customer!, email: "" } }),
  facts: { ...FACTS, email: null },
  blocks: [room(1, "bedroom", "Bedroom 1"), room(2, "hallway", "Hallway"), side("front"), side("left"), side("right"), side("back")],
  interior: defaultInteriorLoop(), sides: defaultSidesLoop(),
});
const FIXTURES = { F1, F2, F3, F4, F5, F6 };

// ---- tests -------------------------------------------------------------------

describe("question graph — determinism and shape", () => {
  it.each(Object.entries(FIXTURES))("%s: same inputs → same order, every gap valid", (_n, make) => {
    const a = gapsFor(make());
    const b = gapsFor(make());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
    for (const g of a) expect(gapSchema.safeParse(g).success, g.key).toBe(true);
    expect(new Set(a.map((g) => g.key)).size).toBe(a.length);
  });

  it.each(Object.entries(FIXTURES))("%s: required before tightening before recommended before confirm", (_n, make) => {
    // Uploads (attach_document) rank after everything — a photo request never blocks the sweep.
    const ranks = gapsFor(make()).map((g) => (g.writes[0]?.tool === "attach_document" ? 4 : { required: 0, tightening: 1, recommended: 2, confirm: 3 }[g.kind]));
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
  });
});

describe("question graph — the §4 rules", () => {
  it("F1: hallway first, then tree order, size before cupboards inside each room", () => {
    expect(requiredKeys(gapsFor(F1()))).toEqual(["room.2.size", "room.1.size", "room.1.cupboards", "room.3.size", "room.3.cupboards"]);
    expect(nextGap(F1())?.key).toBe("room.2.size");
  });

  it("F1: the sweep comes last — doors/windows check, missed rooms, then per-room confirms", () => {
    const confirms = gapsFor(F1()).filter((g) => g.kind === "confirm").map((g) => g.key);
    expect(confirms.slice(0, 2)).toEqual(["sweep.dw_totals", "sweep.missed_rooms"]);
    expect(confirms).toContain("room.2.confirm");
    expect(confirms.at(-1)).toBe("room.3.confirm");
  });

  it("F2: never ask twice — plan-read sizes are a one-time confirm, never required; no 'how many rooms'", () => {
    const gaps = gapsFor(F2());
    expect(requiredKeys(gaps)).toEqual(["room.1.cupboards", "room.3.cupboards"]);
    expect(keys(gaps)).not.toContain("rooms");
    const size = gaps.find((g) => g.key === "room.2.size");
    expect(size?.kind).toBe("confirm");
    // Once the person says "looks right", it is gone for good.
    const f = F2();
    f.blocks[1].customer = { size: "yes", cup: null, confirmed: false };
    expect(keys(gapsFor(f))).not.toContain("room.2.size");
  });

  it("F3: with everything answered only confirms remain, and guided mode batches up to three of them", () => {
    const gaps = gapsFor(F3());
    expect(gaps.every((g) => g.kind === "confirm")).toBe(true);
    expect(nextBatch(F3()).length).toBeLessThanOrEqual(3);
    expect(nextBatch(F3()).every((g) => g.kind === "confirm")).toBe(true);
  });

  it("F4: the lead stop outranks every open question", () => {
    const first = nextGap(F4());
    expect(first?.key).toBe("stop.lead_paint");
    expect(first?.writes[0]).toEqual({ tool: "hard_stop", input: { kind: "lead_paint" } });
    expect(requiredKeys(gapsFor(F4()))).toContain("side.front.include");
  });

  it("F5: sides loop front → left → right → back; an included side asks its size next", () => {
    const req = requiredKeys(gapsFor(F5()));
    expect(req.slice(0, 4)).toEqual(["side.front.size", "side.left.include", "side.right.include", "side.back.include"]);
    const confirms = gapsFor(F5()).filter((g) => g.kind === "confirm").map((g) => g.key);
    expect(confirms.slice(0, 3)).toEqual(["ext.cond_card", "sweep.ext_dw_totals", "sweep.ext_missed"]);
  });

  it("F5: an excluded side asks nothing more and is not confirmed", () => {
    const f = F5();
    f.blocks[1].customer = { include: false, size: null, confirmed: false };
    const k = keys(gapsFor(f));
    expect(k.filter((x) => x.startsWith("side.left."))).toEqual([]);
  });

  it("F6: qualification first, then every interior question before any exterior one", () => {
    const gaps = gapsFor(F6());
    expect(gaps[0].key).toBe("q.email");
    const req = requiredKeys(gaps);
    const lastInterior = Math.max(...req.map((k, i) => (k.startsWith("room.") ? i : -1)));
    const firstExterior = req.findIndex((k) => k.startsWith("side.") || k.startsWith("ext."));
    expect(firstExterior).toBeGreaterThan(lastInterior);
  });

  it("out of area is a stop before anything else", () => {
    const f = F1();
    f.facts = { ...FACTS, inServiceArea: false };
    expect(nextGap(f)?.key).toBe("stop.out_of_area");
  });

  it("co-work never blocks on the customer's identity: address and property type are recommended, email/account/timing not asked", () => {
    const f = F1();
    f.mode = "cowork";
    f.state = state("interior", { address: null, customer: { ...state("interior").customer!, suburb: "", postcode: "", email: "" } });
    f.accountType = null;
    f.facts = { ...FACTS, email: null, timing: null };
    const gaps = gapsFor(f);
    expect(gaps.find((g) => g.key === "q.address")?.kind).toBe("recommended");
    expect(keys(gaps)).not.toContain("q.email");
    expect(keys(gaps)).not.toContain("q.account_type");
    expect(keys(gaps)).not.toContain("q.timing");
    expect(requiredKeys(gaps)[0]).toMatch(/^room\./);
  });

  it("guided asks one required question per turn; co-work gets the whole batch", () => {
    expect(nextBatch(F1())).toHaveLength(1);
    const cw = F1(); cw.mode = "cowork";
    expect(nextBatch(cw).length).toBe(gapsFor(cw).length);
  });
});

describe("question graph — Addendum A tightening gaps", () => {
  it("F1 lists every open assumption as a tightening gap", () => {
    const t = gapsFor(F1()).filter((g) => g.kind === "tightening").map((g) => g.key);
    expect(t).toEqual(expect.arrayContaining(["room.1.cupboard_interiors", "room.3.cupboard_interiors", "door_style", "window_style", "paint.colours", "condition.photos"]));
  });

  it("ordering flips when a swing changes (largest $ impact first)", () => {
    const a = F1(); a.swings = { door_style: 35_000, cupboard_interiors: 98_000 };
    const ta = gapsFor(a).filter((g) => g.kind === "tightening").map((g) => g.key);
    expect(ta[0]).toBe("room.1.cupboard_interiors");
    expect(ta.indexOf("door_style")).toBeGreaterThan(ta.indexOf("room.3.cupboard_interiors"));

    const b = F1(); b.swings = { door_style: 500_000, cupboard_interiors: 1_000 };
    const tb = gapsFor(b).filter((g) => g.kind === "tightening").map((g) => g.key);
    expect(tb[0]).toBe("door_style");
    expect(gapsFor(b).find((g) => g.key === "door_style")?.swingCents).toBe(500_000);
  });

  it("cupboard interiors only appear when the card carries the row", () => {
    const f = F1();
    f.rateCodes = new Set([...CODES].filter((c) => !c.includes("Interior")));
    expect(keys(gapsFor(f)).some((k) => k.endsWith("cupboard_interiors"))).toBe(false);
  });
});

describe("S2 acceptance: an editor's required question is data the graph picks up unedited", () => {
  const flooring: RoomRequiredQuestion = {
    key: "flooring_protected",
    phrasing: "Is the flooring staying, or being replaced after we paint?",
    applies: () => true,
    answered: (r) => (r as { customer?: { flooring?: unknown } }).customer?.flooring != null,
    refusal: "The flooring question still needs an answer.",
    action: "room_flooring",
    acceptsNotSure: true,
  };

  it("adding the question to the registry adds it to the graph, in registry order, and to the editor's gate", () => {
    const before = keys(gapsFor(F1()));
    expect(before.some((k) => k.endsWith(".flooring_protected"))).toBe(false);

    const f = F1();
    f.requiredQuestions = { room: [...ROOM_REQUIRED_QUESTIONS, flooring], side: SIDE_REQUIRED_QUESTIONS };
    const after = requiredKeys(gapsFor(f));
    expect(after).toEqual(["room.2.size", "room.2.flooring_protected", "room.1.size", "room.1.cupboards", "room.1.flooring_protected", "room.3.size", "room.3.cupboards", "room.3.flooring_protected"]);

    // The editor gate reads the same list.
    const gate = roomGateError({ customer: { size: "yes", cup: true, confirmed: false } }, { cupboardApplies: true }, [...ROOM_REQUIRED_QUESTIONS, flooring]);
    expect(gate).toBe("The flooring question still needs an answer.");
    // …and unchanged behaviour with the real list.
    const ok = confirmRoom([room(2, "hallway", "Hallway", { customer: { size: "yes", cup: null, confirmed: false } }) as unknown as RoomBlock], 2, false);
    expect(ok.ok).toBe(true);
  });
});
