import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_LOOK, stepsFor, type QuickLook } from "./quick-look";
import {
  applyColourChoice, applyJobChoice, colourChoiceOf, detailsReady, mobileProgress, mobileScreensFor,
  roomChips, surfaceChips, surfacesTicked, toggleListedRoom, toggleSurface,
} from "./mobileScreens";
import type { ExteriorV2, ExteriorV2Side } from "./state";
import { extraSizeRows, extraSizesWithDefaults, paintParts, paintScreenParts, sideOfScreen, sideStatusLine } from "./mobileScreens";

const q = (over: Partial<QuickLook> = {}): QuickLook => ({ ...DEFAULT_QUICK_LOOK, ...over });
const ids = (quick: QuickLook, gate = true) => mobileScreensFor(stepsFor(quick.jobType, quick.propertyKind, "areas", "range", quick.scope, gate), quick).map((s) => s.id);

/** Brief §2 / §9 item 1: twelve screens in order (the twelfth is the gate, after the details). */
describe("the phone's screens (wizard mobile v5 §2)", () => {
  it("an inside job on a house walks the eleven question screens in the brief's order", () => {
    expect(ids(q())).toEqual(["what", "property", "beds", "storeys", "job", "surfaces", "rooms", "colours", "condition", "living", "details"]);
  });
  it("a unit or apartment skips storeys", () => {
    expect(ids(q({ propertyKind: "unit_apartment" }))).toEqual(["what", "property", "beds", "job", "surfaces", "rooms", "colours", "condition", "living", "details"]);
  });
  it("an outside job skips the job and rooms screens — its own steps follow the place, as they are (§2.4)", () => {
    const list = ids(q({ jobType: "exterior" }));
    expect(list.slice(0, 2)).toEqual(["what", "property"]);
    expect(list).not.toContain("job");
    expect(list).not.toContain("rooms");
    expect(list).not.toContain("beds");
    expect(list[list.length - 1]).toBe("details");
    // exterior on mobile v5 (S1): the home step is the shape and size screens; the rest follow as they are
    // exterior on mobile v5 (S2): the paint step is four screens; the rest follow as they are
    expect(list.slice(2, 4)).toEqual(["shape", "size"]);
    expect(list.slice(4, 8)).toEqual(["p-house", "p-win", "p-ver", "p-around"]);
    // S3: the about step is its screens too (nothing ticked → the colours and the access); the sides step follows as it is
    // S4: the sides step is four screens of its own too
    expect(list.slice(8, 14)).toEqual(["a-colours", "a-access", "s-front", "s-right", "s-back", "s-left"]);
  });
  it("every screen knows its step, and the rooms heading changes for Some rooms", () => {
    const list = mobileScreensFor(stepsFor("interior", "house", "areas", "range", "some_rooms", true), q({ scope: "some_rooms" }));
    expect(list.find((s) => s.id === "beds")?.step).toBe("place");
    expect(list.find((s) => s.id === "colours")?.step).toBe("condition");
    expect(list.find((s) => s.id === "rooms")?.heading).toBe("Which rooms?");
    expect(mobileScreensFor(stepsFor("interior"), q()).find((s) => s.id === "rooms")?.heading).toBe("We're painting these rooms");
  });
  it("single choices advance themselves; surfaces, rooms and details carry the bar (R7)", () => {
    const list = mobileScreensFor(stepsFor("interior", "house", "areas", "range", "whole", true), q());
    const bar = list.filter((s) => s.advance === "bar").map((s) => s.id);
    expect(bar).toEqual(["surfaces", "rooms", "details"]);
  });
  it("without a gate there is no details screen", () => {
    expect(ids(q(), false)).not.toContain("details");
  });
  it("a step the phone does not split is one screen with a bar, under its own name", () => {
    // every exterior step has its own screens now (S1–S4); a commercial place's screens are still rendered as they are
    const list = mobileScreensFor(stepsFor("interior", "commercial", "areas", "range", "whole", true), q({ propertyKind: "commercial" }));
    const areas = list.find((s) => s.id === "com_areas");
    expect(areas).toMatchObject({ step: "com_areas", advance: "bar", heading: null });
  });
});

