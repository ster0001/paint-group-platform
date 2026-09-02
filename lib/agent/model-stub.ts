/**
 * The DETERMINISTIC model — the phrasing layer replaced by templates.
 *
 * Everything else (question graph, tool contract, guards, persistence, RLS,
 * the editor round trip) is real; only the sentence is templated from the
 * gap's phrasing hint. It exists so the customer journey can be driven end
 * to end in e2e and CI without a live model: same inputs, same words, no
 * cost. Selected with AGENT_MODEL_STUB=1 (the C1 test stack); production
 * uses model-anthropic.ts.
 *
 * Its one interpretive act: a person's message may end in a structured
 * answer marker written by a tap — `[answer key="…" value=…]` — which it
 * turns into an answer_gap call. Free text without a marker gets "tap an
 * option or type a number", never a guess.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelRequest, ModelResponse } from "./model";
import type { Gap, PriceScopeResult } from "./schemas";
import { EXTRACT_TOOL_NAME, heuristicExtract, pastedTextOf } from "./brief-extract";

export const ANSWER_MARKER = /\[answer key="([^"]+)" value=([\s\S]*)\]\s*$/;

export function parseAnswerMarker(text: string): { key: string; value: unknown; text: string } | null {
  const m = text.match(ANSWER_MARKER);
  if (!m) return null;
  try { return { key: m[1], value: JSON.parse(m[2]), text: text.slice(0, m.index).trim() }; } catch { return null; }
}

export function withAnswerMarker(text: string, answer: { key: string; value: unknown } | null | undefined): string {
  if (!answer) return text;
  return `${text.trim()}\n\n[answer key="${answer.key}" value=${JSON.stringify(answer.value)}]`;
}

type ToolRun = { name: string; input: Record<string, unknown>; result: { status: string; data?: unknown; reason?: string } | null };

const dollars = (c: number) => `$${Math.round(c / 100).toLocaleString("en-AU")}`;

export class StubModel implements ModelClient {
  async complete(req: ModelRequest): Promise<ModelResponse> {
    const { humanText, answer, runs } = readTurn(req.messages);
    const ran = (n: string) => runs.find((r) => r.name === n);
    const callTool = (name: string, input: Record<string, unknown>): ModelResponse => ({
      content: [{ type: "tool_use", id: `stub-${name}-${runs.length + 1}`, name, input, caller: { type: "direct" } }],
      stopReason: "tool_use", usage: { inputTokens: 0, outputTokens: 0 }, model: "stub",
    });
    const say = (text: string): ModelResponse => ({
      content: [{ type: "text", text, citations: null }], stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 }, model: "stub",
    });
    const has = (n: string) => req.tools.some((t) => t.name === n);

    // The extraction request: read the pasted text with the rule-based reader.
    if (has(EXTRACT_TOOL_NAME)) {
      const last = req.messages.at(-1);
      const raw = last && typeof last.content === "string" ? last.content : "";
      return callTool(EXTRACT_TOOL_NAME, heuristicExtract(pastedTextOf(raw)) as unknown as Record<string, unknown>);
    }
    const cowork = has("apply_diff");
    // A tap on the callback form (support / guided): window + phone.
    if (answer?.key === "callback" && !ran("request_callback") && has("request_callback")) {
      const v = (answer.value ?? {}) as { window?: string; phoneE164?: string };
      return callTool("request_callback", { window: v.window ?? "any", phoneE164: v.phoneE164 ?? "" });
    }
    if (ran("request_callback")) {
      const r = ran("request_callback")!.result;
      return say(r?.status === "ok" ? `Booked — we'll call you ${String((r.data as { forDate: string }).forDate)}. You can keep going with me in the meantime.` : `I couldn't book that: ${r?.reason ?? "something went wrong"}.`);
    }
    const support = has("lookup_brain");

    // Hard stops are code (§2 rule 5): haggling, margin fishing, abuse → the
    // scripted response; the turn loop forces the script into the reply.
    const stopKind = !cowork && !answer ? hardStopIntent(humanText) : null;
    if (stopKind && has("hard_stop") && !ran("hard_stop")) return callTool("hard_stop", { kind: stopKind });
    if (stopKind && ran("hard_stop")) {
      const r = ran("hard_stop")!.result;
      if (r?.status === "ok") return say(String((r.data as { script: string }).script));
      return say("I'll leave that one for a person at Paint Group — tap “Talk to a person”.");
    }
    if (!cowork && !answer && ABUSE.test(humanText) && has("request_handoff") && !ran("request_handoff")) return callTool("request_handoff", { reason: "sentiment" });
    if (support) return supportStep(runs, humanText, has, callTool, say);

    if (answer && !ran("answer_gap") && has("answer_gap")) return callTool("answer_gap", { key: answer.key, value: answer.value, provenance: cowork ? "human_confirmed" : "customer_stated" });
    if (cowork && /^(apply|apply it|go ahead|yes,? apply)\b/i.test(humanText) && !answer && !ran("apply_diff")) return callTool("apply_diff", { diffId: "pending" });
    if (!answer && !ran("propose_diff") && has("propose_diff") && (humanText.length >= 60 || /\n/.test(humanText)) && !/\b(person|human)\b/i.test(humanText)) {
      return callTool("propose_diff", { text: humanText, sourceKind: "paste" });
    }
    if (/\b(person|human|someone|talk to (a|some)|call me|ring me)\b/i.test(humanText) && !answer && !ran("request_handoff") && has("request_handoff")) {
      return callTool("request_handoff", { reason: "customer_asked" });
    }
    if (cowork && !ran("list_gaps") && has("list_gaps")) return callTool("list_gaps", {});
    if (!cowork && !ran("next_gap") && has("next_gap")) return callTool("next_gap", {});
    const gapRun = ran("next_gap");
    const listRun = ran("list_gaps");
    const gaps: Gap[] = listRun?.result?.status === "ok" ? (listRun.result.data as { gaps: Gap[] }).gaps : [];
    const gap = (gapRun?.result?.status === "ok" ? (gapRun.result.data as { gap: Gap | null }).gap : null) ?? gaps[0] ?? null;
    if (gap && gap.writes[0]?.tool === "hard_stop" && !ran("hard_stop") && has("hard_stop")) return callTool("hard_stop", gap.writes[0].input);
    if (!ran("price_scope") && has("price_scope")) return callTool("price_scope", {});
    if (!gap && !ran("check_thresholds") && has("check_thresholds")) return callTool("check_thresholds", {});

    const priceRun = ran("price_scope");
    const price = priceRun?.result?.status === "ok" ? (priceRun.result.data as PriceScopeResult) : null;
    const answered = ran("answer_gap");
    const parts: string[] = [];
    if (cowork) return say(coworkText(runs, gaps, price));
    if (ran("request_handoff")) parts.push(ran("request_handoff")!.result?.status === "ok" ? "Done — I've asked a person at Paint Group to pick this up. They'll reply right here." : "");
    if (answered?.result?.status === "refused") parts.push("Let's try that again.");
    else if (answered?.result?.status === "ok" && (answered.result.data as { built?: boolean })?.built) parts.push("Thanks — your estimate is taking shape on the right.");
    else if (answered?.result?.status === "ok") parts.push("Got it.");
    if (!answer && humanText && !ran("request_handoff") && !ran("hard_stop")) parts.push("Tap an option below, or type a number — then I'll carry on.");
    if (gap) {
      parts.push(gap.phrasingHint);
    } else {
      const th = ran("check_thresholds");
      const t = th?.result?.status === "ok" ? (th.result.data as { outcome: string; reasons: string[] }) : null;
      if (price?.showNumber) {
        parts.push(`That's everything I need. Your estimate comes to ${dollars(price.loCents)} – ${dollars(price.hiCents)} including GST.`);
        if (t?.outcome === "self_serve") parts.push("You can accept it online now, or keep shaping it on the right.");
        else if (t?.reasons?.[0]) parts.push(t.reasons[0]);
      } else {
        parts.push("That's everything I need — your estimate is ready to review on the right.");
        if (t?.reasons?.[0]) parts.push(t.reasons[0]);
      }
    }
    return say(parts.join(" "));
  }
}

/** The last human message, its marker, and every tool call made since. */
function readTurn(messages: Anthropic.MessageParam[]): { humanText: string; answer: { key: string; value: unknown } | null; runs: ToolRun[] } {
  let lastHuman = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") { lastHuman = i; break; }
  }
  // Staff turns arrive as "[Staff member] …" (turn.ts) — the marker is the same.
  const raw = (lastHuman >= 0 ? (messages[lastHuman].content as string) : "").replace(/^\[Staff member\]\s*/, "");
  const parsed = parseAnswerMarker(raw);
  const runs: ToolRun[] = [];
  const pending = new Map<string, ToolRun>();
  for (let i = lastHuman + 1; i < messages.length; i++) {
    const m = messages[i];
    if (typeof m.content === "string") continue;
    for (const block of m.content) {
      if (block.type === "tool_use") {
        const run: ToolRun = { name: block.name, input: (block.input ?? {}) as Record<string, unknown>, result: null };
        runs.push(run); pending.set(block.id, run);
      } else if (block.type === "tool_result") {
        const run = pending.get(block.tool_use_id);
        if (!run) continue;
        const text = typeof block.content === "string" ? block.content : Array.isArray(block.content) ? block.content.map((c) => (c.type === "text" ? c.text : "")).join("") : "";
        try { run.result = JSON.parse(text); } catch { run.result = { status: "error" }; }
      }
    }
  }
  return { humanText: parsed ? parsed.text : raw.trim(), answer: parsed ? { key: parsed.key, value: parsed.value } : null, runs };
}

