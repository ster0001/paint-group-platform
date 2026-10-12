import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGING, renderTemplate } from "./config";
import { AUTOMATIONS } from "@/lib/automations/registry";

/**
 * Payments merge Step 4 (§4.4, ⚑P8): the four payment messages, seeded from
 * the brief's Appendix A in an English tone (not Australian), editable in
 * Settings → Automations.
 */
const FIELDS = ["paymentMsgDeposit", "paymentMsgReminder", "paymentMsgOverdue", "paymentMsgReceived"] as const;

describe("payment message templates", () => {
  it("say what Appendix A says, with the server-filled placeholders", () => {
    expect(DEFAULT_MESSAGING.paymentMsgDeposit).toContain("a quick reminder that the deposit of {{amount}} for {{address}} is due on {{due_date}}, ahead of our start on {{start_date}}");
    expect(DEFAULT_MESSAGING.paymentMsgReminder).toContain("thank you again for having us at {{address}}");
    expect(DEFAULT_MESSAGING.paymentMsgOverdue).toContain("fell due on {{due_date}} and is still outstanding. Could you let us know when we might expect payment?");
    expect(DEFAULT_MESSAGING.paymentMsgReceived).toContain("we have received your payment for {{address}}. A receipt is on its way by email.");
    for (const f of ["paymentMsgDeposit", "paymentMsgReminder", "paymentMsgOverdue"] as const) expect(DEFAULT_MESSAGING[f]).toContain("{{pay_link}}");
  });
  it("read in an English tone, not an Australian one", () => {
    for (const f of FIELDS) {
      const t = DEFAULT_MESSAGING[f];
      expect(t).toMatch(/^Hello \{\{first_name\}\},/);
      expect(t).toMatch(/Many thanks,\nPaint Group$/);
      expect(t).not.toMatch(/\b(cheers|mate|no worries|arvo|g'day|reckon)\b/i);
    }
  });
  it("render with every placeholder filled", () => {
    const vars = { first_name: "Sarah", amount: "$1,200.00", address: "12 Elm Grove", due_date: "Monday 19 October", start_date: "Friday 23 October", pay_link: "https://paintgroup.com.au/i/x" };
    for (const f of FIELDS) expect(renderTemplate(DEFAULT_MESSAGING[f], vars)).not.toContain("{{");
  });
  it("are editable in Settings → Automations as one manual entry", () => {
    const a = AUTOMATIONS.find((x) => x.key === "payment_message");
    expect(a?.kind).toBe("manual");
    expect(a?.templates?.map((t) => t.field)).toEqual([...FIELDS]);
  });
});
