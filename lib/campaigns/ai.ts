/**
 * "Write it for me" (session 3.6). SERVER ONLY — holds the API key.
 *
 * The model fills BLOCKS, never HTML. It picks words; the block system decides
 * how they look, so the worst an unlucky generation can do is read poorly —
 * never look broken, never smuggle markup into an email.
 *
 * The risk the brief names is the real one: "one invented warranty term in one
 * email to 63 people outweighs a hundred bland ones." So the prompt forbids
 * inventing, and `validateGenerated` checks the output for the specific claims
 * a painting business cannot afford to make by accident. Anything it flags
 * reaches the writer as a warning on the draft — it never sends.
 */

import Anthropic from "@anthropic-ai/sdk";
import { blockSchema, templateSchema, type Template } from "./blocks";

/** Sonnet 5: this is short-form copy against a tight brief, not analysis, and
 *  it runs per campaign draft. ⚑ M14 (monthly ceiling) is still open. */
export const COPY_MODEL = "claude-sonnet-5";

export type GenerateInput = {
  /** What this email is for, in the office's words. */
  goal: string;
  /** Who it goes to — the segment's own name and description. */
  audience: string;
  /** Only facts the business has stated. The model may use these and nothing
   *  else; anything absent must be left as a gap, not filled. */
  facts?: string[];
  /** Where the button should point. */
  ctaUrl: string;
  ctaLabel?: string;
  companyName?: string;
  /** An existing draft to rewrite rather than start over. */
  existing?: Template | null;
  tone?: "warm" | "plain" | "brief";
};

const SYSTEM = `You write short marketing emails for an Australian residential painting business.

You return BLOCKS, not HTML. The design is already decided; you choose the words.

Absolute rules:

1. NEVER invent a fact. No warranty length, no guarantee, no years in business,
   no number of jobs, no award, no price, no discount, no timeframe — unless it
   was given to you in the facts list. If you want to say something you were not
   told, leave it out. A blander email is always the right trade.

2. Never write "free" unless a free thing is in the facts.

3. Australian English and Australian spelling. No exclamation marks. No
   "unlock", "elevate", "transform your space", "dream home", "we're excited to".
   Write the way a tradesperson talks to a customer they have already met.

4. Short. A headline under nine words. Paragraphs of two or three sentences.
   The whole email should be readable in twenty seconds.

5. One action. Exactly one button block, using the URL you were given.

6. The reason for the email must be obvious in the first sentence. These people
   gave the business their details; the email should read like a follow-up from
   someone who remembers them, not a broadcast.

7. If a photo block would help, use the placeholder "https://photo" as the URL —
   a human will choose the picture. Never invent an image URL.`;

const OUTPUT_TOOL: Anthropic.Tool = {
  name: "write_email",
  description: "Return the finished email as a subject, a preheader and an ordered list of blocks.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Under 45 characters if you can." },
      preheader: { type: "string", description: "The line shown after the subject in an inbox." },
      blocks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["hero", "text", "photo", "bullets", "quote", "button", "offer", "signoff", "divider"] },
            headline: { type: "string" }, sub: { type: "string" }, body: { type: "string" },
            heading: { type: "string" }, items: { type: "array", items: { type: "string" } },
            attribution: { type: "string" }, label: { type: "string" }, url: { type: "string" },
            note: { type: "string" }, detail: { type: "string" }, expiresOn: { type: "string" },
            name: { type: "string" }, imageUrl: { type: "string" }, caption: { type: "string" },
          },
          required: ["kind"],
        },
      },
    },
    required: ["subject", "blocks"],
  },
};

/** Claims a painting business must not make by accident. Each is a phrase the
 *  model might reach for and a reason it is dangerous. */