/** Staff-tone reply: terse, the two $/hr figures, the proposal's parts. */
function coworkText(runs: ToolRun[], gaps: Gap[], price: PriceScopeResult | null): string {
  const parts: string[] = [];
  const proposed = runs.find((r) => r.name === "propose_diff");
  const applied = runs.find((r) => r.name === "apply_diff");
  const answered = runs.find((r) => r.name === "answer_gap");
  if (proposed?.result?.status === "refused") parts.push(`Couldn't propose: ${proposed.result.reason}`);
  if (proposed?.result?.status === "ok") {
    const d = proposed.result.data as { added: Array<{ areaName: string; surfaces: string[] }>; changed: Array<{ areaName: string; what: string }>; assumed: Array<{ label: string }>; groups: { price: string[]; cosmetic: string[] }; injectedInstructions: string[]; unmapped: string[]; priced: { loCents: number; hiCents: number } | null };
    // Quoted verbatim in the panel; in the reply any $ figure inside the
    // injected text is masked — a number in a reply must be a tool's, not an attacker's.
    if (d.injectedInstructions.length) parts.push(`The pasted text contained instructions — ignored: "${d.injectedInstructions.map((t) => t.replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, "[amount]")).join('" · "')}".`);
    parts.push(`Proposed: ${d.added.length} area${d.added.length === 1 ? "" : "s"}${d.added.length ? ` (${d.added.map((a) => a.areaName).join(", ")})` : ""}${d.changed.length ? `; ${d.changed.length} changed` : ""}.`);
    if (d.assumed.length) parts.push(`Fill-ins: ${d.assumed.map((a) => a.label).join("; ")}.`);
    if (d.unmapped.length) parts.push(`Not on the rate card (amber, visit tier): ${d.unmapped.join("; ")}.`);
    parts.push(`Gaps — price impact: ${d.groups.price.length}; cosmetic: ${d.groups.cosmetic.length}.`);
  }
  if (applied?.result?.status === "ok") {
    const a = applied.result.data as { rows: number; totalCents: number | null };
    parts.push(`Applied — ${a.rows} rows now live${a.totalCents != null ? ` at ${dollars(a.totalCents)} incl. GST` : ""}.`);
  }
  if (applied?.result?.status === "refused") parts.push(applied.result.reason ?? "Nothing to apply.");
  if (answered?.result?.status === "ok") parts.push("Noted.");
  if (answered?.result?.status === "refused") parts.push("That answer didn't land — see below.");
  if (price) {
    parts.push(`${price.pending ? "Proposed" : "Live"} price ${dollars(price.loCents)} – ${dollars(price.hiCents)} incl. GST (charge-out $${Math.round(price.chargeOutCentsPerHr / 100)}/hr · revenue $${Math.round(price.revenueCentsPerHr / 100)}/hr, ${price.accuracyPct}% settled).`);
  }
  const open = gaps.filter((g) => g.kind === "required").slice(0, 4);
  if (open.length) parts.push(`Still needed: ${open.map((g) => g.phrasingHint).join(" · ")}`);
  if (proposed?.result?.status === "ok" && !applied) parts.push("Say “apply” to apply it.");
  if (parts.length === 0) parts.push(gaps[0]?.phrasingHint ?? "Paste a brief, or tell me what to change.");
  return parts.join(" ");
}

