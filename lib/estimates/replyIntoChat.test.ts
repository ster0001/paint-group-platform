import { describe, expect, it } from "vitest";
import { SMS_REPLY_WINDOW_DAYS, answersCustomerMessage, pickSmsReplyEstimate, replyBodyFor, smsAddressForms } from "./replyIntoChat";

const now = new Date("2026-11-12T01:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("replies into the estimate chat (A‑G)", () => {
  it("an email reply loses its quoted history; a text keeps its words", () => {
    expect(replyBodyFor("email", "Yes please\n\nOn Tue, 10 Nov 2026 at 9:00 am Paint Group wrote:\n> the estimate")).toBe("Yes please");
    expect(replyBodyFor("sms", "  > yes  ")).toBe("> yes");
  });
  it("a reply to staff mail or a keyword is not a customer conversation", () => {
    expect(answersCustomerMessage("staff_alert")).toBe(false);
    expect(answersCustomerMessage("stop")).toBe(false);
    expect(answersCustomerMessage("chat_reply")).toBe(true);
    expect(answersCustomerMessage(null)).toBe(true);
  });
  it("a text goes to the estimate of the newest text we sent about one, inside the window", () => {
    expect(pickSmsReplyEstimate([
      { estimate_id: "old", occurred_at: daysAgo(10) },
      { estimate_id: "new", occurred_at: daysAgo(1) },
      { estimate_id: null, occurred_at: daysAgo(0.1) },
    ], now)).toBe("new");
    expect(pickSmsReplyEstimate([{ estimate_id: "stale", occurred_at: daysAgo(SMS_REPLY_WINDOW_DAYS + 1) }], now)).toBeNull();
    expect(pickSmsReplyEstimate([], now)).toBeNull();
  });
  it("an outbound text may have recorded the mobile either way", () => {
    expect(smsAddressForms("+61412345678")).toEqual(["+61412345678", "0412345678"]);
    expect(smsAddressForms("+6431234567")).toEqual(["+6431234567"]);
  });
});
