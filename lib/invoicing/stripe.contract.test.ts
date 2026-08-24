/**
 * §5 contract pins — the Stripe guarantees that must survive every edit.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const MIG = read("supabase/migrations/20261115000000_stripe_payments.sql");
const WEBHOOK = read("app/api/webhooks/stripe/route.ts");
const CHECKOUT = read("app/i/[token]/checkout/route.ts");
const STATUS = read("app/i/[token]/status/route.ts");
const STRIPE = read("lib/invoicing/stripe.ts");
const PANEL = read("app/i/[token]/PayPanel.tsx");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(p);
  }
  return acc;
}

describe("only the webhook marks card payments paid (§5.3)", () => {
  it("record_stripe_payment is service_role-gated at the database", () => {
    expect(MIG).toMatch(/record_stripe_payment[\s\S]{0,400}auth\.role\(\) <> 'service_role'/);
    expect(MIG).toContain(
      "revoke execute on function public.record_stripe_payment(uuid, text, integer, integer) from public, anon, authenticated",
    );
  });
  it("in the app, the webhook route is its one and only caller", () => {
    const callers = walk("app").concat(walk("lib"))
      .filter((f) => !f.endsWith(".test.ts"))
      .filter((f) => read(f).includes('"record_stripe_payment"'));
    expect(callers).toEqual(["app/api/webhooks/stripe/route.ts"]);
  });
  it("the redirect surfaces only read: status route and PayPanel never write", () => {
    for (const src of [STATUS, PANEL]) {
      expect(src).not.toMatch(/\.rpc\("(?!invoice_by_token)/);
      expect(src).not.toContain(".insert(");
      expect(src).not.toContain(".update(");
    }
    expect(PANEL).toContain("no need to pay again");
  });
});

describe("idempotency — replayed delivery processes once (§5.2)", () => {
  it("stripe_event_insert distinguishes new / retry / done", () => {
    expect(MIG).toContain("if found then return 'new'; end if;");
    expect(MIG).toMatch(/case when v_processed is null then 'retry' else 'done' end/);
    expect(WEBHOOK).toContain('inserted.data === "done"');
  });
  it("a duplicate payment intent is absorbed inside the RPC", () => {
    expect(MIG).toMatch(/where stripe_payment_intent_id = p_payment_intent[\s\S]{0,80}ok:already/);
  });
  it("signature verification guards the door, before any storage", () => {
    expect(WEBHOOK.indexOf("verifyStripeSignature")).toBeLessThan(WEBHOOK.indexOf("stripe_event_insert"));
  });
});

describe("the session is fresh at click time, server-computed (§5.1)", () => {
  it("the checkout route mints a session per POST — nothing is stored and reused", () => {
    expect(CHECKOUT).toContain("createCheckoutSession(token)");
    expect(STRIPE).toContain('"metadata[invoice_id]": inv.id');
    expect(STRIPE).toContain('"line_items[0][price_data][unit_amount]": String(balance)');
  });
  it("the surcharge is its own disclosed line (⚑4)", () => {
    expect(STRIPE).toContain("Card payment surcharge — avoid this by paying via bank transfer");
    expect(PANEL).toContain("Includes a card surcharge of");
  });
  it("no browser amount: the route takes only the token from the URL", () => {
    expect(CHECKOUT).not.toContain("req.json");
    expect(CHECKOUT).not.toContain("formData");
  });
});

describe("refunds never silently un-pay (§5.2)", () => {
  it("the payment flips, the invoice status is untouched", () => {
    const refundFn = MIG.slice(MIG.indexOf("record_stripe_refund"), MIG.indexOf("record_stripe_failure"));
    expect(refundFn).toContain("set status = 'refunded'");
    expect(refundFn).not.toContain("update public.invoices");
    expect(refundFn).toContain("'needs_credit_note', true");
  });
});

describe("keys are server env only (§5.6)", () => {
  it("STRIPE_ env is read nowhere under a client component", () => {
    const offenders = walk("app").concat(walk("lib")).filter((f) => {
      const src = read(f);
      return src.includes("STRIPE_") && src.trimStart().startsWith('"use client"');
    });
    expect(offenders).toEqual([]);
  });
});
