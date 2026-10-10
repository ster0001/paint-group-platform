import { describe, expect, it } from "vitest";
import { answeredWords, type AnsweredFacts } from "./answeredSummary";

const base: AnsweredFacts = { visit: { when: "Monday 13 October, 9:00 am to 10:00 am", estimatorName: "Felipe" }, sent: { sms: false, email: false }, waiting: false, mobile: "+61400000000" };

describe("answeredWords", () => {
  it("says nothing extra when no visit was booked (answered another way)", () => {
    expect(answeredWords({ ...base, visit: null })).toEqual([]);
  });
  it("names the time and estimator, and the channels that actually went", () => {
    expect(answeredWords({ ...base, sent: { sms: true, email: true } })).toEqual([
      "Booked Monday 13 October, 9:00 am to 10:00 am with Felipe. The visit is on the Diary.",
      "The customer was sent the details by text and email.",
    ]);
    expect(answeredWords({ ...base, sent: { sms: false, email: true } })[1]).toBe("The customer was sent the details by email.");
  });
  it("never claims a send that is waiting in the queue", () => {
    expect(answeredWords({ ...base, waiting: true })[1]).toMatch(/waiting in the message queue .* has not gone yet/);
  });
  it("tells staff to ring when nothing reached the customer", () => {
    expect(answeredWords(base)[1]).toBe("No message has reached the customer — ring them on +61400000000 with the time.");
    expect(answeredWords({ ...base, visit: { ...base.visit!, estimatorName: null }, mobile: null })).toEqual([
      "Booked Monday 13 October, 9:00 am to 10:00 am. The visit is on the Diary.",
      "No message has reached the customer — ring them with the time.",
    ]);
  });
});
