import { describe, expect, it } from "vitest";
import { sessionPooledUrl } from "./session-pooled-url";

describe("the connection the e2e run lock takes its lock on", () => {
  it("moves the transaction pooler (:6543) to the session pooler (:5432)", () => {
    expect(sessionPooledUrl("postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres"))
      .toBe("postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres");
  });
  it("leaves a session-pooled or direct connection alone", () => {
    for (const url of [
      "postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres",
      "postgresql://u:p@db.example.supabase.co:5432/postgres",
    ]) expect(sessionPooledUrl(url)).toBe(url);
  });
  it("hands anything it cannot parse straight to pg rather than mangling it", () => {
    expect(sessionPooledUrl("not a url")).toBe("not a url");
  });
});
