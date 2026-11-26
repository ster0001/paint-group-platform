import { afterEach, describe, expect, it, vi } from "vitest";
import { wizardDesktopOnePressOn } from "./ui-flags";

afterEach(() => vi.unstubAllEnvs());

describe("desktop one-press — on by default since 26 Nov 2026; 0 is the way back", () => {
  it("is on unless NEXT_PUBLIC_WIZARD_DESKTOP_ONEPRESS is exactly 0", () => {
    vi.stubEnv("NEXT_PUBLIC_WIZARD_DESKTOP_ONEPRESS", "");
    expect(wizardDesktopOnePressOn()).toBe(true);
    vi.unstubAllEnvs();
    expect(wizardDesktopOnePressOn()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_WIZARD_DESKTOP_ONEPRESS", "1");
    expect(wizardDesktopOnePressOn()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_WIZARD_DESKTOP_ONEPRESS", "0");
    expect(wizardDesktopOnePressOn()).toBe(false);
  });
});
