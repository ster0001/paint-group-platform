import { describe, expect, it } from "vitest";
import { extractContact, findAuPhone, findEmail } from "./contactCapture";

describe("the chat reads contact details typed into a message", () => {
  it("an email and a mobile in one line", () => {
    expect(extractContact(["sure it's Jo.Smith@Example.com and 0412 345 678 thanks"])).toEqual({ email: "jo.smith@example.com", phone: "0412345678" });
  });
  it("across two lines, in any format", () => {
    expect(extractContact(["jo@example.com.", "+61 (4) 1234-5678"])).toEqual({ email: "jo@example.com", phone: "0412345678" });
  });
  it("one of the two is not enough", () => {
    expect(extractContact(["jo@example.com"])).toBeNull();
    expect(extractContact(["call me on 0412 345 678"])).toBeNull();
    expect(extractContact(["how much for 3 bedrooms?", "about 120 m2"])).toBeNull();
  });
  it("landlines count; postcodes, prices and an email's digits do not", () => {
    expect(findAuPhone("ring 03 9123 4567")).toBe("0391234567");
    expect(findAuPhone("Northcote 3070, about $12,500")).toBeNull();
    expect(extractContact(["jo0412345678@example.com"])).toBeNull();
    expect(findEmail("no email here")).toBeNull();
  });
});
