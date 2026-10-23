import { describe, expect, it } from "vitest";
import { BRAND_DEFAULTS, brandFor, brandKeyOf, parseBrandSettings, sinceLine, telHref } from "./brand";

describe("brand.ts (Paint Home brief §3) — one record per shopfront", () => {
  it("home and business are Paint Group; painthome is Paint Home, with its own LocalBusiness id under Paint Group's", () => {
    expect(brandKeyOf("home")).toBe("paintgroup");
    expect(brandKeyOf("business")).toBe("paintgroup");
    expect(brandKeyOf("painthome")).toBe("painthome");
    const ph = brandFor("painthome");
    expect(ph.name).toBe("Paint Home");
    expect(ph.tagline).toBe("Your qualified local painters");
    expect(ph.domain).toBe("painthome.com.au");
    expect(ph.localBusinessId).toBe("https://painthome.com.au/#business");
    expect(ph.parentBusinessId).toBe(BRAND_DEFAULTS.paintgroup.localBusinessId);
    expect(ph.legalLine).toBe("Enlvn Pty Ltd trading as Paint Home");
    expect(ph.poweredBy).toBe("Paint Group");
    expect(brandFor("home").poweredBy).toBeNull();
  });
  it("P10: Paint Home launches on Paint Group's number", () => {
    expect(brandFor("painthome").phoneDisplay).toBe(brandFor("home").phoneDisplay);
    expect(brandFor("painthome").phoneTel).toBe(brandFor("home").phoneTel);
  });
  it("the painter line is the brand's (§4: painting with us since YYYY)", () => {
    expect(sinceLine(brandFor("painthome"), "2024")).toBe("painting with us since 2024");
    expect(sinceLine(brandFor("home"), "2024")).toBe("with Paint Group since 2024");
  });
  it("Settings → Brands lays over the defaults; blanks and garbage fall back", () => {
    const s = parseBrandSettings({ painthome: { domain: "staging.painthome.com.au", phoneDisplay: "1300 000 000", legalLine: "", primaryColour: "#00FF00" } });
    const ph = brandFor("painthome", s);
    expect(ph.domain).toBe("staging.painthome.com.au");
    expect(ph.url).toBe("https://staging.painthome.com.au");
    expect(ph.localBusinessId).toBe("https://staging.painthome.com.au/#business");
    expect(ph.phoneDisplay).toBe("1300 000 000");
    expect(ph.phoneTel).toBe("tel:1300000000");
    expect(ph.legalLine).toBe("Enlvn Pty Ltd trading as Paint Home");
    expect(ph.primaryColour).toBe("#00FF00");
    // Paint Group untouched by a Paint Home edit
    expect(brandFor("home", s)).toEqual(brandFor("home"));
    // garbage → defaults, never a throw
    expect(brandFor("painthome", parseBrandSettings("nope"))).toEqual(brandFor("painthome"));
    expect(brandFor("painthome", parseBrandSettings({ painthome: { primaryColour: "red" } })).primaryColour).toBe("#17F9F1");
  });
  it("telHref keeps digits and a leading +", () => {
    expect(telHref("03 8840 9414")).toBe("tel:0388409414");
    expect(telHref("+61 3 8840 9414")).toBe("tel:+61388409414");
  });
});
