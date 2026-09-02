/**
 * S6 support mode with the stub and the real tools: answers grounded in the
 * estimate, a change request that becomes a flag, the Brain served only when
 * approved and written, and an honest "no entry" otherwise. Acceptance: no
 * policy answer without a lookup_brain result in the tool log.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ScopeTools } from "./scope-tools";
import { MemoryScopeStore, emptyDoc } from "./scope-store";
import { NoopTools } from "./noop";
import { StubModel } from "./model-stub";
import { MemoryAgentStore } from "./store";
import { assistantNumbersTraceable, runTurn } from "./turn";
import { DEFAULT_AGENT_SETTINGS } from "./settings";
import { heuristicExtract } from "./brief-extract";
import { proposeFromBrief } from "./propose";
import type { ScopeDeps, ScopeDoc } from "./scope-doc";
import type { TreeRefs } from "@/lib/wizard/build-tree";
import type { PricingContext } from "@/lib/pricing/estimate";
import { buildChangeRequestItems } from "@/lib/crm/work-queue";

type Refs = TreeRefs & { rateItems: PricingContext["rateItems"] };
const refsFile = JSON.parse(readFileSync(new URL("./__fixtures__/scope-refs.json", import.meta.url), "utf8")) as Refs;
const golden = JSON.parse(readFileSync(new URL("../pricing/__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as { reference: Pick<PricingContext, "products" | "modifiers" | "settings"> };
const refs: TreeRefs = { rules: refsFile.rules, aliases: refsFile.aliases, defectRates: refsFile.defectRates, typicals: refsFile.typicals };
const ctx: PricingContext = { rateItems: refsFile.rateItems, products: golden.reference.products, modifiers: golden.reference.modifiers, settings: [...golden.reference.settings, { key: "invoicing", value: { depositPct: 20 } }] };
const deps: ScopeDeps = { refs, ctx, actor: "customer" };
const settings = DEFAULT_AGENT_SETTINGS;

/** A SENT 3-bed estimate, built from Tom's paragraph. */
function sentEstimate(): ScopeDoc {
  const x = heuristicExtract("3 bedroom 1 bathroom house, walls, ceilings and all trims, change of colour.");
  const p = proposeFromBrief(emptyDoc("est-1", "residential"), x, { ...deps, actor: "staff" }, { mode: "cowork", gateCents: 15_000 });
  if (!p.ok) throw new Error(p.reason);
  return { ...p.working, status: "sent", shareToken: "tok_1234567890abcdefghijklmnop" };
}

function harness() {
  const scope = new MemoryScopeStore({ refs, ctx });
  scope.seed(sentEstimate());
  scope.brain.push(
    { id: "b-dep", slug: "deposit", topic: "Money & process", question: "When do I pay, and how much?", answerMd: "A deposit is payable when you accept your estimate, and the balance at sign-off.\n\nThe deposit is {{deposit_pct}}% of the estimate total.", audience: "customer", status: "approved", needsContent: false },
    { id: "b-caulk", slug: "caulking-gaps", topic: "Workmanship", question: "How do you handle gaps and caulking?", answerMd: "Not written yet.", audience: "both", status: "approved", needsContent: true },
    { id: "b-staff", slug: "charge-out-vs-rev", topic: "Staff-only", question: "What do the two $/hr figures mean?", answerMd: "Charge-out vs revenue per hour.", audience: "staff", status: "approved", needsContent: false },
    { id: "b-draft", slug: "warranty", topic: "Warranty", question: "What warranty?", answerMd: "A 2-year workmanship warranty.", audience: "customer", status: "draft", needsContent: false },
  );
  const store = new MemoryAgentStore();
  const tools = new ScopeTools(scope, settings, new NoopTools(settings));
  return { scope, store, deps: { model: new StubModel(), tools, store, settings } };
}

async function conv(h: ReturnType<typeof harness>) {
  return h.store.createConversation({ accountId: "acc-1", propertyId: null, estimateId: "est-1", channel: "portal", mode: "support", view: "customer", createdBy: "cust-1", anonToken: null, externalThreadId: null });
}