const CLAIM_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\b(\d+|one|two|three|five|seven|ten)[- ]year (warranty|guarantee)\b/i, why: "states a warranty length" },
  { re: /\blifetime\b/i, why: "says lifetime" },
  { re: /\bguarantee[ds]?\b/i, why: "makes a guarantee" },
  { re: /\b(fully )?insured\b/i, why: "claims insurance cover" },
  { re: /\b(award|award-winning|best in|number one|#1)\b/i, why: "claims an award or ranking" },
  { re: /\b\d+\s*(\+|plus)?\s*(years|yrs)\b/i, why: "states years of experience" },
  { re: /\b\d{1,3}\s*%\s*(off|discount)\b/i, why: "states a discount" },
  { re: /\$\s?\d/i, why: "states a price" },
  { re: /\bfree\b/i, why: "offers something free" },
  { re: /\bsame[- ]day\b|\bnext[- ]day\b|\bwithin \d+ (hours|days)\b/i, why: "promises a timeframe" },
];

/**
 * Every claim in the draft that was not in the facts the business gave.
 *
 * Deliberately blunt: a phrase that merely LOOKS like a claim is flagged, and
 * the writer clears it in one glance. The opposite mistake — a quiet invention
 * that reads perfectly — is the one that costs a customer.
 */
export function validateGenerated(t: Template, facts: string[] = []): string[] {
  const said = facts.join(" ").toLowerCase();
  const text = t.blocks.flatMap((b) => Object.values(b).filter((v) => typeof v === "string") as string[])
    .concat(t.subject, t.preheader).join(" \n ");

  const found = new Map<string, string>();
  for (const { re, why } of CLAIM_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const phrase = m[0].trim();
    // Given as a fact? Then it is the business's own claim, not the model's.
    if (said.includes(phrase.toLowerCase())) continue;
    found.set(why, phrase);
  }
  return [...found].map(([why, phrase]) => `“${phrase}” — ${why}, which you did not give it. Check it or cut it.`);
}

export type GenerateResult =
  | { ok: true; template: Template; warnings: string[] }
  | { ok: false; error: string };

/** One draft. Returns the template and anything a human must look at. */
export async function generateEmail(input: GenerateInput): Promise<GenerateResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "No AI key is set on the server, so writing is unavailable." };

  const facts = (input.facts ?? []).filter((f) => f.trim());
  const prompt = [
    `Business: ${input.companyName || "Paint Group"}, residential painters in Melbourne.`,
    `Who this goes to: ${input.audience}`,
    `What the email is for: ${input.goal}`,
    facts.length ? `Facts you may use (and NOTHING else):\n${facts.map((f) => `- ${f}`).join("\n")}`
      : "You have been given NO facts. Do not state any figure, timeframe, warranty or price.",
    `The button must link to: ${input.ctaUrl}${input.ctaLabel ? ` and read "${input.ctaLabel}"` : ""}`,
    input.tone === "brief" ? "Keep it to three blocks at most."
      : input.tone === "plain" ? "Plain and factual." : "Warm, but not chatty.",
    input.existing ? `Rewrite this existing draft, keeping anything that works:\n${JSON.stringify(input.existing)}` : "",
  ].filter(Boolean).join("\n\n");

  try {
    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.create({
      model: COPY_MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      tools: [OUTPUT_TOOL],
      tool_choice: { type: "tool", name: "write_email" },
      messages: [{ role: "user", content: prompt }],
    });

    const block = res.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    if (!block) return { ok: false, error: "The model didn't return an email." };

    // Parse leniently, then validate strictly: a model that returns one bad
    // block should cost that block, not the whole draft.
    const raw = block.input as { subject?: string; preheader?: string; blocks?: unknown[] };
    const blocks = (raw.blocks ?? [])
      .flatMap((b) => {
        const r = blockSchema.safeParse(b);
        return r.success ? [r.data] : [];
      });

    const parsed = templateSchema.safeParse({
      subject: raw.subject ?? "",
      preheader: raw.preheader ?? "",
      blocks,
    });
    if (!parsed.success) return { ok: false, error: "The draft came back in a shape we couldn't use." };
    if (parsed.data.blocks.length === 0) return { ok: false, error: "The draft came back empty. Try again." };

    return { ok: true, template: parsed.data, warnings: validateGenerated(parsed.data, facts) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The writer is unavailable right now." };
  }
}
