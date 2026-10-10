import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { authUserIdByEmail, lookupAuthUserByEmail } from "./userByEmail";

type LinkArgs = { type: string; email: string };
type LinkReply = { data: { user: { id: string; email?: string } | null } | null; error: { status?: number; code?: string; message: string } | null };

/** A service client whose ONLY admin method is generateLink — a listUsers call would throw. */
function fakeClient(reply: (args: LinkArgs) => LinkReply) {
  const generateLink = vi.fn(async (args: LinkArgs) => reply(args));
  const svc = { auth: { admin: { generateLink } } } as unknown as Parameters<typeof lookupAuthUserByEmail>[0];
  return { svc, generateLink };
}

describe("lookupAuthUserByEmail", () => {
  it("finds a login in ONE recovery call, lower-cased and trimmed — never a magic link, never a listing", async () => {
    const { svc, generateLink } = fakeClient(({ email }) => ({ data: { user: { id: "u-old", email } }, error: null }));
    const r = await lookupAuthUserByEmail(svc, "  Office@Example.COM ");
    expect(r).toMatchObject({ status: "found", user: { id: "u-old" } });
    expect(generateLink).toHaveBeenCalledTimes(1);
    expect(generateLink).toHaveBeenCalledWith({ type: "recovery", email: "office@example.com" });
  });

  it("reads 404 user_not_found as not_found", async () => {
    const { svc } = fakeClient(() => ({ data: null, error: { status: 404, code: "user_not_found", message: "User not found" } }));
    expect(await lookupAuthUserByEmail(svc, "nobody@example.com")).toEqual({ status: "not_found" });
  });

  it("never reads any other failure as not_found", async () => {
    const { svc } = fakeClient(() => ({ data: null, error: { status: 500, message: "upstream timeout" } }));
    expect(await lookupAuthUserByEmail(svc, "a@example.com")).toEqual({ status: "error", message: "upstream timeout" });
  });

  it("treats a success with no user as an error, not a miss", async () => {
    const { svc } = fakeClient(() => ({ data: { user: null }, error: null }));
    expect((await lookupAuthUserByEmail(svc, "a@example.com")).status).toBe("error");
  });

  it("refuses a non-email without calling auth", async () => {
    const { svc, generateLink } = fakeClient(() => ({ data: null, error: null }));
    expect(await lookupAuthUserByEmail(svc, "not an email")).toEqual({ status: "invalid_email" });
    expect(await lookupAuthUserByEmail(svc, "")).toEqual({ status: "invalid_email" });
    expect(generateLink).not.toHaveBeenCalled();
  });
});

describe("authUserIdByEmail", () => {
  it("returns the id, null for nobody, and THROWS for a failed lookup", async () => {
    expect(await authUserIdByEmail(fakeClient(() => ({ data: { user: { id: "u1" } }, error: null })).svc, "a@example.com")).toBe("u1");
    expect(await authUserIdByEmail(fakeClient(() => ({ data: null, error: { status: 404, message: "User not found" } })).svc, "a@example.com")).toBeNull();
    await expect(authUserIdByEmail(fakeClient(() => ({ data: null, error: { status: 503, message: "down" } })).svc, "a@example.com")).rejects.toThrow(/down/);
    await expect(authUserIdByEmail(fakeClient(() => ({ data: null, error: null })).svc, "nope")).rejects.toThrow(/not an email/);
  });
});

describe("one lookup, no page-1 listings (11 Oct 2026)", () => {
  // listUsers is newest-first; `listUsers(...)` + `.find()` loses the oldest
  // logins once a project passes a page. Nothing in app/, lib/ or scripts/
  // may look a user up that way again — or by a magic link, which creates.
  const root = resolve(__dirname, "../..");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs|js)$/.test(name) ? [p] : [];
  });
  const files = ["app", "lib", "scripts", "e2e"].flatMap((d) => walk(join(root, d)))
    .filter((f) => !f.endsWith("userByEmail.test.ts"));

  it("no file calls auth.admin.listUsers", () => {
    const hits = files.filter((f) => /\.listUsers\s*\(/.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => f.slice(root.length + 1))).toEqual([]);
  });
});
