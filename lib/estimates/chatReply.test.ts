import { describe, expect, it } from "vitest";
import { stripQuotedReply } from "./chatReply";

describe("stripQuotedReply — the reply above the quoted alert", () => {
  it("cuts at 'On … wrote:'", () => {
    expect(stripQuotedReply("Yes, the ceilings are included.\n\nOn Sun, 20 Sep 2026 at 14:02, Paint Group <email@paintgroup.com.au> wrote:\n> Sarah wrote on the chat")).toBe("Yes, the ceilings are included.");
  });
  it("cuts at the first quoted line and at an Outlook header block", () => {
    expect(stripQuotedReply("Sure thing\n> quoted")).toBe("Sure thing");
    expect(stripQuotedReply("Sure thing\n\n-----Original Message-----\nFrom: x")).toBe("Sure thing");
    expect(stripQuotedReply("Sure thing\nFrom: Paint Group\nSent: today")).toBe("Sure thing");
  });
  it("keeps a plain reply whole and trims it", () => {
    expect(stripQuotedReply("  Two lines\nof reply  \n")).toBe("Two lines\nof reply");
  });
});
