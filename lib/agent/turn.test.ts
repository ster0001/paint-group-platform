import { describe, expect, it } from "vitest";
import { MemoryAgentStore, type NewConversation } from "./store";
import { ScriptedModel, refusalTurn, textTurn, toolTurn, type ModelClient } from "./model";
import { NoopTools, NOOP_PRICE_SAMPLE } from "./noop";
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from "./settings";
import { MAX_TOOL_ROUNDS, REFUSAL_TEXT, TOO_MANY_STEPS_TEXT, assistantNumbersTraceable, buildSystemPrompt, runTurn } from "./turn";
import { BUDGET_TEXT, NUMBER_GUARD_TEXT } from "./guards";
import type { ToolContext, ToolExecutor, ToolResult } from "./schemas";


const settings: AgentSettings = {
  ...DEFAULT_AGENT_SETTINGS,
  hardStopScripts: { lead_paint: "Lead paint script: this one goes to a site visit." },
};

const conv = (over: Partial<NewConversation> = {}): NewConversation => ({
  accountId: null, propertyId: null, estimateId: null, channel: "portal", mode: "guided", view: "customer",
  createdBy: "u1", anonToken: null, externalThreadId: null, ...over,
});

async function setup(turns: ConstructorParameters<typeof ScriptedModel>[0], over: Partial<NewConversation> = {}, tools?: ToolExecutor) {
  const store = new MemoryAgentStore();
  const c = await store.createConversation(conv(over));
  const model = new ScriptedModel(turns);
  const deps = { model, tools: tools ?? new NoopTools(settings), store, settings };
  return { store, model, deps, c };
}

