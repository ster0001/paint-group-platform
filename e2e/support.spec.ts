import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor } from "./fixtures/portal";
import { buildTreeFromState } from "../lib/wizard/build-tree";
import { toWizardState } from "../lib/agent/scope-doc";
import { priceEstimateTotals, type PricingContext } from "../lib/pricing/estimate";
import { adjustmentsFrom } from "../lib/pricing/context";

/**
 * S6 — support mode as a RESIDENTIAL CUSTOMER on a SENT estimate (C1 stack,
 * AGENT_MODEL_STUB=1): grounded Q&A, a change request that becomes a flag,
 * a Brain answer (deposit — approved, PLATFORM), and an honest "no entry"
 * for the caulking rule (still [TOM TO WRITE]).
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db: SupabaseClient | null = url && key ? createClient(url, key) : null;

test.describe("assistant — support mode", () => {
  test.skip(!db, "service key needed");
  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.support.${run}@example.com`;
  let estimateId: string | null = null;

  test.afterAll(async () => {
    if (!db) return;
    if (estimateId) await db.from("agent_conversations").delete().eq("estimate_id", estimateId);
    await destroyAccountChain(db, email);
    await deleteUserByEmail(db, email);
  });

  test("three grounded answers, a change flag, a Brain answer, and an honest no-entry", async ({ page }) => {
    test.setTimeout(240_000);
    const sb = db!;
    // ---- fixture: a member with a SENT estimate priced from the real tree ----
    const refs = JSON.parse(readFileSync("lib/agent/__fixtures__/scope-refs.json", "utf8"));
    const [rateItems, products, modifiers, settingsRows] = await Promise.all([
      sb.from("rate_items").select("*, rate_cards!inner(is_active)").eq("rate_cards.is_active", true),
      sb.from("products").select("*"), sb.from("modifiers").select("code, group_name, multiplier").eq("active", true), sb.from("settings").select("key, value"),
    ]);
    const ctx = { rateItems: (rateItems.data ?? []) as PricingContext["rateItems"], products: (products.data ?? []) as PricingContext["products"], modifiers: (modifiers.data ?? []) as PricingContext["modifiers"], settings: (settingsRows.data ?? []) as PricingContext["settings"] };
    const state = toWizardState({
      jobType: "interior", surfaces: ["walls", "ceilings", "doors", "skirting"], condition: { tier: "change" },
      basics: { bedrooms: 3, storeys: "single", sizeBand: "unsure", openPlanKitchenLiving: false },
      details: { doorStyle: "flat", windowStyle: "casement", ceilingHeight: "2.4", damageTier: 0 },
      customer: { propertyKind: "house", heritageListed: "no", bodyCorporate: "no", builtPre1970: "no", asbestosSuspected: "no", suburb: "Murrumbeena", postcode: "3163", email },
    }, { inServiceArea: true, timing: null, occupied: false, email, accountType: "residential" });
    if (!state) throw new Error("fixture state does not parse");
    const tree = buildTreeFromState(state, { rules: refs.rules, aliases: refs.aliases, defectRates: refs.defectRates, typicals: refs.typicals }, ctx);
    if ("skip" in tree) throw new Error(`fixture build skipped: ${tree.skip}`);
    const totals = priceEstimateTotals(tree.areas as never, ctx, adjustmentsFrom({ modSel: tree.modSel }));
    const acct = await sb.from("accounts").insert({ email, name: "Sam Support" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    const token = `sp${run}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
    const est = await sb.from("estimates").insert({
      title: "12 Test Street, Murrumbeena", status: "sent", source: "wizard", level_of_finish: 3, account_id: acct.data.id, share_token: token, sent_at: new Date().toISOString(),
      total_cents: totals.totalCents, subtotal_cents: totals.subtotalCents,
      builder_state: { blocks: tree.areas, aiDeferred: tree.deferred, modSel: tree.modSel, wizard: { state }, agent: { answers: {}, facts: { accountType: "residential", email } } },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;
    // The Brain: deposit approved (PLATFORM), caulking still to write. The
    // slug index is partial, so no upsert — find, then set.
    const setEntry = async (slug: string, row: Record<string, unknown>) => {
      const { data: found } = await sb.from("brain_entries").select("id").eq("slug", slug).maybeSingle();
      const res = found ? await sb.from("brain_entries").update(row).eq("id", found.id) : await sb.from("brain_entries").insert({ slug, ...row });
      if (res.error) throw new Error(`brain ${slug}: ${res.error.message}`);
    };
    await setEntry("deposit", { topic: "Money & process", question: "When do I pay, and how much?", answer_md: "A deposit is payable when you accept your estimate, and the balance at sign-off.\n\nThe deposit is {{deposit_pct}}% of the estimate total.", audience: "customer", status: "approved", needs_content: false });
    await setEntry("caulking-gaps", { topic: "Workmanship & method", question: "How do you handle gaps and caulking?", answer_md: "Not written yet.", audience: "both", status: "draft", needs_content: true });

    // ---- the customer signs in and asks ----
    await page.goto(await magicLinkFor(sb, email));
    await page.goto(`/account/messages/${estimateId}`);
    await page.getByTestId("ask-assistant").click();
    await expect(page.getByTestId("sp-msg-assistant").first()).toBeVisible({ timeout: 30_000 });

    const ask = async (q: string) => {
      await page.getByTestId("sp-input").fill(q);
      await page.getByTestId("sp-send").click();
      await expect(page.getByTestId("sp-msg-user").last()).toContainText(q.slice(0, 30));
      await expect(page.locator(".msg.theirs .msg-body", { hasText: "…" })).toHaveCount(0, { timeout: 60_000 });
      return (await page.getByTestId("sp-msg-assistant").last().innerText()).trim();
    };

    const a1 = await ask("What's included in my estimate?");
    expect(a1).toMatch(/Bed 1:/);
    expect(a1).toMatch(/\$[\d,]+ – \$[\d,]+/);
    const a2 = await ask("Why is the kitchen priced the way it is?");
    expect(a2).toMatch(/Kitchen/);
    const a3 = await ask("Which rooms are confirmed?");
    expect(a3.length).toBeGreaterThan(20);

    const a4 = await ask("Can you add the laundry ceiling as well?");
    expect(a4).toMatch(/Logged for the team/);
    const { data: flags } = await sb.from("estimate_events").select("id, payload").eq("estimate_id", estimateId).eq("type", "change_request");
    expect(flags?.length).toBe(1);

    const a5 = await ask("When do I pay the deposit?");
    expect(a5).toMatch(/A deposit is payable when you accept/);
    expect(a5).toMatch(/The deposit is \d+% of the estimate total/);
    expect(a5).toMatch(/From our Brain/);

    const a6 = await ask("How do you handle gap filling and caulking?");
    expect(a6).toMatch(/don't have an entry for that yet/);
    expect(a6).not.toMatch(/Not written yet/);

    // Acceptance: the Brain answer has a lookup behind it in the tool log.
    const { data: conv } = await sb.from("agent_conversations").select("id").eq("estimate_id", estimateId).eq("mode", "support").maybeSingle();
    const { data: calls } = await sb.from("agent_tool_calls").select("tool, status, result").eq("conversation_id", conv!.id).eq("tool", "lookup_brain");
    expect((calls ?? []).some((c) => c.status === "ok" && (c.result as { data?: { found?: boolean } }).data?.found === true)).toBe(true);
    expect((calls ?? []).some((c) => (c.result as { data?: { found?: boolean } }).data?.found === false)).toBe(true);
  });
});
