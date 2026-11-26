import { describe, expect, it } from "vitest";
import { gateContactProblem } from "./otpFormat";

/** Go-live check, 25 Nov 2026: the details step names the field that is wrong. */
describe("gateContactProblem", () => {
  const ok = { name: "Alex Smith", email: "alex@example.com", phone: "0412 345 678" };
  it("passes three good fields, in any accepted mobile format", () => {
    expect(gateContactProblem(ok)).toBeNull();
    expect(gateContactProblem({ ...ok, phone: "+61 412 345 678" })).toBeNull();
  });
  it("names the first field that is wrong", () => {
    expect(gateContactProblem({ ...ok, name: " " })?.field).toBe("name");
    expect(gateContactProblem({ ...ok, email: "" })?.field).toBe("email");
    expect(gateContactProblem({ ...ok, email: "alex.example" })).toEqual({ field: "email", message: "Please enter a valid email address, like name@example.com." });
    expect(gateContactProblem({ ...ok, phone: "" })?.field).toBe("phone");
  });
  it("says a landline is a landline", () => {
    expect(gateContactProblem({ ...ok, phone: "03 9840 1234" })?.message).toBe("That looks like a landline. We need a mobile number to text your code.");
    expect(gateContactProblem({ ...ok, phone: "12345" })?.message).toBe("Please enter an Australian mobile number, starting 04.");
  });
  it("never says a filled-in form is empty", () => {
    const p = gateContactProblem({ name: "ZZTEST Audit", email: "zztest.audit", phone: "0398401234" });
    expect(p?.field).toBe("email");
    expect(p?.message).not.toMatch(/fill in/);
  });
});