describe("the progress bar (§2.1)", () => {
  it("runs from 0 to 55% across the question screens, the gate at 55", () => {
    expect(mobileProgress(0, 11)).toBe(0);
    expect(mobileProgress(10, 11)).toBe(50);
    expect(mobileProgress(11, 11)).toBe(55);
    expect(mobileProgress(0, 0)).toBe(0);
  });
});

describe("the answers map onto the quick look (§2.6 — the data model is unchanged)", () => {
  it("the whole interior ticks the five surfaces; Doors, windows and trims pre-ticks skirtings, doors and windows (the architraves ride with the doors)", () => {
    const whole = q({ ...applyJobChoice("whole", ["Bed 1", "Bed 2", "Living room"]) });
    expect(surfaceChips(whole).map((c) => `${c.key}:${c.on ? 1 : 0}`)).toEqual(["walls:1", "ceilings:1", "skirting:1", "doors:1", "windows:1"]);
    expect(whole.rooms).toBeNull();
    const trims = q({ ...applyJobChoice("trims_doors", ["Bed 1", "Bed 2", "Living room"]) });
    expect(surfaceChips(trims).filter((c) => c.on).map((c) => c.key)).toEqual(["skirting", "doors", "windows"]);
    expect(trims.excluded).toEqual([]);
    expect(surfacesTicked(trims)).toBe(3);
    // unticking the doors takes the architraves with it, and ticking them back brings them back
    const noDoors = q({ ...whole, ...toggleSurface(whole, "doors") });
    expect(noDoors.excluded).toEqual(["doors", "architraves"]);
    expect(q({ ...noDoors, ...toggleSurface(noDoors, "doors") }).excluded).toEqual([]);
  });
  it("Some rooms pre-ticks the first two rooms only (§2.3)", () => {
    const some = q({ ...applyJobChoice("some_rooms", ["Bed 1", "Bed 2", "Living room", "Kitchen / Meals"]) });
    expect(some.rooms).toEqual(["Bed 1", "Bed 2"]);
  });
  it("a surface chip unticks into `excluded` and the colour tiles follow", () => {
    const next = q({ ...applyJobChoice("whole", []), ...toggleSurface(q(), "ceilings") });
    expect(next.excluded).toEqual(["ceilings"]);
    expect(next.changing.ceilings).toBe(false);
    expect(surfacesTicked(next)).toBe(4);
    const back = q({ ...next, ...toggleSurface(next, "ceilings") });
    expect(back.excluded).toEqual([]);
  });
  it("the three colour answers read from and write to the colour tiles", () => {
    expect(colourChoiceOf(q())).toBe("new");
    const same = q(applyColourChoice(q(), "same"));
    expect(colourChoiceOf(same)).toBe("same");
    expect(Object.values(same.changing).some(Boolean)).toBe(false);
    const deciding = q(applyColourChoice(q(), "deciding"));
    expect(colourChoiceOf(deciding)).toBe("deciding");
    expect(deciding.undecided).toBe(true);
    const fresh = q(applyColourChoice(same, "new"));
    expect(colourChoiceOf(fresh)).toBe("new");
    expect(fresh.changing).toEqual({ walls: true, ceilings: true, trims: true, windows: true });
    // bold is never asked on a phone, and never left set
    expect(fresh.bold).toBe(false);
  });
  it("the rooms screen lists the generated rooms ticked, the extras unticked, and ticks become added rooms", () => {
    const names = ["Bed 1", "Bed 2", "Bed 3", "Living room", "Kitchen / Meals", "Bathroom", "Laundry", "Hall & Entry"];
    const chips = roomChips(q(), names, []);
    expect(chips.filter((c) => c.kind === "listed").every((c) => c.on)).toBe(true);
    expect(chips.filter((c) => c.kind === "extra").map((c) => `${c.name}:${c.on ? 1 : 0}`)).toEqual(["Study:0", "Ensuite:0", "Garage:0"]);
    const withStudy = roomChips(q(), names, [{ name: "Study" }]);
    expect(withStudy.find((c) => c.name === "Study")).toMatchObject({ on: true, kind: "extra", index: 0 });
    // an Ensuite the generated list already has is not offered twice
    expect(roomChips(q(), [...names, "Ensuite"], []).filter((c) => c.name === "Ensuite")).toHaveLength(1);
    // a room typed by hand shows as added
    expect(roomChips(q(), names, [{ name: "Dining" }]).find((c) => c.name === "Dining")).toMatchObject({ on: true, kind: "added" });
  });
  it("unticking a listed room writes the subset; ticking the last one back writes null (all of them)", () => {
    const names = ["Bed 1", "Bed 2", "Living room"];
    const off = toggleListedRoom(q(), names, "Bed 2");
    expect(off.rooms).toEqual(["Bed 1", "Living room"]);
    const on = toggleListedRoom(q({ rooms: ["Bed 1", "Living room"] }), names, "Bed 2");
    expect(on.rooms).toBeNull();
  });
  it("the details button needs a FULL name (D17), a 10-digit mobile and an email", () => {
    expect(detailsReady({ name: "Tom Roman", phone: "0412 345 678", email: "tom@example.com" })).toBe(true);
    expect(detailsReady({ name: "Tom", phone: "0412 345 678", email: "tom@example.com" })).toBe(false);
    expect(detailsReady({ name: "  Tom   Roman ", phone: "0412 345 678", email: "tom@example.com" })).toBe(true);
    expect(detailsReady({ name: "Tom Roman", phone: "0412 345 67", email: "tom@example.com" })).toBe(false);
    expect(detailsReady({ name: "Tom Roman", phone: "0412 345 678", email: "" })).toBe(false);
  });
});

