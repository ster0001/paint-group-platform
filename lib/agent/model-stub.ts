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

    if (answer && !ran("answer_gap") && has("answer_gap")) return callTool("answer_gap", { key: answer.key, value: answer.value, provenance: "customer_stated" });
    if (/\b(person|human|someone|talk to (a|some)|call me|ring me)\b/i.test(humanText) && !answer && !ran("request_handoff") && has("request_handoff")) {
      return callTool("request_handoff", { reason: "customer_asked" });
    }
    if (!ran("next_gap") && has("next_gap")) return callTool("next_gap", {});
    const gapRun = ran("next_gap");
    const gap = (gapRun?.result?.status === "ok" ? (gapRun.result.data as { gap: Gap | null }).gap : null) ?? null;
    if (gap && gap.writes[0]?.tool === "hard_stop" && !ran("hard_stop") && has("hard_stop")) return callTool("hard_stop", gap.writes[0].input);
    if (!ran("price_scope") && has("price_scope")) return callTool("price_scope", {});
    if (!gap && !ran("check_thresholds") && has("check_thresholds")) return callTool("check_thresholds", {});

    const priceRun = ran("price_scope");
    const price = priceRun?.result?.status === "ok" ? (priceRun.result.data as PriceScopeResult) : null;
    const answered = ran("answer_gap");
    const parts: string[] = [];
    if (ran("request_handoff")) parts.push("Done — I've asked a person at Paint Group to pick this up. I can keep going in the meantime if you like.");
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
  const raw = lastHuman >= 0 ? (messages[lastHuman].content as string) : "";
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
