import { test, expect, vi, afterEach } from "vitest";
import { reportError, reportIfError, errorMessage } from "./report.ts";

afterEach(() => vi.restoreAllMocks());

test("errorMessage reads Supabase's plain object as well as a real Error", () => {
  // Supabase errors are NOT Error instances — `e instanceof Error` gives
  // "[object Object]", which is how users ended up seeing that on screen.
  expect(errorMessage({ message: "permission denied for table x" })).toBe("permission denied for table x");
  expect(errorMessage(new Error("boom"))).toBe("boom");
  expect(errorMessage("plain string")).toBe("plain string");
  expect(errorMessage(null)).toBe("Something went wrong.");
  expect(errorMessage({})).toBe("Something went wrong.");
});

test("reportIfError is false on failure and true on success", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(reportIfError({ error: { message: "nope" } }, { where: "test" })).toBe(false);
  expect(reportIfError({ error: null }, { where: "test" })).toBe(true);
  expect(reportIfError(null, { where: "test" })).toBe(true);
});

test("best-effort failures warn; real ones go to error", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const err = vi.spyOn(console, "error").mockImplementation(() => {});

  reportIfError({ error: { message: "sweep failed" } }, { where: "offers.sweep", bestEffort: true });
  expect(warn).toHaveBeenCalledOnce();
  expect(err).not.toHaveBeenCalled();

  reportIfError({ error: { message: "signature lost" } }, { where: "estimate.signature" });
  expect(err).toHaveBeenCalledOnce();
});

test("the report names where it happened, so it can be searched for", () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  reportError({ message: "permission denied" }, { where: "workorder.patch" });
  expect(String(err.mock.calls[0][0])).toContain("[workorder.patch]");
  expect(String(err.mock.calls[0][0])).toContain("permission denied");
});

test("reporting can never throw, whatever it is handed", () => {
  vi.spyOn(console, "error").mockImplementation(() => { throw new Error("console is broken"); });
  expect(() => reportError(new Error("x"), { where: "test" })).not.toThrow();
});