/** Exterior on mobile v5, session 1 (plan §2 screens 2–4): the Your home step is three screens of its own. */
describe("exterior on mobile v5 — the Your home step on a phone", () => {
  const quick = q({ jobType: "exterior" });
  const steps = stepsFor("exterior", "house", "areas", "range", "whole", true);
  const house = (propertyType: ExteriorV2["propertyType"]): ExteriorV2 => ({
    propertyType, sizeBand: null, rowPosition: null, wall: { down: null, up: null, brickPainted: null, timberPainted: null }, gableFill: null, windowType: "unsure",
    garageCars: null, postKind: null, parts: [], extras: [], extraSizes: {}, extraWallMaterial: null, sides: {},
  } as ExteriorV2);
  it("before a shape: the shape and the size, each advancing itself, under the Your home stage; no home screen rendered as it is", () => {
    const screens = mobileScreensFor(steps, quick);
    const home = screens.filter((s) => s.step === "home");
    expect(home.map((s) => s.id)).toEqual(["shape", "size"]);
    expect(home.every((s) => s.advance === "auto" && s.stage === "Your home" && s.heading)).toBe(true);
    expect(screens.map((s) => s.id)).toEqual(["what", "property", "shape", "size", "p-house", "p-win", "p-ver", "p-around", "a-colours", "a-access", "s-front", "s-right", "s-back", "s-left", "details"]);
  });
  it("a shape that usually shares a wall adds Where is it in the row?; a bungalow does not", () => {
    const ids = (v2: ExteriorV2) => mobileScreensFor(steps, quick, { v2 }).filter((s) => s.step === "home").map((s) => s.id);
    expect(ids(house("cal"))).toEqual(["shape", "size"]);
    expect(ids(house("th"))).toEqual(["shape", "size", "row"]);
    expect(ids(house("unit"))).toEqual(["shape", "size", "row"]);
    expect(ids(house("terrace"))).toEqual(["shape", "size", "row"]);
  });
});

