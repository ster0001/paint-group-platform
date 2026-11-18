import { DEFAULT_PAINT_SYSTEMS, topcoatsOf, type PaintSystems, type SystemRule } from "@/lib/pricing/systems";

/**
 * Tom, 19 Nov 2026: the colours question is the deciding factor on the coats, so each answer says the coats it is
 * quoted at — on the phone's colours and bold screens, the outside colours screen and the laptop's job screen.
 *
 * ONE source: the paint-systems table (`lib/pricing/systems.ts`), the same cells the engine prices from, read as
 * the walls' row for an inside job and the exterior row for an outside one. The shipped table is what a customer
 * reads here; a Settings edit to the table moves the engine and these words together on the next deploy, never one
 * without the other. Words only — nothing here is a coat count the engine reads back.
 */
const WORDS = ["", "one", "two", "three", "four", "five"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** "one coat" · "two coats" · "an undercoat and two coats" — the badge's arithmetic (topcoats, the undercoat named). */
export function coatsPhrase(rule: Pick<SystemRule, "coats" | "undercoat">): string {
  const top = topcoatsOf(rule.coats, rule.undercoat);
  const n = `${WORDS[top] ?? String(top)} coat${top === 1 ? "" : "s"}`;
  return rule.undercoat ? `an undercoat and ${n}` : n;
}

/** The phone's three colour answers (the walls' row): Same → one fresh coat; New → two coats; Still deciding is priced as new. */
export function interiorColourCoats(choice: "same" | "new" | "deciding", systems: PaintSystems = DEFAULT_PAINT_SYSTEMS): string {
  if (choice === "same") return `${cap(coatsPhrase(systems.walls.same))} — a freshen up`;
  if (choice === "new") return `${cap(coatsPhrase(systems.walls.new))} on what's changing`;
  return `Priced as new colours — ${coatsPhrase(systems.walls.new)}`;
}

/** The bold question: Yes is the walls' bold system (an undercoat and two); No stays on the plain colour change. */
export function boldCoats(yes: boolean, systems: PaintSystems = DEFAULT_PAINT_SYSTEMS): string {
  return yes ? `${cap(coatsPhrase(systems.walls.bold))} under the new colour` : `${cap(coatsPhrase(systems.walls.new))} — a similar depth of colour`;
}

/** The outside colours (the exterior row): Same → one full coat; New → two; Going much lighter → two, a third if the colour needs it. */
export function exteriorColourCoats(choice: "same" | "new" | "bold", systems: PaintSystems = DEFAULT_PAINT_SYSTEMS): string {
  const rule = systems.exterior[choice];
  const phrase = cap(coatsPhrase(rule)).replace(/ coat(s?)\b/, " full coat$1");
  if (choice === "same") return `${phrase} — colour-matched`;
  if (choice === "new") return `${phrase}, standard preparation`;
  return `${phrase} — a third if the colour needs it, agreed before we start`;
}
