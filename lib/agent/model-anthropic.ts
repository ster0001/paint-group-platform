import "server-only";
/**
 * The production ModelClient. Streams (so a long reply never trips the HTTP
 * timeout) and returns the final message. No thinking parameter: the
 * Haiku-class default does not take adaptive thinking, and the Sonnet-class
 * heavy model runs adaptive when the parameter is omitted. The model id is
 * whatever Settings says — never a constant here (§2 rule 9).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelRequest, ModelResponse } from "./model";

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;
  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const stream = this.client.messages.stream({
      model: req.model,
      max_tokens: req.maxTokens,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      tools: req.tools,
      messages: req.messages,
    });
    const msg = await stream.finalMessage();
    return {
      content: msg.content,
      stopReason: msg.stop_reason,
      usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
      model: msg.model,
    };
  }
}
