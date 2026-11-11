import { describe, expect, it } from "vitest";
import { marketingRefusal } from "./consent";

describe("marketing consent (ruling A‑E)", () => {
  it("STOP — marketing_unsubscribed_at — stops marketing on every channel", () => {
    const acct = { marketing_unsubscribed_at: "2026-11-10T00:00:00Z", permit_sms: "declined", permit_email: "unknown" };
    expect(marketingRefusal(acct, "sms")).toMatch(/unsubscribed/);
    expect(marketingRefusal(acct, "email")).toMatch(/unsubscribed/);
  });
  it("a declined permit stops that channel only", () => {
    expect(marketingRefusal({ permit_sms: "declined", permit_email: "allowed" }, "sms")).toMatch(/texts/);
    expect(marketingRefusal({ permit_sms: "declined", permit_email: "allowed" }, "email")).toBeNull();
    expect(marketingRefusal({ permit_email: "declined" }, "email")).toMatch(/email/);
  });
  it("allowed, unknown or never asked: it may go", () => {
    for (const v of ["allowed", "unknown", null, undefined]) {
      expect(marketingRefusal({ permit_sms: v, permit_email: v, marketing_unsubscribed_at: null }, "sms")).toBeNull();
    }
  });
});

describe("which automations are marketing, and that every send of one carries the flag", async () => {
  const { AUTOMATIONS } = await import("@/lib/automations/registry");
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const marketing = AUTOMATIONS.filter((a) => a.consent === "marketing");

  it("the marketing keys today: only the abandoned-wizard nudge (campaigns guard themselves)", () => {
    expect(marketing.map((a) => a.key)).toEqual(["wizard_abandoned"]);
    expect(marketing.every((a) => a.audience === "customer")).toBe(true);
  });

  it("a file that sends a marketing key without sendAutomation passes ctx.marketing", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "node_modules") walk(p); } else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) files.push(p); } };
    walk("app"); walk("lib");
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith(join("automations", "registry.ts"))) continue;
      const src = readFileSync(f, "utf8");
      for (const a of marketing) {
        // The file SENDS this automation (checks its switch or stamps it), not merely names an event of the same word.
        if (!new RegExp(`automationOn\\([^)]*"${a.key}"|automation:\\s*"${a.key}"`).test(src)) continue;
        const rawSend = /\b(sendEmail|sendSms|sendMagicLink)\(/.test(src);
        if (rawSend && !/marketing:/.test(src)) offenders.push(`${f} sends ${a.key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
