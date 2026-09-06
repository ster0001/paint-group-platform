/**
 * A typed Australian address → its parts (Phase 4 of the 6 Sep estimator plan).
 *
 * The assistant's address question used to accept only structured fields, so
 * "14 Murrumbeena Rd, Murrumbeena 3163" typed in one line was refused with
 * "I need at least the suburb or postcode" — while both were in the message.
 * This is the forgiving read: the 4-digit postcode anchors the parse, the
 * suburb is the words between the last comma (or the street type) and the
 * postcode, the street is what came before. Good enough to record the
 * answer; the wizard's Places lookup still settles the exact address later.
 */

export type AddressParts = { street: string; suburb: string; state: string; postcode: string; formatted: string };

const STATES = ["VIC", "NSW", "QLD", "SA", "WA", "TAS", "ACT", "NT"];
const STREET_TYPES = /\b(st|street|rd|road|ave|avenue|cres|crescent|ct|court|dr|drive|pl|place|gr|grove|cl|close|pde|parade|hwy|highway|ln|lane|way|tce|terrace|bvd|blvd|boulevard|cct|circuit|esp|esplanade|sq|square)\b\.?/i;

/** Null when nothing address-shaped is there (no postcode and no comma-separated suburb). */
export function parseAddressText(input: string): AddressParts | null {
  const text = input.replace(/\s+/g, " ").trim();
  if (!text) return null;
  let rest = text;
  let state = "";
  let postcode = "";
  const pc = rest.match(/\b(\d{4})\b(?!.*\b\d{4}\b)/);
  if (pc) { postcode = pc[1]; rest = (rest.slice(0, pc.index) + rest.slice(pc.index! + 4)).trim(); }
  const st = rest.match(new RegExp(`\\b(${STATES.join("|")})\\b\\.?`, "i"));
  if (st) { state = st[1].toUpperCase(); rest = (rest.slice(0, st.index) + rest.slice(st.index! + st[0].length)).trim(); }
  rest = rest.replace(/[,\s]+$/, "").replace(/^[,\s]+/, "");

  let street = "";
  let suburb = "";
  const comma = rest.lastIndexOf(",");
  if (comma >= 0) {
    street = rest.slice(0, comma).trim();
    suburb = rest.slice(comma + 1).trim();
  } else {
    const m = rest.match(STREET_TYPES);
    if (m && m.index != null) {
      street = rest.slice(0, m.index + m[0].length).trim();
      suburb = rest.slice(m.index + m[0].length).trim();
    } else if (postcode) {
      suburb = rest; // "Murrumbeena 3163"
    }
  }
  suburb = suburb.replace(/[.,]+$/, "").trim();
  street = street.replace(/[.,]+$/, "").trim();
  if (!suburb && !postcode) return null;
  const stateOut = state || "VIC";
  const formatted = [street, [suburb, stateOut, postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return { street: street.slice(0, 120), suburb: suburb.slice(0, 80), state: stateOut, postcode: postcode.slice(0, 10), formatted: formatted.slice(0, 250) };
}