/** Support mode: this estimate's data first, then the Brain, then a person. */
function supportStep(
  runs: ToolRun[], text: string, has: (n: string) => boolean,
  callTool: (name: string, input: Record<string, unknown>) => ModelResponse, say: (t: string) => ModelResponse,
): ModelResponse {
  const ran = (n: string) => runs.find((r) => r.name === n);
  const t = text.toLowerCase();
  const wantsVisitFirst = /\b(visit|come out|come and (see|look)|inspect|look at it|site)\b/.test(t);
  const wantsPerson = !wantsVisitFirst && /\b(talk to|speak to|speak with|chat to)\b.*\b(person|someone|human|staff)\b|\b(a person|a human|call me|ring me)\b/.test(t);
  const wantsChange = /\b(add|remove|drop|take out|swap|change|include|leave out|also paint|don'?t paint)\b/.test(t) && !/\b(how|why|what)\b/.test(t);
  const wantsVisit = /\b(visit|come out|come and (see|look)|inspect|look at it|site)\b/.test(t);
  const aboutEstimate = /\b(included|include|why|how much|range|price|cost|estimate|quote|rooms?|surfaces?|walls?|ceilings?|trim|doors?|windows?|confirm)\b/.test(t);

  if (wantsPerson && !ran("request_handoff") && has("request_handoff")) return callTool("request_handoff", { reason: "customer_asked" });
  if (ran("request_handoff")) {
    const r = ran("request_handoff")!.result;
    // Refused = closed just now: the reason (next opening + callback offer) is relayed by the loop.
    return say(r?.status === "ok" ? "Done — I've asked a person at Paint Group to pick this up. They'll reply right here; hang on a moment." : "");
  }
  if (wantsChange && !ran("request_change") && has("request_change")) return callTool("request_change", { areaId: null, text: text.slice(0, 2000) });
  if (ran("request_change")) {
    const r = ran("request_change")!.result;
    if (r?.status === "ok") {
      const flag = String((r.data as { flagId: string }).flagId);
      return say(flag.startsWith("editor:") ? "You can make that change yourself — your estimate is still open to edit. I've pointed you at the right area." : "Logged for the team — they'll reprice it and update your estimate, and you'll hear back here.");
    }
    return say("I couldn't log that — a person can. Tap “Talk to a person”.");
  }
  if (wantsVisit && !ran("visit_policy") && has("visit_policy")) return callTool("visit_policy", {});
  if (ran("visit_policy")) {
    const r = ran("visit_policy")!.result;
    if (r?.status === "ok") {
      const v = r.data as { tier: string; reasons: string[] };
      if (v.tier === "self_serve" && !ran("open_visit_booking") && has("open_visit_booking")) return callTool("open_visit_booking", {});
      const url = ran("open_visit_booking")?.result?.status === "ok" ? (ran("open_visit_booking")!.result!.data as { url: string }).url : null;
      return say(v.tier === "self_serve" ? `Easy — pick a time that suits${url ? ` here: ${url}` : ""}. ${v.reasons[0] ?? ""}`.trim() : `We'll call you to arrange the visit — ${v.reasons.join(" ")}`);
    }
  }
  if (aboutEstimate && !ran("explain_estimate") && has("explain_estimate")) return callTool("explain_estimate", { question: text.slice(0, 2000) });
  if (ran("explain_estimate")) {
    const r = ran("explain_estimate")!.result;
    return say(r?.status === "ok" ? String((r.data as { answer: string }).answer) : "I couldn't read the estimate just now — a person can help.");
  }
  if (!ran("lookup_brain")) return callTool("lookup_brain", { query: text.slice(0, 2000), audience: "customer" });
  const b = ran("lookup_brain")!.result;
  if (b?.status === "ok") {
    const d = b.data as { found: boolean; entries: Array<{ topic: string; answer: string }> };
    if (d.found) return say(`${d.entries[0].answer.replace(/\s+/g, " ").trim()} (From our Brain: ${d.entries[0].topic}.)`);
    return say("I don't have an entry for that yet, and I won't guess. Would you like a person to answer? Tap “Talk to a person” and they'll reply here.");
  }
  return say("I couldn't check that just now — a person can help. Tap “Talk to a person”.");
}

const ABUSE = /\b(fuck\w*|shit|useless|idiot|stupid|hopeless|pathetic)\b/i;

/** What a person is really asking for when the words go past the estimate. */
export function hardStopIntent(text: string): "discount" | "margin" | null {
  const t = text.toLowerCase();
  if (/\b(discount|cheaper|knock (something|a bit|\$?\d+) off|best price|do better on (the )?price|match (a|their|that) quote|beat (a|their|that) quote|% off|percent off|round (it )?down)\b/.test(t) || /\d+\s?% off/.test(t)) return "discount";
  if (/\b(margin|mark[- ]?up|what do you pay (the|your) (painters?|contractors?)|contractor rate|how much (do|does) (the |your )?painters? (get|earn|make)|your cut|profit)\b/.test(t)) return "margin";
  return null;
}
