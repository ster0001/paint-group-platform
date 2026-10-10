import { afterEach, describe, expect, it, vi } from "vitest";
import { clientId } from "./clientId";

describe("clientId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is a v4-shaped uuid", () => {
    expect(clientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("works where randomUUID does not exist (http over wifi, iOS before 15.4)", () => {
    vi.stubGlobal("crypto", { getRandomValues: (b: Uint8Array) => { b.fill(7); return b; } });
    expect(clientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("two calls differ", () => {
    expect(clientId()).not.toBe(clientId());
  });
});
