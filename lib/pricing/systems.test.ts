import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAINT_SYSTEMS,
  DEFAULT_SURFACE_FLAGS,
  PAINT_SYSTEMS_KEY,
  SYSTEM_GROUPS,
  colourIntentFromTier,
  conditionBandFromDamageTier,
  deriveSystem,
  groupForSubstrate,
  paintSystemsFrom,
  systemsForSurfaces,
  type ColourIntent,
  type SystemAnswers,
  type SystemGroup,
} from "./systems";
import { coatMultiplier, hoursPerUnit } from "./engine";
import type { RateItem } from "./types";

const answers = (over: Partial<SystemAnswers> = {}): SystemAnswers => ({
  colourIntent: "new", condition: "wear", glossTrims: "no", ...over,
});

const coatsOf = (group: SystemGroup, over: Partial<SystemAnswers> = {}) =>
  deriveSystem(group, answers(over)).coats;

describe("the acceptance criteria (plan §9.3)", () => {
  /**
   * "2-coat and 3-coat totals unchanged" — the derivation is a NEW layer in
   * front of the engine, not a change to it. A line priced at n coats costs
   * exactly what it always did, so no existing estimate moves because this
   * module exists.
   */
  it("leaves the engine's coat arithmetic alone", () => {
    expect(coatMultiplier(1)).toBe(1);
    expect(coatMultiplier(2)).toBe(1.75);
    expect(coatMultiplier(3)).toBe(2.5);

    // And the card's own columns stay authoritative for 1–3.
    const item: RateItem = {
      code: "Walls", category: "Interior", unit: "M2",
      rate_1_coat: 20, rate_2_coat: 12, rate_3_coat: 9, charge_out_cents: 8500,
    };
    expect(hoursPerUnit(item, 1)).toBeCloseTo(1 / 20);
    expect(hoursPerUnit(item, 2)).toBeCloseTo(1 / 12);
    expect(hoursPerUnit(item, 3)).toBeCloseTo(1 / 9);
  });

  /**
   * "single coat only via same-colour" — the allowances-spec §7.6 guard,
   * which is per SURFACE, not per job. Ceilings are the deliberate exception
   * and are asserted on their own terms below: on a new-colour job they stay
   * white, so nothing about them is changing colour and ⚑3's single coat is
   * legitimate. Every other group takes the job's intent as its own.
   */
  it("never derives a single coat for a surface that is changing colour", () => {
    for (const group of SYSTEM_GROUPS) {
      for (const intent of ["new", "bold"] as ColourIntent[]) {
        for (const condition of ["good", "wear", "work"] as const) {
          const ceilingsChangingColour = group === "ceilings";
          const s = deriveSystem(group, answers({ colourIntent: intent, condition, ceilingsChangingColour }));
          expect(s.coats, `${group}/${intent}/${condition}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("lets a ceiling staying white keep its single coat on a new-colour job", () => {
    const s = deriveSystem("ceilings", answers({ colourIntent: "new", ceilingsChangingColour: false }));
    expect(s.coats).toBe(1);
    expect(s.reason).toBe("");
  });

  it("holds that guard even when Settings says one coat for a colour change", () => {
    const sabotaged = paintSystemsFrom({
      ...DEFAULT_PAINT_SYSTEMS,
      walls: { ...DEFAULT_PAINT_SYSTEMS.walls, new: { coats: 1, undercoat: false, sentence: "One coat." } },
    });
    expect(sabotaged.walls.new.coats).toBe(1); // Settings took the value…
    const s = deriveSystem("walls", answers({ colourIntent: "new" }), sabotaged);
    expect(s.coats).toBe(2); // …and the guard refused to quote it.
    expect(s.reason).toBe("one coat will not cover a colour change");
  });

  /**
   * "a same-colour job and a new-colour job differ only in walls and trims"
   * — doors follow the trims row, so they move with trims; ceilings (white
   * again) and windows do not move at all.
   */
  /**
   * The plan's §9.3 criterion was "a same-colour and a new-colour job differ
   * only in walls and trims". That held for the plan's OWN proposed table.
   * Tom's rulings of 9 Sep changed it: same-colour windows are one coat
   * ("generally 1"), so windows moves too, and exterior now derives at all.
   *
   * What still holds — and is the point the criterion was protecting — is that
   * CEILINGS do not move: a white ceiling is a white ceiling whatever the
   * walls are doing.
   */
  it("moves the surfaces that change colour, and never the ceilings", () => {
    const moved: SystemGroup[] = [];
    for (const group of SYSTEM_GROUPS) {
      if (coatsOf(group, { colourIntent: "same" }) !== coatsOf(group, { colourIntent: "new" })) moved.push(group);
    }
    expect(moved).toEqual(["walls", "trims", "doors", "windows", "exterior"]);
    expect(coatsOf("ceilings", { colourIntent: "same" })).toBe(coatsOf("ceilings", { colourIntent: "new" }));
  });
});

describe("the table (plan §4.2 with ⚑3/⚑4/⚑5)", () => {
  it("walls: one coat same, two new, undercoat + two when TICKED dark-to-light", () => {
    expect(coatsOf("walls", { colourIntent: "same" })).toBe(1);
    expect(coatsOf("walls", { colourIntent: "new" })).toBe(2);
    /**
     * ⚑ Tom, 10 Sep: on a dark-to-light job the TICK earns the extra coat —
     * "anything not ticked will be quoted with 2 coats as standard". A bold
     * job used to put every surface on the bold system, which made the
     * question theatre and quoted a third coat on surfaces nobody said were
     * changing.
     */
    expect(coatsOf("walls", { colourIntent: "bold" })).toBe(2);
    const ticked = deriveSystem("walls", answers({ colourIntent: "bold", darkToLight: true }));
    expect(ticked.coats).toBe(3);
    expect(ticked.undercoat).toBe(true);
  });

  it("⚑3 ceilings: one coat white-on-white, two when they're marked", () => {
    expect(coatsOf("ceilings", { colourIntent: "new" })).toBe(1);
    const marked = deriveSystem("ceilings", answers({ ceilingsMarked: true }));
    expect(marked.coats).toBe(2);
    expect(marked.reason).toBe("the ceilings are marked or already coloured");
    expect(marked.crewNote).toContain("stain-block");
  });

  it("⚑3: a ceiling actually changing colour cannot be one coat", () => {
    const s = deriveSystem("ceilings", answers({ ceilingsChangingColour: true }));
    expect(s.coats).toBe(2);
    expect(s.reason).toBe("one coat will not cover a colour change");
  });

  /**
   * ⚑4 REVERSED (Tom, 9 Sep): "on a same colour job with sound trims our crew
   * would put 1 coat generally, with a spot prime for scuff marks." The plan
   * proposed two and I shipped it; it was most of the +17–25% same-colour
   * movement and it was wrong. Damage is priced as PREP now, not as a coat of
   * paint nobody applies.
   */
  it("trims: ONE coat on a same-colour job, whatever the condition", () => {
    for (const condition of ["good", "wear", "work"] as const) {
      expect(coatsOf("trims", { colourIntent: "same", condition }), condition).toBe(1);
    }
    expect(deriveSystem("trims", answers({ colourIntent: "same" })).sentence).toMatch(/spot-prime/i);
  });

  it("doors follow the trims on a same-colour job", () => {
    expect(coatsOf("doors", { colourIntent: "same" })).toBe(1);
  });

  it("⚑4: good condition does NOT drop new-colour trims to one coat", () => {
    expect(coatsOf("trims", { colourIntent: "new", condition: "good" })).toBe(3);
  });

  it("⚑5 gloss: yes adds a bonding primer, unsure prices as no but flags review", () => {
    const yes = deriveSystem("trims", answers({ glossTrims: "yes" }));
    const no = deriveSystem("trims", answers({ glossTrims: "no" }));
    expect(yes.coats).toBe(no.coats + 1);
    expect(yes.undercoat).toBe(true);
    expect(yes.crewNote).toContain("bonding primer");
    expect(no.review).toBe(false);

    const unsure = deriveSystem("trims", answers({ glossTrims: "unsure" }));
    expect(unsure.coats).toBe(no.coats);
    expect(unsure.review).toBe(true);
    expect(unsure.crewNote).toContain("oil-based");
  });

  it("⚑5: an unanswered gloss question behaves as 'not sure', never as 'no'", () => {
    const missing = deriveSystem("trims", { colourIntent: "new", condition: "wear" });
    expect(missing.review).toBe(true);
  });

  it("⚑5 applies to doors as well as trims, and to nothing else", () => {
    expect(deriveSystem("doors", answers({ glossTrims: "yes" })).coats)
      .toBe(deriveSystem("doors", answers({ glossTrims: "no" })).coats + 1);
    expect(deriveSystem("walls", answers({ glossTrims: "yes" })).coats)
      .toBe(deriveSystem("walls", answers({ glossTrims: "no" })).coats);
    expect(deriveSystem("walls", answers({ glossTrims: "unsure" })).review).toBe(false);
  });

  it("a dark-to-light surface is bold whatever the job-wide intent was", () => {
    expect(coatsOf("walls", { colourIntent: "same", darkToLight: true })).toBe(3);
  });
});

describe("prep hours", () => {
  it("default to zero, so nothing reprices the day this ships", () => {
    for (const band of ["good", "wear", "work"] as const) {
      expect(deriveSystem("walls", answers({ condition: band })).prepHrPerUnit).toBe(0);
    }
  });

  it("carry the band's hours once Tom sets them", () => {
    const tuned = paintSystemsFrom({ prepHrPerUnit: { good: 0, wear: 0.01, work: 0.03 } });
    expect(deriveSystem("walls", answers({ condition: "work" }), tuned).prepHrPerUnit).toBe(0.03);
    expect(deriveSystem("walls", answers({ condition: "good" }), tuned).prepHrPerUnit).toBe(0);
  });
});

describe("substrate → group", () => {
  it("maps the interior substrates onto their groups", () => {
    expect(groupForSubstrate("walls")).toBe("walls");
    expect(groupForSubstrate("ceilings")).toBe("ceilings");
    expect(groupForSubstrate("cornices")).toBe("ceilings");
    expect(groupForSubstrate("skirting")).toBe("trims");
    expect(groupForSubstrate("architraves")).toBe("trims");
    expect(groupForSubstrate("doors")).toBe("doors");
    expect(groupForSubstrate("windows")).toBe("windows");
  });

  /**
   * Exterior derives now (Tom, 9 Sep). One rule for every exterior substrate,
   * because the substrate list is a way of FINDING things, not a claim that
   * they share a system — Tom's own correction.
   */
  it("puts every exterior substrate on the one exterior rule", () => {
    for (const key of ["weatherboards", "render", "eaves", "fascias", "gutters", "deck", "fence", "brick"] as const) {
      expect(groupForSubstrate(key), key).toBe("exterior");
    }
  });

  /**
   * The two exceptions, and why. Bare brick's rate row already carries
   * `default_coats: 3` — the card is the authority on a substrate that needs
   * more than the rule, and overriding it to 2 would quietly under-coat it.
   * A staircase has no rate row at all.
   */
  it("leaves bare brick and the staircase to the rate card", () => {
    expect(groupForSubstrate("brick_unpainted")).toBeNull();
    expect(groupForSubstrate("staircase")).toBeNull();
    expect(groupForSubstrate(null)).toBeNull();
  });

  /**
   * Tom: "same colour is generally 1 coat; bold can sometimes be 3, but we'd
   * price for 2 and give the client a heads up if a 3rd is required and add it
   * as a variation." So bold is TWO and says so — the third coat is a
   * conversation before it is a charge.
   */
  it("prices exterior at 1 / 2 / 2, and warns about the third coat", () => {
    expect(coatsOf("exterior", { colourIntent: "same" })).toBe(1);
    expect(coatsOf("exterior", { colourIntent: "new" })).toBe(2);
    // Outside, the third coat is a heads-up rather than a tick — the sentence
    // is the promise, so it must survive the interior rule change.
    const bold = deriveSystem("exterior", answers({ colourIntent: "bold", darkToLight: true }));
    expect(bold.coats).toBe(2);
    expect(bold.sentence).toMatch(/need a third/i);
    expect(bold.sentence).toMatch(/before we start that wall/i);
  });

  /** Inside, going from a bold colour to white is ALWAYS three (Tom, 9 Sep). */
  it("takes interior walls to three only when TICKED; the exterior stays at two", () => {
    // Tom, 10 Sep: the tick is what earns the coat, inside. Outside is two
    // either way, with the heads-up about a possible third (Tom, 9 Sep).
    expect(coatsOf("walls", { colourIntent: "bold", darkToLight: true })).toBe(3);
    expect(coatsOf("walls", { colourIntent: "bold" })).toBe(2);
    expect(coatsOf("exterior", { colourIntent: "bold" })).toBe(2);
  });

  it("lists one line per group the job actually has, in the painter's order", () => {
    const lines = systemsForSurfaces(["skirting", "walls", "ceilings", "cornices", "weatherboards"], answers());
    expect(lines.map((l) => l.group)).toEqual(["walls", "ceilings", "trims", "exterior"]);
  });

  it("leaves out groups with nothing ticked", () => {
    const lines = systemsForSurfaces(["skirting", "doors"], answers());
    expect(lines.map((l) => l.group)).toEqual(["trims", "doors"]);
  });
});

describe("the stored answers map across unchanged", () => {
  it("reads condition.tier as colour intent", () => {
    expect(colourIntentFromTier("fresh")).toBe("same");
    expect(colourIntentFromTier("change")).toBe("new");
    expect(colourIntentFromTier("dark_to_light")).toBe("bold");
  });

  it("reads damageTier as a condition band", () => {
    expect(conditionBandFromDamageTier(0)).toBe("good");
    expect(conditionBandFromDamageTier(1)).toBe("wear");
    expect(conditionBandFromDamageTier(2)).toBe("work");
    expect(conditionBandFromDamageTier(3)).toBe("work");
  });
});

describe("the settings row", () => {
  it("is keyed paint_systems", () => {
    expect(PAINT_SYSTEMS_KEY).toBe("paint_systems");
  });

  it("falls back to the defaults on an empty, missing or junk row", () => {
    for (const junk of [null, undefined, {}, [], "nope", 7]) {
      expect(paintSystemsFrom(junk)).toEqual(DEFAULT_PAINT_SYSTEMS);
    }
  });

  it("keeps an edited cell and fills the rest from the defaults", () => {
    const s = paintSystemsFrom({ ceilings: { new: { coats: 2, undercoat: false, sentence: "Always two." } } });
    expect(s.ceilings.new).toEqual({ coats: 2, undercoat: false, sentence: "Always two." });
    expect(s.ceilings.same).toEqual(DEFAULT_PAINT_SYSTEMS.ceilings.same);
    expect(s.walls).toEqual(DEFAULT_PAINT_SYSTEMS.walls);
    expect(deriveSystem("ceilings", answers(), s).coats).toBe(2);
  });

  it("falls back per cell rather than throwing on a bad value", () => {
    const s = paintSystemsFrom({
      walls: { new: { coats: 99, undercoat: false, sentence: "x" }, same: { coats: 1, undercoat: false, sentence: "One." } },
      ceilingsMarkedCoats: -3,
      prepHrPerUnit: { good: "lots", wear: 0.5, work: 9999 },
    });
    expect(s.walls.new).toEqual(DEFAULT_PAINT_SYSTEMS.walls.new);
    expect(s.walls.same.sentence).toBe("One.");
    expect(s.ceilingsMarkedCoats).toBe(DEFAULT_PAINT_SYSTEMS.ceilingsMarkedCoats);
    expect(s.prepHrPerUnit).toEqual({ good: 0, wear: 0.5, work: 0 });
  });

  it("round-trips its own defaults", () => {
    expect(paintSystemsFrom(DEFAULT_PAINT_SYSTEMS)).toEqual(DEFAULT_PAINT_SYSTEMS);
  });

  it("gives every group a sentence a customer can read", () => {
    for (const group of SYSTEM_GROUPS) {
      for (const intent of ["same", "new", "bold"] as ColourIntent[]) {
        const s = deriveSystem(group, answers({ colourIntent: intent }));
        expect(s.sentence.length, `${group}/${intent}`).toBeGreaterThan(20);
        expect(s.sentence.trim().endsWith("."), `${group}/${intent}`).toBe(true);
      }
    }
  });
});

describe("the card never contradicts itself", () => {
  /**
   * Caught on the real screen (9 Sep): the heading read "Ceilings · 2 coats"
   * above a sentence that still promised "One fresh coat of flat ceiling
   * white". A card whose whole job is to show the derivation honestly cannot
   * say two different things about the same line.
   */
  it("changes the ceilings sentence when 'they're marked' changes the coats", () => {
    const plain = deriveSystem("ceilings", answers());
    const marked = deriveSystem("ceilings", answers({ ceilingsMarked: true }));
    expect(marked.coats).toBeGreaterThan(plain.coats);
    expect(marked.sentence).not.toBe(plain.sentence);
    expect(marked.sentence).not.toMatch(/one fresh coat/i);
  });

  /**
   * The general rule, over every reachable combination.
   *
   * Scoped to lines with NO undercoat, and deliberately. "One coat of enamel,
   * a bonding primer first" alongside a heading of "2 coats (one an
   * undercoat)" is consistent — the sentence is counting topcoats and the
   * heading is counting labour coats, and the heading says which. The failure
   * this guards is the other one: a heading of two coats over a sentence that
   * offers one and explains nothing.
   */
  it("never promises one coat in a sentence while deriving more than one", () => {
    for (const group of SYSTEM_GROUPS) {
      for (const intent of ["same", "new", "bold"] as ColourIntent[]) {
        for (const condition of ["good", "wear", "work"] as const) {
          for (const gloss of ["yes", "no", "unsure"] as const) {
            for (const marked of [true, false]) {
              const s = deriveSystem(group, answers({ colourIntent: intent, condition, glossTrims: gloss, ceilingsMarked: marked }));
              if (s.coats > 1 && !s.undercoat) {
                expect(s.sentence, `${group}/${intent}/${condition}/gloss:${gloss}/marked:${marked}`)
                  .not.toMatch(/\bone (fresh )?coat\b/i);
              }
            }
          }
        }
      }
    }
  });
});

describe("per-surface condition flags (Tom, 9 Sep)", () => {
  /**
   * Tom's question, verbatim: "what if the customer wants to update the
   * number of coats on doors to 3 coats cause they are all stained, but the
   * rest are 2?"
   */
  it("takes stained doors to three coats and leaves the rest at two", () => {
    const a = answers({ colourIntent: "same", flags: { doors: ["stained"] } });
    expect(deriveSystem("doors", a).coats).toBe(3);
    expect(deriveSystem("walls", a).coats).toBe(1);   // same colours
    expect(deriveSystem("trims", a).coats).toBe(1);   // one coat + spot prime
    expect(deriveSystem("ceilings", a).coats).toBe(1);

    const doors = deriveSystem("doors", a);
    expect(doors.undercoat).toBe(true);
    expect(doors.flags).toEqual(["stained"]);
    expect(doors.crewNote).toContain("stain-blocking primer");
    expect(doors.reason).toContain("stained");
    expect(doors.sentence).toContain("blocking primer");
  });

  /**
   * The other half: "if the customer wants to update the ceilings to 1 coat,
   * but everything else 2".
   */
  it("takes sound ceilings down to one coat while the rest stay at two", () => {
    // A bold job where the walls and trims ARE ticked dark-to-light, so the
    // flag is what takes the ceilings back down rather than the tier.
    const a = answers({ colourIntent: "bold", darkToLight: true, flags: { ceilings: ["sound"] } });
    expect(deriveSystem("ceilings", a).coats).toBe(1);
    expect(deriveSystem("walls", a).coats).toBe(3);
    expect(deriveSystem("trims", a).coats).toBe(3);
    // Talking the price down is exactly the case a person should see.
    expect(deriveSystem("ceilings", a).review).toBe(true);
  });

  it("still refuses one coat where THAT surface is changing colour", () => {
    const a = answers({ colourIntent: "new", flags: { ceilings: ["sound"] }, ceilingsChangingColour: true });
    const s = deriveSystem("ceilings", a);
    expect(s.coats).toBe(2);
    expect(s.reason).toBe("one coat will not cover a colour change");
  });

  it("only applies a flag to the groups that offer it", () => {
    // bare_timber is a trims/doors/windows flag; the walls never take it.
    const a = answers({ flags: { walls: ["bare_timber"], doors: ["bare_timber"] } });
    expect(deriveSystem("walls", a).flags).toEqual([]);
    expect(deriveSystem("doors", a).flags).toEqual(["bare_timber"]);
  });

  it("ignores a flag key that no longer exists in the catalogue", () => {
    const a = answers({ flags: { doors: ["was_a_flag_once"] } });
    const plain = deriveSystem("doors", answers());
    expect(deriveSystem("doors", a).coats).toBe(plain.coats);
    expect(deriveSystem("doors", a).flags).toEqual([]);
  });

  it("takes the highest floor when two flags apply, and keeps both notes", () => {
    const a = answers({ colourIntent: "same", flags: { doors: ["stained", "bare_timber"] } });
    const s = deriveSystem("doors", a);
    expect(s.coats).toBe(3);
    expect(s.flags).toEqual(["stained", "bare_timber"]);
    expect(s.crewNote).toContain("stain-blocking primer");
    expect(s.crewNote).toContain("primer before the topcoats");
  });

  it("⚑3's marked ceiling is the same mechanism, and keeps its Settings number", () => {
    const viaFlag = deriveSystem("ceilings", answers({ flags: { ceilings: ["marked"] } }));
    const viaField = deriveSystem("ceilings", answers({ ceilingsMarked: true }));
    expect(viaFlag.coats).toBe(viaField.coats);
    expect(viaFlag.sentence).toBe(viaField.sentence);

    const three = paintSystemsFrom({ ...DEFAULT_PAINT_SYSTEMS, ceilingsMarkedCoats: 3 });
    expect(deriveSystem("ceilings", answers({ ceilingsMarked: true }), three).coats).toBe(3);
  });

  it("falls back to the shipped catalogue when Settings holds junk", () => {
    expect(paintSystemsFrom({ surfaceFlags: "nope" }).surfaceFlags).toEqual(DEFAULT_SURFACE_FLAGS);
    expect(paintSystemsFrom({ surfaceFlags: [] }).surfaceFlags).toEqual(DEFAULT_SURFACE_FLAGS);
  });

  it("follows Tom's own flag when he writes one", () => {
    const table = paintSystemsFrom({
      ...DEFAULT_PAINT_SYSTEMS,
      surfaceFlags: [{
        key: "nicotine", label: "Smoke staining", groups: ["walls", "ceilings"],
        minCoats: 4, undercoat: true,
        sentence: "Smoke staining. A shellac-based sealer, then two full coats.",
        crewNote: "nicotine staining — shellac sealer or it bleeds through",
        reason: "smoke staining bleeds through ordinary paint",
      }],
    });
    const s = deriveSystem("walls", answers({ flags: { walls: ["nicotine"] } }), table);
    expect(s.coats).toBe(4);
    expect(s.crewNote).toContain("shellac");
    // And his list REPLACES the shipped one, so the old keys stop applying.
    expect(deriveSystem("doors", answers({ flags: { doors: ["stained"] } }), table).flags).toEqual([]);
  });
});

describe("crew notes accumulate", () => {
  /**
   * A stained door on a job whose trims might be oil gloss needs BOTH notes.
   * Replacing lost whichever ran first — which is how a painter arrives told
   * to bond-prime a door and not told to stain-block it.
   */
  it("keeps a flag's note and the gloss note together", () => {
    const s = deriveSystem("doors", answers({ flags: { doors: ["stained"] }, glossTrims: "unsure" }));
    expect(s.crewNote).toContain("stain-blocking primer");
    expect(s.crewNote).toContain("check on site");
  });

  it("never repeats a note", () => {
    const s = deriveSystem("doors", answers({ flags: { doors: ["stained", "stained"] } }));
    expect(s.crewNote.split(" | ").length).toBe(new Set(s.crewNote.split(" | ")).size);
  });
});

describe("a flag that changes nothing numerically still changes the words", () => {
  /**
   * Caught on the real screen (9 Sep): on a NEW-colour job the doors already
   * derive three coats, so "they're stained" hit its own floor and moved
   * nothing. The tap looked broken, and the estimate hid the reason it was
   * priced as it was — a stain-blocking primer is not a plain undercoat.
   */
  it("says stained on doors that were already at three coats", () => {
    const plain = deriveSystem("doors", answers({ colourIntent: "new" }));
    const flagged = deriveSystem("doors", answers({ colourIntent: "new", flags: { doors: ["stained"] } }));
    expect(flagged.coats).toBe(plain.coats);            // the number does not move…
    expect(flagged.sentence).not.toBe(plain.sentence);  // …but the words do.
    expect(flagged.sentence).toMatch(/blocking primer/i);
    expect(flagged.reason).toContain("stained");
    expect(flagged.crewNote).toContain("stain-blocking primer");
    expect(flagged.flags).toEqual(["stained"]);
  });
});
