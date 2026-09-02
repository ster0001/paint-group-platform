import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** S1 acceptance: the gateway cannot be imported from a client component.
 *  Two layers — `server-only` fails the Next build, the lint rule fails
 *  lint with a message. This pins both in place. */
describe("the gateway is server-only", () => {
  it.each(["lib/agent/gateway.ts", "lib/agent/model-anthropic.ts", "lib/agent/store-supabase.ts"])("%s starts with import \"server-only\"", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src.trimStart().startsWith('import "server-only";')).toBe(true);
  });

  it("eslint restricts the gateway imports outside app/api", () => {
    const cfg = readFileSync("eslint.config.mjs", "utf8");
    expect(cfg).toContain("**/lib/agent/gateway");
    expect(cfg).toContain('ignores: ["app/api/**"]');
  });

  it("the pure loop imports neither the SDK client nor the service client", () => {
    const src = readFileSync("lib/agent/turn.ts", "utf8");
    // A type-only import is fine; a runtime import of the SDK client is not.
    expect(src).not.toMatch(/^import (?!type )[^;]*from "@anthropic-ai\/sdk"/m);
    expect(src).not.toContain("lib/supabase/service");
  });
});
