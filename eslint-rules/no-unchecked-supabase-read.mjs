/**
 * A list read that ignores its error renders as "there is nothing here".
 *
 * 16 Sep 2026: `chase_hold_reason` reached production before its migration,
 * Postgres rejected every invoice select, and `const { data: invoices } = await
 * supabase.from("invoices").select(...)` quietly produced `null` → `[]`. The
 * Invoicing dashboard drew $0 tiles and "Nothing here — change the filter" over
 * a full ledger, and Tom read it as every invoice having been deleted. The same
 * shortcut in a background sweep is worse: the unpaid-invoice reminders simply
 * stopped sending and nothing said so.
 *
 * An empty array is equally the signature of a rejected query or a missing RLS
 * policy. So: destructure `error` alongside `data` and decide what to do with
 * it — `lib/invoicing/loadFailure.ts` is the house pattern for turning one into
 * a line the screen can show.
 *
 * ---- the baseline ----
 * 180 such reads already existed when this rule landed, and fixing them is a
 * parked audit, not this rule's job. So the rule is a RATCHET, not a gate: each
 * file is allowed the number of unchecked reads it had on 16 Sep 2026, listed
 * in unchecked-read-baseline.json. One more than that — a new read, or a whole
 * new file — is an error. Counts are per file, so line numbers never go stale.
 *
 * Clear some and LOWER the file's number (or delete the entry). Never raise one:
 * raising it is how 180 becomes 400.
 */

/**
 * Does this initialiser look like a Supabase/PostgREST read?
 *
 * Deliberately keyed on the CALL, not on what the client variable is called.
 * An earlier version also required the name to be one of supabase/sb/db/client
 * /admin, which silently missed every `await service.from(...)` in
 * lib/invoicing — the exact code this rule exists to police. `.from()` on the
 * standard library (Array, Buffer, …) never yields a `{ data }` shape, but it
 * is excluded anyway so the intent stays obvious.
 */
const STDLIB_FROM = /\b(?:Array|Buffer|Object|Map|Set|String|Number|Date|Uint8Array|Int8Array)\.from\s*\(/g;

function isSupabaseRead(text) {
  return /\.(from|rpc)\s*\(/.test(text.replace(STDLIB_FROM, ""));
}

/** Every ObjectPattern in a binding — covers `const [{ data: a }, { data: b }] = await Promise.all(...)`. */
function objectPatterns(node, out = []) {
  if (!node) return out;
  if (node.type === "ObjectPattern") out.push(node);
  else if (node.type === "ArrayPattern") for (const el of node.elements) objectPatterns(el, out);
  else if (node.type === "AssignmentPattern") objectPatterns(node.left, out);
  return out;
}

const named = (pattern, want) =>
  pattern.properties.some((p) => p.type === "Property" && p.key?.type === "Identifier" && p.key.name === want);

const rule = {
  meta: {
    type: "problem",
    docs: { description: "A Supabase read must handle its error, or an empty result lies about the data." },
    schema: [{ type: "object", additionalProperties: { type: "number" } }],
    messages: {
      unchecked:
        "This read takes `data` and drops `error`, so a rejected query renders as an empty list — the 16 Sep 2026 invoicing outage. Destructure `error` too and surface it (see lib/invoicing/loadFailure.ts). If this read genuinely cannot mislead anyone, raise the file's count in eslint-rules/unchecked-read-baseline.json and say why in the PR.",
    },
  },

  create(context) {
    const baseline = context.options[0] ?? {};
    const rel = context.filename.replace(`${process.cwd()}/`, "");
    const allowed = baseline[rel] ?? 0;
    const found = [];

    return {
      VariableDeclarator(node) {
        if (!node.init) return;
        const text = context.sourceCode.getText(node.init);
        if (!isSupabaseRead(text)) return;
        for (const pattern of objectPatterns(node.id)) {
          if (named(pattern, "data") && !named(pattern, "error")) found.push(pattern);
        }
      },

      "Program:exit"() {
        // Only the reads BEYOND the file's baseline are reported, so the parked
        // 180 stay quiet while a 181st cannot land.
        for (const pattern of found.slice(allowed)) {
          context.report({ node: pattern, messageId: "unchecked" });
        }
      },
    };
  },
};

export default rule;
