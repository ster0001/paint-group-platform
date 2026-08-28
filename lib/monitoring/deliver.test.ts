import { afterEach, describe, expect, it, vi } from "vitest";
import { deliver } from "./deliver";

/**
 * A4-03 · The delivery path, including the two things that make it safe to
 * have at all: it never throws, and it never carries PII or money.
 *
 * A4 recorded that the PII rule was "written down and nothing enforces it".
 * These tests are the enforcement.
 */

const captured: { url: string; body: Record<string, unknown> }[] = [];

function stubFetch() {
  captured.length = 0;
  vi.stubGlobal("fetch", (url: string, init: { body: string }) => {
    captured.push({ url, body: JSON.parse(init.body) });
    return Promise.resolve({ ok: true } as Response);
  });
}

afterEach(() => { vi.unstubAllGlobals(); delete process.env.ERROR_WEBHOOK_URL; });

const report = (extra: Record<string, unknown> = {}) => ({
  where: "test.path", message: "it broke", bestEffort: false, extra,
});

describe("delivery", () => {
  it("does nothing at all when no webhook is configured", () => {
    stubFetch();
    deliver(report());
    expect(captured.length).toBe(0);
  });

  it("posts when configured, and says where it came from", () => {
    process.env.ERROR_WEBHOOK_URL = "https://example.invalid/hook";
    stubFetch();
    deliver(report());
    expect(captured.length).toBe(1);
    expect(captured[0].url).toBe("https://example.invalid/hook");
    expect(captured[0].body.where).toBe("test.path");
    expect(String(captured[0].body.text)).toContain("test.path");
  });

  it("marks best-effort failures differently from real ones", () => {
    process.env.ERROR_WEBHOOK_URL = "https://example.invalid/hook";
    stubFetch();
    deliver({ ...report(), bestEffort: true });
    expect(String(captured[0].body.text)).toContain("⚠️");
    captured.length = 0;
    deliver(report());
    expect(String(captured[0].body.text)).toContain("🚨");
  });
});

describe("it never leaks PII or money", () => {
  it("redacts anything whose key looks personal or financial", () => {
    process.env.ERROR_WEBHOOK_URL = "https://example.invalid/hook";
    stubFetch();
    deliver(report({
      customerEmail: "someone@example.com",
      phone: "0491 570 006",
      jobAddress: "1 Real St",
      totalCents: 123456,
      bsb: "000-000",
      estimateId: "abc-123",   // an id is fine — it identifies a row, not a person
    }));
    const extra = captured[0].body.extra as Record<string, unknown>;
    for (const k of ["customerEmail", "phone", "jobAddress", "totalCents", "bsb"]) {
      expect(extra[k], `${k} must be redacted`).toBe("[redacted]");
    }
    expect(extra.estimateId).toBe("abc-123");
    expect(JSON.stringify(captured[0].body)).not.toContain("someone@example.com");
    expect(JSON.stringify(captured[0].body)).not.toContain("123456");
  });

  it("caps long values so an object cannot smuggle a record out", () => {
    process.env.ERROR_WEBHOOK_URL = "https://example.invalid/hook";
    stubFetch();
    deliver(report({ payload: { blob: "x".repeat(5000) } }));
    expect(String((captured[0].body.extra as Record<string, unknown>).payload).length).toBeLessThan(220);
  });
});

describe("it can never break the thing it reports on", () => {
  it("swallows a fetch that throws synchronously", () => {
    process.env.ERROR_WEBHOOK_URL = "https://example.invalid/hook";
    vi.stubGlobal("fetch", () => { throw new Error("network is down"); });
    expect(() => deliver(report())).not.toThrow();
  });

  it("swallows a rejected promise", () => {
    process.env.ERROR_WEBHOOK_URL = "https://example.invalid/hook";
    vi.stubGlobal("fetch", () => Promise.reject(new Error("timeout")));
    expect(() => deliver(report())).not.toThrow();
  });
});
