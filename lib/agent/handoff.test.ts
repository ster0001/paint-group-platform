/**
 * S7 — the handoff's pure parts and the in-hours / after-hours turns with
 * the stub and the real tools. The SLA test runs on a mocked clock.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { escalationsDue, handoffSummary, nextWorkingDate, onDutyNumbers, type HandoffRow } from "./handoff";
import { buildHandoffItems } from "@/lib/crm/work-queue";
import { ScopeTools } from "./scope-tools";
import { MemoryScopeStore, emptyDoc } from "./scope-store";
import { NoopTools } from "./noop";
import { StubModel } from "./model-stub";
import { MemoryAgentStore } from "./store";
import { runTurn } from "./turn";
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from "./settings";
import type { TreeRefs } from "@/lib/wizard/build-tree";
import type { PricingContext } from "@/lib/pricing/estimate";

type Refs = TreeRefs & { rateItems: PricingContext["rateItems"] };
const refsFile = JSON.parse(readFileSync(new URL("./__fixtures__/scope-refs.json", import.meta.url), "utf8")) as Refs;
const golden = JSON.parse(readFileSync(new URL("../pricing/__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as { reference: Pick<PricingContext, "products" | "modifiers" | "settings"> };
const refs: TreeRefs = { rules: refsFile.rules, aliases: refsFile.aliases, defectRates: refsFile.defectRates, typicals: refsFile.typicals };
const ctx: PricingContext = { rateItems: refsFile.rateItems, products: golden.reference.products, modifiers: golden.reference.modifiers, settings: golden.reference.settings };

const hours = { ...DEFAULT_AGENT_SETTINGS.supportHours, roster: { tue: ["+61400000001"], default: ["+61400000009"] }, escalateTo: ["+61400000002"] };
const settings: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, supportHours: hours, slaClaimSeconds: 180 };
const TUE_10 = new Date("2026-09-01T00:00:00Z"); // Tue 10:00 Melbourne (AEST)
const SAT_12 = new Date("2026-09-05T02:00:00Z"); // Sat 12:00 Melbourne

describe("handoff — pure", () => {
  it("escalates only requests older than the SLA that haven't escalated yet (mocked clock)", () => {
    const at = (s: number) => new Date(TUE_10.getTime() - s * 1000).toISOString();
    const h = (id: string, requestedAt: string, over: Partial<HandoffRow> = {}): HandoffRow => ({ id, conversationId: "c", reason: "customer_asked", status: "requested", requestedAt, claimedBy: null, claimedAt: null, resolvedAt: null, escalatedAt: null, summary: null, ...over });
    const due = escalationsDue([h("late", at(181)), h("fresh", at(60)), h("done", at(500), { escalatedAt: at(100) }), h("claimed", at(500), { status: "active" })], TUE_10, 180);
    expect(due.map((x) => x.id)).toEqual(["late"]);
  });

  it("a callback outside hours is dated for the next working day", () => {
    expect(nextWorkingDate(hours, SAT_12)).toBe("2026-09-07"); // Monday
    // Tuesday 07:00 Melbourne — before opening → today.
    expect(nextWorkingDate(hours, new Date("2026-08-31T21:00:00Z"))).toBe("2026-09-01");
    // Tuesday 10:00 — opening passed → Wednesday.
    expect(nextWorkingDate(hours, TUE_10)).toBe("2026-09-02");
  });

  it("the roster pings today's people, the escalation list on top", () => {
    expect(onDutyNumbers(hours, TUE_10)).toEqual({ onDuty: ["+61400000001"], escalate: ["+61400000002", "+61400000001"] });
    expect(onDutyNumbers(hours, new Date("2026-09-02T00:00:00Z")).onDuty).toEqual(["+61400000009"]);
  });

  it("the summary is three lines a person can act on", () => {
    const s = handoffSummary({ estimateTitle: "12 Test St", customerName: "Sam", lastUserMessages: ["hi", "what's included?", "talk to a person"], priceLine: "Range $4,000 – $5,000 (80% settled).", reason: "customer_asked" });
    expect(s.split("\n")).toHaveLength(3);
    expect(s).toContain("Sam · 12 Test St — asked for a person.");
  });

  it("the work item: Claim while waiting, Open chat once live, overdue past the SLA", () => {
    const row = { id: "h1", conversation_id: "c1", reason: "customer_asked", status: "requested", requested_at: new Date(TUE_10.getTime() - 400_000).toISOString(), escalated_at: null, claimed_by: null, agent_conversations: { account_id: "a1", estimate_id: null, accounts: { name: "Sam", email: "s@x.com" } } };
    const [waiting] = buildHandoffItems([row], TUE_10, 180);
    expect(waiting).toMatchObject({ kind: "handoff_requested", title: "Sam is waiting for a person", action: { label: "Claim", href: "/crm/chat/c1" }, bucket: "overdue" });
    const [live] = buildHandoffItems([{ ...row, status: "active" }], TUE_10, 180);
    expect(live).toMatchObject({ title: "Live chat with Sam", action: { label: "Open chat" }, bucket: "today" });
    expect(buildHandoffItems([{ ...row, status: "resolved" }], TUE_10)).toHaveLength(0);
  });
});

describe("handoff — turns", () => {
  function harness(now: Date) {
    const scope = new MemoryScopeStore({ refs, ctx });
    scope.seed(emptyDoc("est-1", "residential"));
    const store = new MemoryAgentStore();
    store.now = () => now;
    const pings: Array<{ to: string[]; body: string }> = [];
    const tools = new ScopeTools(scope, settings, new NoopTools(settings), () => now, null, store, async (to, body) => { pings.push({ to, body }); });
    return { scope, store, pings, deps: { model: new StubModel(), tools, store, settings, now: () => now } };
  }
  const conv = (h: ReturnType<typeof harness>) => h.store.createConversation({ accountId: "acc-1", propertyId: null, estimateId: "est-1", channel: "portal", mode: "support", view: "customer", createdBy: "cust", anonToken: null, externalThreadId: null });

  it("in hours: a person is requested, the conversation hands off, the roster is pinged, and the customer's next message is kept", async () => {
    const h = harness(TUE_10); const c = await conv(h);
    const r = await runTurn(h.deps, { conversationId: c.id, text: "Can I talk to a person please?", actor: "user" });
    expect(r.toolCalls.find((t) => t.tool === "request_handoff")?.status).toBe("ok");
    expect(r.text).toMatch(/asked a person/);
    expect(h.store.handoffs).toHaveLength(1);
    expect((await h.store.getConversation(c.id))?.status).toBe("handed_off");
    expect(h.pings[0].to).toEqual(["+61400000001"]);
    const quiet = await runTurn(h.deps, { conversationId: c.id, text: "are you there?", actor: "user" });
    expect(quiet.degraded).toBe("handed_off");
    expect((await h.store.listMessages(c.id)).filter((m) => m.role === "user")).toHaveLength(2);
    // Claim → summary; resolve → open again.
    const claimed = await h.store.claimHandoff(h.store.handoffs[0].id, "staff-1", "summary");
    expect(claimed?.status).toBe("active");
    await h.store.resolveHandoff(h.store.handoffs[0].id);
    expect((await h.store.getConversation(c.id))?.status).toBe("open");
    const back = await runTurn(h.deps, { conversationId: c.id, text: "What's included?", actor: "user" });
    expect(back.degraded).toBeNull();
  });

  it("after hours: the request is refused with the next opening and a callback offer; the tap books it for the next working day", async () => {
    const h = harness(SAT_12); const c = await conv(h);
    const r = await runTurn(h.deps, { conversationId: c.id, text: "I want to talk to a person", actor: "user" });
    expect(r.toolCalls.find((t) => t.tool === "request_handoff")?.status).toBe("refused");
    expect(r.text).toMatch(/closed just now/);
    expect(r.text).toMatch(/Mon 08:00/);
    expect(r.text).toMatch(/callback/);
    expect(h.store.handoffs).toHaveLength(0);
    expect((await h.store.getConversation(c.id))?.status).toBe("open");
    const cb = await runTurn(h.deps, { conversationId: c.id, text: "Please call me back", actor: "user", answer: { key: "callback", value: { window: "am", phoneE164: "+61412345678" } } });
    expect(cb.toolCalls.find((t) => t.tool === "request_callback")?.status).toBe("ok");
    expect(cb.text).toMatch(/2026-09-07/);
    expect(h.store.callbacks[0]).toMatchObject({ window: "am", phoneE164: "+61412345678", createdForDate: "2026-09-07" });
    expect(h.scope.events.some((e) => e.type === "callback_requested")).toBe(true);
  });
});
