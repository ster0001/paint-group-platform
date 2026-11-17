import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { REQUEST_ALERT_TYPES } from "./requestAlertRules";

/**
 * Lead L9 / L10 / L13 (R4): a customer asking for a person always tells
 * staff. The requests are written through `logRequestEvent`
 * (lib/staff/requestAlerts.ts), which logs the CRM event and fires the alert;
 * a `logCrmEvent(…)` call that writes one of these types directly would log
 * the request and tell nobody. This greps app/ and lib/ for one.
 *
 * The one exception is the live website chat's question: its hand-off is
 * already its own staff alert and its own pop-up row.
 */
const ROOT = join(__dirname, "..", "..");
const EXEMPT = new Set(["app/api/agent/website/route.ts"]);

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("request events go through logRequestEvent", () => {
  it("no logCrmEvent call in app/ or lib/ writes a help, visit or call request directly", () => {
    const hits: string[] = [];
    for (const f of [...files(join(ROOT, "app")), ...files(join(ROOT, "lib"))]) {
      const rel = f.slice(ROOT.length + 1);
      if (EXEMPT.has(rel)) continue;
      const src = readFileSync(f, "utf8");
      // A store's `.logCrmEvent(` method is not this function: the assistant's SupabaseScopeStore routes through logRequestEvent.
      for (const m of src.matchAll(/(?<![.\w])logCrmEvent\(/g)) {
        const end = src.indexOf("});", m.index);
        const call = src.slice(m.index, end === -1 ? m.index + 600 : end);
        for (const t of REQUEST_ALERT_TYPES) if (call.includes(`"${t}"`)) hits.push(`${rel}: ${t}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
