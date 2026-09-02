/**
 * The model behind an interface, so the loop can be driven by a script in
 * tests and by the Anthropic SDK in production (model-anthropic.ts,
 * server-only). SDK types are used as-is — no parallel message shapes.
 */

import type Anthropic from "@anthropic-ai/sdk";

export type ModelRequest = {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  maxTokens: number;
};

export type ModelResponse = {
  content: Anthropic.ContentBlock[];
  stopReason: Anthropic.Message["stop_reason"];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

export interface ModelClient {
  complete(req: ModelRequest): Promise<ModelResponse>;
}

// ---- test doubles ------------------------------------------------------------

export function textTurn(text: string, usage = { inputTokens: 100, outputTokens: 40 }): ModelResponse {
  return {
    content: [{ type: "text", text, citations: null }],
    stopReason: "end_turn",
    usage,
    model: "scripted",
  };
}

export function toolTurn(
  calls: Array<{ name: string; input: Record<string, unknown>; id?: string }>,
  text?: string,
  usage = { inputTokens: 120, outputTokens: 60 },
): ModelResponse {
  const content: Anthropic.ContentBlock[] = [];
  if (text) content.push({ type: "text", text, citations: null });
  calls.forEach((c, i) => content.push({ type: "tool_use", id: c.id ?? `tu-${i + 1}`, name: c.name, input: c.input, caller: { type: "direct" } }));
  return { content, stopReason: "tool_use", usage, model: "scripted" };
}

export function refusalTurn(): ModelResponse {
  return { content: [], stopReason: "refusal", usage: { inputTokens: 50, outputTokens: 0 }, model: "scripted" };
}

type Scripted = ModelResponse | ((req: ModelRequest) => ModelResponse);

/** Answers with the scripted responses in order; records every request. */
export class ScriptedModel implements ModelClient {
  requests: ModelRequest[] = [];
  private queue: Scripted[];
  constructor(turns: Scripted[]) { this.queue = [...turns]; }
  async complete(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(req);
    const next = this.queue.shift();
    if (!next) throw new Error("ScriptedModel: no more scripted turns");
    const res = typeof next === "function" ? next(req) : next;
    return { ...res, model: req.model };
  }
}