/** Exterior on mobile v5, session 2 (plan §2 screens 5a–5d): Painting is four screens with a bar, nothing pre-ticked. */
describe("exterior on mobile v5 — the Painting step on a phone", () => {
  const quick = q({ jobType: "exterior" });
  const steps = stepsFor("exterior", "house", "areas", "range", "whole", true);
  const house = (propertyType: ExteriorV2["propertyType"], parts: ExteriorV2["parts"] = []): ExteriorV2 => ({
    propertyType, sizeBand: "md", rowPosition: null, wall: { down: null, up: null, brickPainted: null, timberPainted: null }, gableFill: null, windowType: "unsure",
    garageCars: null, postKind: null, parts, extras: [], extraSizes: {}, extraWallMaterial: null, sides: {},
  } as ExteriorV2);
  it("four screens under the Painting stage, each with a Continue bar; the verandah screen hints only where the shape has none", () => {
    const cal = mobileScreensFor(steps, quick, { v2: house("cal") }).filter((s) => s.step === "paint");
    expect(cal.map((s) => s.id)).toEqual(["p-house", "p-win", "p-ver", "p-around"]);
    expect(cal.every((s) => s.advance === "bar" && s.stage === "Painting")).toBe(true);
    expect(cal[0].heading).toBe("Tap everything we're painting");
    expect(cal[2].sub).toBeNull();
    const wb = mobileScreensFor(steps, quick, { v2: house("wb") }).filter((s) => s.step === "paint");
    expect(wb[2].sub).toBe("Tick it if there is one.");
  });
  it("the house and its roofline share one screen; the verandah family appears once the verandah is ticked; the sheet lists them all", () => {
    expect(paintScreenParts("p-house", house("cal"))).toEqual(["walls", "gable", "fascias", "gutters", "downpipes", "eaves"]);
    expect(paintScreenParts("p-win", house("cal"))).toEqual(["windows", "doors", "garage", "shutters"]);
    expect(paintScreenParts("p-ver", house("cal"))).toEqual(["verandah"]);
    expect(paintScreenParts("p-ver", house("cal", ["verandah"]))).toEqual(["verandah", "posts", "ceiling", "handrail"]);
    expect(paintParts(house("cal"))).toHaveLength(11);
  });
});

/** Exterior on mobile v5, session 3 (plan §2 screens 6a–6n, 7, 8): About it, one card a screen, only for the ticked parts. */
describe("exterior on mobile v5 — the About it step on a phone", () => {
  const quick = q({ jobType: "exterior" });
  const steps = stepsFor("exterior", "house", "areas", "range", "whole", true);
  const house = (propertyType: ExteriorV2["propertyType"], over: Partial<ExteriorV2> = {}): ExteriorV2 => ({
    propertyType, sizeBand: "md", rowPosition: null, wall: { down: null, up: null, brickPainted: null, timberPainted: null }, gableFill: null, windowType: "unsure",
    garageCars: null, postKind: null, parts: [], extras: [], extraSizes: {}, extraWallMaterial: null, sides: {}, ...over,
  } as ExteriorV2);
  const about = (v2: ExteriorV2) => mobileScreensFor(steps, quick, { v2 }).filter((s) => s.step === "about");
  it("nothing ticked that needs more: the colours and the access only, under the About it stage", () => {
    const list = about(house("wb", { parts: ["fascias"] }));
    expect(list.map((s) => s.id)).toEqual(["a-colours", "a-access"]);
    expect(list.map((s) => s.advance)).toEqual(["auto", "bar"]);
    expect(list.every((s) => s.stage === "About it")).toBe(true);
  });
  it("every card in the brief's order, only for what was ticked; the sizes screen only with an extra that takes one", () => {
    const all = about(house("cal", { parts: ["walls", "gable", "windows", "garage", "posts"], extras: ["paling_fence", "pergola"] }));
    expect(all.map((s) => s.id)).toEqual(["a-walls", "a-gable", "a-win", "a-garage", "a-posts", "a-extras", "a-colours", "a-access"]);
    expect(all.find((s) => s.id === "a-extras")?.advance).toBe("bar");
    expect(about(house("cal", { parts: ["walls"], extras: ["meter_box"] })).map((s) => s.id)).toEqual(["a-walls", "a-colours", "a-access"]);
  });
  it("a double storey asks upstairs too; brick or vertical timber anywhere adds its question; a bare-brick shape carries the hint", () => {
    expect(about(house("ds", { parts: ["walls"] })).map((s) => s.id)).toEqual(["a-walls", "a-wallsUp", "a-colours", "a-access"]);
    expect(about(house("ds", { parts: ["walls"] }))[0].heading).toBe("Downstairs walls — what are they made of?");
    expect(about(house("ds", { parts: ["walls"], wall: { down: "render", up: "brick", brickPainted: null, timberPainted: null } })).map((s) => s.id)).toEqual(["a-walls", "a-wallsUp", "a-brick", "a-colours", "a-access"]);
    expect(about(house("wb", { parts: ["walls"], wall: { down: "vertical_timber", up: null, brickPainted: null, timberPainted: null } })).map((s) => s.id)).toEqual(["a-walls", "a-timber", "a-colours", "a-access"]);
    expect(about(house("brick", { parts: ["walls"] }))[0].sub).toMatch(/left bare/);
    expect(about(house("cal", { parts: ["walls"] }))[0].sub).toBeNull();
  });
  it("the size steppers: the desktop's keys with the prototype's defaults, written once where missing", () => {
    const v2 = house("cal", { extras: ["picket_fence", "deck", "wall", "pergola"] });
    expect(extraSizeRows(v2).map((r) => `${r.key}:${r.initial}${r.unit}`)).toEqual(["fence:20m", "deck:20m²", "wall:10m", "pergola_l:4m", "pergola_w:3m"]);
    expect(extraSizesWithDefaults(v2)).toEqual({ fence: 20, deck: 20, wall: 10, pergola_l: 4, pergola_w: 3 });
    expect(extraSizesWithDefaults({ ...v2, extraSizes: { fence: 12, deck: 20, wall: 10, pergola_l: 4, pergola_w: 3 } })).toBeNull();
    expect(extraSizeRows(house("cal", { extras: ["shed"] }))).toEqual([]);
  });
});