describe("support mode", () => {
  it("answers about the estimate from its own data — rooms and the price, nothing invented", async () => {
    const h = harness(); const c = await conv(h);
    const r = await runTurn(h.deps, { conversationId: c.id, text: "What's included in my estimate?", actor: "user" });
    expect(r.toolCalls.map((t) => t.tool)).toContain("explain_estimate");
    expect(r.text).toMatch(/Bed 1:/);
    expect(r.text).toMatch(/\$[\d,]+ – \$[\d,]+/);
    const kitchen = await runTurn(h.deps, { conversationId: c.id, text: "why is the kitchen priced?", actor: "user" });
    expect(kitchen.text).toMatch(/^Kitchen/);
    expect(assistantNumbersTraceable(await h.store.listMessages(c.id), await h.store.listToolCalls(c.id))).toBe(true);
  });

  it("a change request on a sent estimate becomes a flag the work queue derives", async () => {
    const h = harness(); const c = await conv(h);
    const r = await runTurn(h.deps, { conversationId: c.id, text: "Can you add the laundry ceiling as well?", actor: "user" });
    expect(r.toolCalls.map((t) => t.tool)).toContain("request_change");
    expect(r.text).toMatch(/Logged for the team/);
    expect(h.scope.changeRequests).toHaveLength(1);
    expect(h.scope.changeRequests[0].text).toContain("laundry");
    const now = new Date("2026-09-02T04:00:00Z");
    const items = buildChangeRequestItems([{ id: "ev-1", estimate_id: "est-1", created_at: "2026-09-02T03:00:00Z", payload: { text: "add the laundry ceiling" }, estimates: { account_id: "acc-1", title: "12 Test St" } }], [], now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "change_request", accountId: "acc-1", action: { label: "Reprice" } });
    // A staff reply in the thread after it closes the item.
    expect(buildChangeRequestItems([{ id: "ev-1", estimate_id: "est-1", created_at: "2026-09-02T03:00:00Z", payload: {}, estimates: null }], [{ estimate_id: "est-1", created_at: "2026-09-02T03:30:00Z" }], now)).toHaveLength(0);
  });

  it("a policy question is answered from the Brain with the live Settings value — and cited in the log", async () => {
    const h = harness(); const c = await conv(h);
    const r = await runTurn(h.deps, { conversationId: c.id, text: "When do I pay the deposit?", actor: "user" });
    const lookup = r.toolCalls.find((t) => t.tool === "lookup_brain")!;
    expect(lookup.status).toBe("ok");
    expect((lookup.result as { data: { found: boolean } }).data.found).toBe(true);
    expect(r.text).toContain("The deposit is 20% of the estimate total.");
    expect(r.text).toContain("From our Brain: deposit");
  });

  it("an unwritten or unapproved entry is 'no entry yet, want a person?' — never a placeholder, never a draft", async () => {
    const h = harness(); const c = await conv(h);
    for (const q of ["How do you handle gap filling and caulking?", "What warranty do you give?", "What do the two $/hr figures mean?"]) {
      const r = await runTurn(h.deps, { conversationId: c.id, text: q, actor: "user" });
      const lookup = r.toolCalls.find((t) => t.tool === "lookup_brain")!;
      expect((lookup.result as { data: { found: boolean } }).data.found).toBe(false);
      expect(r.text).toMatch(/don't have an entry for that yet/);
      expect(r.text).not.toContain("Not written yet");
      expect(r.text).not.toContain("Charge-out vs revenue");
    }
  });

  it("acceptance: every policy answer in the log has a Brain lookup behind it", async () => {
    const h = harness(); const c = await conv(h);
    await runTurn(h.deps, { conversationId: c.id, text: "When do I pay the deposit?", actor: "user" });
    await runTurn(h.deps, { conversationId: c.id, text: "What's included?", actor: "user" });
    const calls = await h.store.listToolCalls(c.id);
    const msgs = (await h.store.listMessages(c.id)).filter((m) => m.role === "assistant");
    for (const m of msgs) {
      if (!/From our Brain/.test(m.content)) continue;
      const cited = calls.some((t) => t.messageId === m.id && t.tool === "lookup_brain" && t.status === "ok" && (t.result as { data: { found: boolean } }).data.found);
      expect(cited).toBe(true);
    }
  });

  it("a visit goes through the policy function; a person is one message away", async () => {
    const h = harness(); const c = await conv(h);
    const v = await runTurn(h.deps, { conversationId: c.id, text: "Can someone come out and look at it?", actor: "user" });
    expect(v.toolCalls.map((t) => t.tool)).toContain("visit_policy");
    expect(v.text).toMatch(/pick a time|call you/);
    const p = await runTurn(h.deps, { conversationId: c.id, text: "I'd like to talk to a person", actor: "user" });
    expect(p.toolCalls.map((t) => t.tool)).toContain("request_handoff");
  });
});
