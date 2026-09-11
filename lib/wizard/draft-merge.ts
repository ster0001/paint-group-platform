/**
 * Merging a wizard draft after a 409 — C3.
 *
 * `/api/wizard/draft` used to be last-write-wins. Two tabs, a phone picked up
 * beside a laptop, or a staff member joining an assisted session through
 * `wizard_assist_patch`, and the later write erased the earlier one with nobody
 * the wiser — the route is best-effort by design and answered 200 either way.
 *
 * With `wizard_drafts.version` the write is conditional, and a losing write gets
 * the server's copy back. This decides what the customer ends up with. It is a
 * THREE-way merge, not a two-way one, because "the server changed it" and "I
 * changed it" are only distinguishable against the last state both sides agreed
 * on — the client's last successful save.
 *
 *   base    what I last saved successfully (the common ancestor)
 *   mine    what is on my screen now
 *   theirs  what the server has, written by whoever got there first
 *
 * The rule, per the C3 block: **server wins for confirmed fields, client for
 * unsaved edits.**
 *
 *   · a field I have not touched since `base` → theirs. I have no opinion, and
 *     they may know something I do not.
 *   · a field I HAVE touched → mine. This is the half-typed answer in front of
 *     the customer; taking it away mid-sentence is the one thing worse than the
 *     bug this fixes.
 *   · a confirmation is never withdrawn by a merge. Any `done.*` flag, and the
 *     `answered.*` flags, are ORed — true wins from either side. A confirmation
 *     is a person having positively said "yes, that is right"; losing one
 *     silently would let a job move backwards through the loop and re-ask a
 *     question they already answered.
 *
 * Arrays are taken whole rather than merged element-wise. A room list is
 * ordered and its entries reference each other by index in places; splicing two
 * versions together would produce a tree neither side ever saw. Whoever touched
 * it owns it.
 */

type Json = unknown;
type Obj = Record<string, Json>;

const isObj = (v: Json): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Structural equality, enough for JSON state. */
export function sameJson(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameJson(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameJson(a[k], b[k]));
  }
  return false;
}

/**
 * Paths whose booleans are confirmations: true from either side wins and is
 * never merged away. `done` covers both loop metas (interiorLoop.done.dw,
 * sidesLoop.done.cond, …); `answered` is the wizard's own question flags.
 */
function isConfirmationPath(path: readonly string[]): boolean {
  return path.includes("done") || path[0] === "answered";
}

export type DraftMergeResult = {
  state: Obj;
  /** Dotted paths the server's value was taken for — what the customer did not type. */
  tookFromServer: string[];
  /** Dotted paths the client's value was kept for — what they are working on. */
  keptMine: string[];
};

export function mergeDraftState(base: Json, mine: Json, theirs: Json): DraftMergeResult {
  const tookFromServer: string[] = [];
  const keptMine: string[] = [];

  function walk(b: Json, m: Json, t: Json, path: readonly string[]): Json {
    const dotted = path.join(".");

    // A confirmation, from either side, stands.
    if (isConfirmationPath(path) && (typeof m === "boolean" || typeof t === "boolean")) {
      const merged = m === true || t === true;
      if (merged !== m) tookFromServer.push(dotted);
      return merged;
    }

    if (isObj(m) && isObj(t)) {
      const bb: Obj = isObj(b) ? b : {};
      const out: Obj = {};
      for (const k of new Set([...Object.keys(m), ...Object.keys(t)])) {
        const inMine = Object.prototype.hasOwnProperty.call(m, k);
        const inTheirs = Object.prototype.hasOwnProperty.call(t, k);
        if (inMine && inTheirs) out[k] = walk(bb[k], m[k], t[k], [...path, k]);
        else if (inMine) {
          // A key only I have: I added it, unless base had it and they deleted
          // it — and a delete we cannot distinguish from "never had it" is not
          // worth guessing at. Keep it; an extra answer is recoverable, a lost
          // one is not.
          out[k] = m[k];
          keptMine.push([...path, k].join("."));
        } else if (inTheirs) {
          out[k] = t[k];
          tookFromServer.push([...path, k].join("."));
        }
      }
      return out;
    }

    // A leaf, or a type change, or an array. Did I touch it since base?
    if (sameJson(m, b)) {
      if (!sameJson(t, m)) tookFromServer.push(dotted);
      return t;                       // no opinion — they may know more
    }
    if (!sameJson(m, t)) keptMine.push(dotted);
    return m;                         // my unsaved edit, still on screen
  }

  const merged = walk(base, mine, theirs, []);
  return { state: isObj(merged) ? merged : {}, tookFromServer, keptMine };
}
