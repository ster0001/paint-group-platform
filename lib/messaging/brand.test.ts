import { describe, expect, it } from "vitest";
import { companyForBrand, entityForBrand, fromForBrand, messageBrandOf, publicOriginFor, PAINTHOME_EMAIL_LOGO_PATH } from "./brand";

describe("the messaging brand parameter (paint-home brief §5)", () => {
  const company = { name: "Paint Group", email: "email@paintgroup.com.au", phone: "03 8840 9414", logoUrl: "https://x/logo.png", logoUrlEmail: "https://x/logo-email.png", estimatorName: "Sarah Reid" };
  it("a row's brand column names the brand; Paint Group is the default", () => {
    expect(messageBrandOf("painthome")).toBe("painthome");
    expect(messageBrandOf("paintgroup")).toBe("paintgroup");
    expect(messageBrandOf(null)).toBe("paintgroup");
  });
  it("Paint Home replaces the name, phone and logos and keeps the people; Paint Group is untouched", () => {
    const ph = companyForBrand(company, "painthome");
    expect(ph.name).toBe("Paint Home");
    expect(ph.logoUrlEmail).toBe(`https://painthome.com.au${PAINTHOME_EMAIL_LOGO_PATH}`);
    expect(ph.logoUrl).toBe(ph.logoUrlEmail);
    expect(ph.estimatorName).toBe("Sarah Reid");
    expect(ph.email).toBe("email@paintgroup.com.au");
    expect(companyForBrand(company, "paintgroup")).toBe(company);
  });
  it("the From header keeps the verified mailbox and changes the display name only", () => {
    expect(fromForBrand("painthome", "Paint Group <email@paintgroup.com.au>")).toBe("Paint Home <email@paintgroup.com.au>");
    expect(fromForBrand("painthome", "hello@paintgroup.com.au")).toBe("Paint Home <hello@paintgroup.com.au>");
    expect(fromForBrand("painthome", undefined)).toBe("Paint Home <email@paintgroup.com.au>");
    expect(fromForBrand("paintgroup", "Paint Group <email@paintgroup.com.au>")).toBeUndefined();
  });
  it("links start at the brand's own domain", () => {
    expect(publicOriginFor("painthome", "https://login.paintgroup.com.au/")).toBe("https://painthome.com.au");
    expect(publicOriginFor("paintgroup", "https://login.paintgroup.com.au/")).toBe("https://login.paintgroup.com.au");
  });
  it("the invoice entity trades as Paint Home with the Enlvn line; ABN and address are kept; Paint Group as configured", () => {
    const entity = { tradingName: "Paint Group", abn: "41 639 780 108", address: "1 Example St" };
    const ph = entityForBrand(entity, "painthome");
    expect(ph).toMatchObject({ tradingName: "Paint Home", abn: "41 639 780 108", address: "1 Example St", legalLine: "Enlvn Pty Ltd trading as Paint Home" });
    expect(entityForBrand(entity, "paintgroup")).toBe(entity);
  });
});
