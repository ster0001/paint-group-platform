import { afterEach, describe, expect, it, vi } from "vitest";
import { wizardDesktopOnePressOn } from "./ui-flags";

afterEach(() => vi.unstubAllEnvs());

describe("desktop one-press — off until Tom flips it (addendum, 5 Nov 2026)", () => {
  it("is on only when NEXT_PUBLIC_WIZARD_DESKTOP_ONEPRESS is exactly 1", () => {
    vi.stubEnv("NEXT_PUBLIC_WIZARD_DESKTOP_ONEPRESS", "");
    expect(wizardDesktopOnePressOn()).toBe(false);
    vi.unstubAllEnvs();
    expect(wizardDesktopOnePressOn()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_WIZARD_DESKTOP_ONEPRESS", "0");
    expect(wizardDesktopOnePressOn()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_WIZARD_DESKTOP_ONEPRESS", "1");
    expect(wizardDesktopOnePressOn()).toBe(true);
  });
});
