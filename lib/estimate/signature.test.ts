import { describe, expect, it } from "vitest";
import { isSignatureImage, toEstimateSignature } from "./signature";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("isSignatureImage", () => {
  it("accepts a PNG data URL", () => expect(isSignatureImage(PNG)).toBe(true));
  it("refuses other schemes and types", () => {
    expect(isSignatureImage("https://evil.example/x.png")).toBe(false);
    expect(isSignatureImage("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isSignatureImage("data:image/png;base64,\"><script>")).toBe(false);
    expect(isSignatureImage(null)).toBe(false);
  });
  it("refuses an oversized value", () => {
    expect(isSignatureImage("data:image/png;base64," + "A".repeat(1_000_000))).toBe(false);
  });
});

describe("toEstimateSignature", () => {
  it("keeps image, name and date", () => {
    expect(toEstimateSignature({ signature: PNG, name: " Jo Smith ", at: "2026-11-10T03:00:00Z" }))
      .toEqual({ image: PNG, name: "Jo Smith", at: "2026-11-10T03:00:00Z" });
  });
  it("prints the name when the image never stored", () => {
    expect(toEstimateSignature({ signature: null, name: "Jo", at: null })).toEqual({ image: null, name: "Jo", at: null });
  });
  it("is null when nothing says it was signed", () => {
    expect(toEstimateSignature(null)).toBeNull();
    expect(toEstimateSignature({ signature: "junk", name: "", at: "2026-11-10" })).toBeNull();
  });
});