/** Exterior on mobile v5, session 4 (plan §2 screens 9a–9d): one screen per side. */
describe("exterior on mobile v5 — the Each side step on a phone", () => {
  const quick = q({ jobType: "exterior" });
  const steps = stepsFor("exterior", "house", "areas", "range", "whole", true);
  const side = (paint: boolean, shared = false, confirmed = false): ExteriorV2Side =>
    ({ paint, shared, w: 10, h: 2.7, adjusted: false, off: [], add: [], material: null, materialUp: null, confirmed, checked: false, windows: 2, doors: 1, cond: null, size: null } as ExteriorV2Side);
  const house = (sides: ExteriorV2["sides"]): ExteriorV2 => ({
    propertyType: "th", sizeBand: "md", rowPosition: "mid", wall: { down: null, up: null, brickPainted: null, timberPainted: null }, gableFill: null, windowType: "unsure",
    garageCars: null, postKind: null, parts: ["walls"], extras: [], extraSizes: {}, extraWallMaterial: null, sides,
  } as ExteriorV2);
  it("four screens with a bar under the Each side stage; a shared side not painting says so", () => {
    const list = mobileScreensFor(steps, quick, { v2: house({ front: side(true), right: side(false, true), back: side(true), left: side(false, true) }) }).filter((s) => s.step === "sides");
    expect(list.map((s) => s.id)).toEqual(["s-front", "s-right", "s-back", "s-left"]);
    expect(list.map((s) => s.heading)).toEqual(["Front", "Right side", "Back", "Left side"]);
    expect(list.every((s) => s.advance === "bar" && s.stage === "Each side")).toBe(true);
    expect(list[0].sub).toMatch(/Untick what isn't on this side/);
    expect(list[1].sub).toMatch(/Usually a shared wall/);
    expect(sideOfScreen("s-back")).toBe("back");
    expect(sideOfScreen("a-walls")).toBeNull();
  });
  it("the ribbon's side line: ✓ looked at, – not painting", () => {
    expect(sideStatusLine(house({ front: side(true, false, true), right: side(false, true), back: side(true), left: side(false, true) }))).toBe("Front ✓ · Right – · Back · Left –");
  });
});