describe("runTurn — persistence order", () => {
  it("stores the user's message BEFORE the model is asked (a model failure loses nothing)", async () => {
    const failing: ModelClient = { complete: async () => { throw new Error("model down"); } };
    const store = new MemoryAgentStore();
    const c = await store.createConversation(conv());
    await expect(runTurn({ model: failing, tools: new NoopTools(settings), store, settings }, { conversationId: c.id, text: "hello", actor: "user" })).rejects.toThrow("model down");
    expect(store.messages.map((m) => [m.role, m.content])).toEqual([["user", "hello"]]);
  });

  it("a text-only reply is stored with its tokens and the conversation's spend moves", async () => {
    const { store, deps, c } = await setup([textTurn("Hi — how many bedrooms?", { inputTokens: 300, outputTokens: 20 })]);
    const r = await runTurn(deps, { conversationId: c.id, text: "hello", actor: "user" });
    expect(r.text).toBe("Hi — how many bedrooms?");
    expect(r.message?.tokensIn).toBe(300);
    expect(r.message?.tokensOut).toBe(20);
    expect((await store.getConversation(c.id))?.tokenSpend).toBe(320);
    expect(r.degraded).toBeNull();
  });

  it("history is replayed to the model, first message from the user", async () => {
    const { store, model, deps, c } = await setup([textTurn("A"), textTurn("B")]);
    await store.appendMessage({ conversationId: c.id, role: "assistant", content: "greeting first", modelId: null, tokensIn: 0, tokensOut: 0 });
    await runTurn(deps, { conversationId: c.id, text: "first", actor: "user" });
    await runTurn(deps, { conversationId: c.id, text: "second", actor: "user" });
    const last = model.requests[1].messages;
    expect(last[0].role).toBe("user");
    expect(last.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("a closed conversation answers nothing and stores nothing", async () => {
    const { store, deps, c } = await setup([textTurn("nope")]);
    await store.setStatus(c.id, "closed");
    const r = await runTurn(deps, { conversationId: c.id, text: "hello", actor: "user" });
    expect(r.degraded).toBe("closed");
    expect(store.messages).toHaveLength(0);
  });

  it("while handed off, the person's message is kept and the assistant stays quiet", async () => {
    const { store, model, deps, c } = await setup([textTurn("nope")]);
    await store.setStatus(c.id, "handed_off");
    const r = await runTurn(deps, { conversationId: c.id, text: "are you there?", actor: "user" });
    expect(r.degraded).toBe("handed_off");
    expect(store.messages).toHaveLength(1);
    expect(model.requests).toHaveLength(0);
  });
});

describe("runTurn — tools through the contract", () => {
  it("runs a tool, logs it ok, hands the result back, and finishes with the model's text", async () => {
    const { store, model, deps, c } = await setup([
      toolTurn([{ name: "price_scope", input: {} }]),
      textTurn("Somewhere between $4,100 and $5,550 while a few things are still assumed."),
    ]);
    const r = await runTurn(deps, { conversationId: c.id, text: "price it", actor: "user" });
    expect(r.text).toContain("$4,100");
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ tool: "price_scope", status: "ok", messageId: r.message?.id });
    // The tool result went back to the model as a tool_result block.
    const second = model.requests[1].messages.at(-1);
    expect(second?.role).toBe("user");
    expect(JSON.stringify(second?.content)).toContain("tool_result");
    expect(assistantNumbersTraceable(await store.listMessages(c.id), await store.listToolCalls(c.id))).toBe(true);
  });

  it("an unknown tool is refused, logged, and the reason reaches the person", async () => {
    const { deps, c } = await setup([
      toolTurn([{ name: "set_price", input: { cents: 1 } }]),
      textTurn("Done."),
    ]);
    const r = await runTurn(deps, { conversationId: c.id, text: "make it cheaper", actor: "user" });
    expect(r.toolCalls[0]).toMatchObject({ tool: "set_price", status: "refused" });
    expect(r.text).toContain("not something I can do here");
  });

  it("a staff-only tool from the customer view is refused with the staff reason (§2 rule 4)", async () => {
    const { deps, c } = await setup([
      toolTurn([{ name: "apply_diff", input: { diffId: "d1" } }]),
      textTurn("Applied."),
    ], { mode: "cowork", view: "customer" });
    const r = await runTurn(deps, { conversationId: c.id, text: "apply it", actor: "user" });
    expect(r.toolCalls[0].status).toBe("refused");
    expect(r.text).toContain("for Paint Group staff");
  });

  it("a tool outside this mode is refused", async () => {
    const { deps, c } = await setup([toolTurn([{ name: "lookup_brain", input: { query: "caulking", audience: "customer" } }]), textTurn("ok")]);
    const r = await runTurn(deps, { conversationId: c.id, text: "how do you caulk?", actor: "user" });
    expect(r.toolCalls[0].status).toBe("refused");
    expect(r.text).toContain("isn't available in this kind of conversation");
  });

  it("invalid input is refused with the zod reason and never reaches the executor", async () => {
    let executed = 0;
    const spy: ToolExecutor = { execute: async () => { executed++; return { status: "ok", data: {} }; } };
    const { deps, c } = await setup([
      toolTurn([{ name: "request_callback", input: { window: "am", phoneE164: "0412" } }]),
      textTurn("Booked."),
    ], {}, spy);
    const r = await runTurn(deps, { conversationId: c.id, text: "call me", actor: "user" });
    expect(executed).toBe(0);
    expect(r.toolCalls[0].status).toBe("refused");
    expect(r.text).toContain("E.164");
  });

  it("a binding that returns data outside its contract is logged as an error, not passed on", async () => {
    const bad: ToolExecutor = { execute: async () => ({ status: "ok", data: { totalCents: "lots" } }) };
    const { deps, c } = await setup([toolTurn([{ name: "price_scope", input: {} }]), textTurn("Hmm.")], {}, bad);
    const r = await runTurn(deps, { conversationId: c.id, text: "price", actor: "user" });
    expect(r.toolCalls[0].status).toBe("error");
  });

  it("a throwing binding becomes an error row and the turn still completes", async () => {
    const boom: ToolExecutor = { execute: async () => { throw new Error("db down"); } };
    const { deps, c } = await setup([toolTurn([{ name: "get_scope", input: {} }]), textTurn("Sorry, one moment.")], {}, boom);
    const r = await runTurn(deps, { conversationId: c.id, text: "what's included", actor: "user" });
    expect(r.toolCalls[0]).toMatchObject({ status: "error", result: { status: "error", message: "db down" } });
    expect(r.text).toBe("Sorry, one moment.");
  });

  it("parallel tool calls come back in ONE user message", async () => {
    const { model, deps, c } = await setup([
      toolTurn([{ name: "get_scope", input: {}, id: "a" }, { name: "check_thresholds", input: {}, id: "b" }]),
      textTurn("ok"),
    ]);
    await runTurn(deps, { conversationId: c.id, text: "status?", actor: "user" });
    const blocks = model.requests[1].messages.at(-1)?.content;
    expect(Array.isArray(blocks) && blocks.length).toBe(2);
  });
});

describe("runTurn — the guards", () => {
  it("a $ figure no tool returned is replaced and logged as number_guard (§2 rule 1)", async () => {
    const { store, deps, c } = await setup([textTurn("It'll be about $4,000.")]);
    const r = await runTurn(deps, { conversationId: c.id, text: "how much?", actor: "user" });
    expect(r.text).toBe(NUMBER_GUARD_TEXT);
    expect(r.toolCalls.map((t) => [t.tool, t.status])).toEqual([["number_guard", "refused"]]);
    expect(assistantNumbersTraceable(await store.listMessages(c.id), await store.listToolCalls(c.id))).toBe(true);
  });

  it("a $ figure the priced result backs is kept", async () => {
    const { deps, c } = await setup([toolTurn([{ name: "price_scope", input: {} }]), textTurn(`Around $${Math.round(NOOP_PRICE_SAMPLE.totalCents / 100).toLocaleString("en-AU")}.`)]);
    const r = await runTurn(deps, { conversationId: c.id, text: "how much?", actor: "user" });
    expect(r.text).toContain("$4,820");
  });

  it("a hard stop's script IS the reply — the model cannot talk past it (§2 rule 5)", async () => {
    const { deps, c } = await setup([
      toolTurn([{ name: "hard_stop", input: { kind: "lead_paint" } }]),
      textTurn("No worries, I can still price the peeling bits at $900."),
    ]);
    const r = await runTurn(deps, { conversationId: c.id, text: "1960s house, paint peeling", actor: "user" });
    expect(r.text).toBe("Lead paint script: this one goes to a site visit.");
  });

  it("a model refusal degrades to the safe text", async () => {
    const { deps, c } = await setup([refusalTurn()]);
    const r = await runTurn(deps, { conversationId: c.id, text: "…", actor: "user" });
    expect(r.text).toBe(REFUSAL_TEXT);
    expect(r.degraded).toBe("refusal");
  });

  it("stops after MAX_TOOL_ROUNDS and says so", async () => {
    const loop = Array.from({ length: MAX_TOOL_ROUNDS + 2 }, () => toolTurn([{ name: "get_scope", input: {} }]));
    const { model, deps, c } = await setup(loop);
    const r = await runTurn(deps, { conversationId: c.id, text: "go", actor: "user" });
    expect(r.text).toBe(TOO_MANY_STEPS_TEXT);
    expect(r.degraded).toBe("max_rounds");
    expect(model.requests).toHaveLength(MAX_TOOL_ROUNDS);
  });
});

describe("runTurn — budgets (§2 rule 9)", () => {
  it("an exhausted conversation budget becomes a handoff, the model is never called", async () => {
    const { store, model, deps, c } = await setup([textTurn("should not run")]);
    await store.addTokenSpend(c.id, settings.budgetTokensPerConversation);
    const r = await runTurn(deps, { conversationId: c.id, text: "more?", actor: "user" });
    expect(r.text).toBe(BUDGET_TEXT.conversation);
    expect(r.degraded).toBe("budget");
    expect(r.toolCalls.map((t) => [t.tool, t.status])).toEqual([["request_handoff", "ok"]]);
    expect(model.requests).toHaveLength(0);
  });

  it("the account's daily cap is measured on the Melbourne day", async () => {
    const { store, model, deps, c } = await setup([textTurn("should not run")], { accountId: "acc-1" });
    // 23:30 UTC on the 1st is 09:30 Melbourne on the 2nd (AEST) — same day as the turn below.
    store.now = () => new Date("2026-09-01T23:30:00Z");
    await store.appendMessage({ conversationId: c.id, role: "assistant", content: "x", modelId: null, tokensIn: settings.dailyCapPerAccount, tokensOut: 0 });
    store.now = () => new Date("2026-09-02T01:00:00Z");
    const r = await runTurn({ ...deps, now: () => new Date("2026-09-02T01:00:00Z") }, { conversationId: c.id, text: "hi", actor: "user" });
    expect(r.degraded).toBe("daily_cap");
    expect(model.requests).toHaveLength(0);
  });
});

describe("runTurn — model routing and prompt", () => {
  it("guided uses the default model; co-work and heavy turns use the heavy model", async () => {
    const a = await setup([textTurn("a")]);
    await runTurn(a.deps, { conversationId: a.c.id, text: "hi", actor: "user" });
    expect(a.model.requests[0].model).toBe(settings.modelDefault);

    const b = await setup([textTurn("b")], { mode: "cowork", view: "staff" });
    await runTurn(b.deps, { conversationId: b.c.id, text: "paste", actor: "staff" });
    expect(b.model.requests[0].model).toBe(settings.modelHeavy);

    const h = await setup([textTurn("h")]);
    await runTurn(h.deps, { conversationId: h.c.id, text: "3 bed house…", actor: "user", heavy: true });
    expect(h.model.requests[0].model).toBe(settings.modelHeavy);
  });

  it("only the mode/view's tools are offered to the model", async () => {
    const { model, deps, c } = await setup([textTurn("a")], { mode: "support", view: "customer" });
    await runTurn(deps, { conversationId: c.id, text: "hi", actor: "user" });
    const names = model.requests[0].tools.map((t) => t.name);
    expect(names).toContain("lookup_brain");
    expect(names).not.toContain("next_gap");
    expect(names).not.toContain("apply_diff");
  });

  it("the system prompt carries the disclosure, the number rule and the channel", () => {
    const p = buildSystemPrompt(settings, { id: "c", accountId: null, propertyId: null, estimateId: null, channel: "website", mode: "support", view: "customer", status: "open", tokenSpend: 0, createdBy: null, anonToken: "x".repeat(24), externalThreadId: null });
    expect(p).toContain(settings.disclosureText);
    expect(p).toContain("price_scope");
    expect(p).toContain("cannot show prices");
  });
});

describe("S1 acceptance: a fake conversation end to end with noop tools", () => {
  it("three turns, every tool call logged, every number traceable", async () => {
    const { store, deps, c } = await setup([
      textTurn("Hi! You're chatting with Paint Group's assistant. Is it the inside, the outside, or both?"),
      toolTurn([{ name: "answer_gap", input: { key: "job_type", value: "interior", provenance: "customer_stated" } }, { name: "next_gap", input: {} }]),
      textTurn("Inside it is. How many bedrooms?"),
      toolTurn([{ name: "answer_gap", input: { key: "bedrooms", value: 3, provenance: "customer_stated" } }, { name: "price_scope", input: {} }]),
      textTurn("Three bedrooms. Early range: $4,100 to $5,550, with cupboard interiors and door style still assumed."),
    ]);
    const ctx: ToolContext = { conversationId: c.id, mode: "guided", view: "customer", estimateId: null, accountId: null };
    void ctx;
    for (const text of ["hello", "inside", "three"]) {
      const r = await runTurn(deps, { conversationId: c.id, text, actor: "user" });
      expect(r.degraded).toBeNull();
    }
    const messages = await store.listMessages(c.id);
    const calls = await store.listToolCalls(c.id);
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(3);
    expect(calls.map((t) => t.tool)).toEqual(["answer_gap", "next_gap", "answer_gap", "price_scope"]);
    expect(calls.every((t) => t.status === "ok" && t.messageId)).toBe(true);
    expect(assistantNumbersTraceable(messages, calls)).toBe(true);
    const spent = (await store.getConversation(c.id))?.tokenSpend ?? 0;
    expect(spent).toBeGreaterThan(0);
    const results: ToolResult[] = calls.map((t) => t.result as ToolResult);
    expect(results.every((r) => r.status === "ok")).toBe(true);
  });
});
