import { describe, expect, it } from "vitest";
import { BRAND_DEFAULTS } from "./brand";
import { legalPartyFor, privacySections, termsForBrand } from "./legal";

const company = { abn: "41 639 780 108", addressLine1: "25/23-25 Bunney Road", addressLine2: "Oakleigh South VIC 3167" };

describe("the public legal pages (go-live check, 25 Nov 2026)", () => {
  it("Paint Home's privacy policy carries its own name and contact details and never names Paint Group", () => {
    const party = legalPartyFor(BRAND_DEFAULTS.painthome, company);
    expect(party).toMatchObject({ tradingName: "Paint Home", email: "hello@painthome.com.au", phone: "03 8840 9414", abn: "41 639 780 108" });
    const text = JSON.stringify(privacySections(party));
    expect(text).toContain("hello@painthome.com.au");
    expect(text).toContain("Enlvn Pty Ltd trading as Paint Home");
    expect(text).not.toContain("Paint Group");
  });
  it("covers the ten sections of the policy it rewords", () => {
    const s = privacySections(legalPartyFor(BRAND_DEFAULTS.paintgroup, company));
    expect(s.map((x) => x.heading)).toEqual(["Who we are", "What we collect", "How we collect it", "Why we collect it", "Who we share it with", "Cookies and analytics", "Storage and security", "Seeing or correcting your information", "Complaints", "Contact us"]);
    expect(JSON.stringify(s)).toContain("oaic.gov.au");
    expect(JSON.stringify(s)).toContain("do not sell");
  });
  it("the terms are the estimate's own words with the brand's trading name", () => {
    const t = "Paint Group will do the work.\n\nPayment is due on sign-off.";
    expect(termsForBrand(t, BRAND_DEFAULTS.painthome)).toEqual(["Paint Home will do the work.", "Payment is due on sign-off."]);
    expect(termsForBrand(t, BRAND_DEFAULTS.paintgroup)[0]).toBe("Paint Group will do the work.");
    expect(termsForBrand("", BRAND_DEFAULTS.painthome)).toEqual([]);
  });
});
