import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteStageV10On } from "./ui-flags";

afterEach(() => vi.unstubAllEnvs());

describe("quote stage v10 — on by default (Tom, 4 Nov 2026)", () => {
  it("is on with the variable unset or anything but 0, and off only when NEXT_PUBLIC_QUOTE_STAGE_V10 is exactly 0", () => {
    vi.stubEnv("NEXT_PUBLIC_QUOTE_STAGE_V10", "");
    expect(quoteStageV10On()).toBe(true);
    vi.unstubAllEnvs();
    expect(quoteStageV10On()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_QUOTE_STAGE_V10", "1");
    expect(quoteStageV10On()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_QUOTE_STAGE_V10", "0");
    expect(quoteStageV10On()).toBe(false);
  });
});
