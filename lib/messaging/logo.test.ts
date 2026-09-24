import { describe, expect, it } from "vitest";
import { emailLogoUrl } from "./logo";

describe("emailLogoUrl — one logo for every email (Tom, 24 Sep 2026)", () => {
  it("prefers the email logo, then the light one, then the main one", () => {
    expect(emailLogoUrl({ logoUrl: "dark.png", logoUrlLight: "light.png", logoUrlEmail: "email.png" })).toBe("email.png");
    expect(emailLogoUrl({ logoUrl: "dark.png", logoUrlLight: "light.png" })).toBe("light.png");
    expect(emailLogoUrl({ logoUrl: "dark.png" })).toBe("dark.png");
  });
  it("treats an empty string as unset and answers undefined for nothing", () => {
    expect(emailLogoUrl({ logoUrl: "", logoUrlLight: "", logoUrlEmail: "" })).toBeUndefined();
    expect(emailLogoUrl(null)).toBeUndefined();
  });
});
