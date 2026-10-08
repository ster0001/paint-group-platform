import type { Colour } from "@/lib/painterStatus/evaluate";
import { COLOUR_NAME, LAMPS } from "@/lib/painterStatus/copy";

/**
 * The traffic light (brief §7): four lamps, red to green, in a dark housing.
 * The lit one pulses slowly (CSS; stops under reduced motion). New lights
 * none and rings the housing blue. Always paired with the word — never
 * colour alone (R19). Server-safe: no state, no handlers.
 */
export default function TrafficLight({ colour, big = false }: { colour: Colour; big?: boolean }) {
  return (
    <div className={`tl${big ? " big" : ""}${colour === "new" ? " new" : ""}`} role="img" aria-label={`Traffic light showing ${COLOUR_NAME[colour]}`} data-testid="traffic-light" data-colour={colour}>
      {LAMPS.map((k) => <div key={k} className={`lamp${k === colour ? " on" : ""}`} style={{ "--c": `var(--l-${k})` } as React.CSSProperties} />)}
    </div>
  );
}
