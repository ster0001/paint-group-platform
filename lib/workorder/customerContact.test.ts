import { describe, expect, it } from "vitest";
import { resolveCustomerContact } from "./customerContact";

describe("resolveCustomerContact — one answer for who a customer send goes to", () => {
  it("prefers the builder contact when it is filled in", () => {
    const c = resolveCustomerContact({
      builderState: { contact: { first_name: "Priya", email: "priya@example.com", phone: "0400 000 000" } },
      sentSnapshot: { contactEmail: "old@example.com", contactName: "Old Name" },
      acceptedName: "Priya Nair",
      account: { email: "account@example.com", phone: "0411 111 111" },
    });
    expect(c).toEqual({ firstName: "Priya", email: "priya@example.com", phone: "0400 000 000" });
  });

  it("falls back to the sent snapshot when the builder contact is empty — the Devoy Street case", () => {
    const c = resolveCustomerContact({
      builderState: { contact: { first_name: "", email: "", phone: "" } },
      sentSnapshot: { contactEmail: "devoy@example.com", contactName: "Sam Devoy" },
      acceptedName: null,
      account: null,
    });
    expect(c.email).toBe("devoy@example.com");
    expect(c.firstName).toBe("Sam");
    expect(c.phone).toBeNull();
  });

  it("falls back to the linked account when neither the builder nor the snapshot has it", () => {
    const c = resolveCustomerContact({
      builderState: null,
      sentSnapshot: null,
      acceptedName: "Casey Customer",
      account: { email: "casey@example.com", phone: "0422 222 222" },
    });
    expect(c).toEqual({ firstName: "Casey", email: "casey@example.com", phone: "0422 222 222" });
  });

  it("never invents a contact: nothing anywhere = null email and phone, 'there' as the name", () => {
    const c = resolveCustomerContact({ builderState: {}, sentSnapshot: {}, acceptedName: "", account: {} });
    expect(c).toEqual({ firstName: "there", email: null, phone: null });
  });

  it("ignores non-string junk rather than sending to it", () => {
    const c = resolveCustomerContact({
      builderState: { contact: { email: 42, phone: { n: 1 } } },
      sentSnapshot: { contactEmail: ["a@example.com"] },
      acceptedName: null,
      account: { email: "ok@example.com" },
    });
    expect(c.email).toBe("ok@example.com");
    expect(c.phone).toBeNull();
  });
});
