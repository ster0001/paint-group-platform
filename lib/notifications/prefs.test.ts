import { describe, expect, it } from "vitest";
import { notifyAllowed, notifyTypeOfKind, parseNotifyPrefs, switchedOff } from "./prefs";

describe("notification preferences", () => {
  it("unset means on; only an explicit false switches a channel off", () => {
    expect(notifyAllowed({}, "invoice", "sms")).toBe(true);
    expect(notifyAllowed(null, "job", "email")).toBe(true);
    expect(notifyAllowed({ invoice: { sms: false } }, "invoice", "sms")).toBe(false);
    expect(notifyAllowed({ invoice: { sms: false } }, "invoice", "email")).toBe(true);
  });

  it("parses the column defensively", () => {
    expect(parseNotifyPrefs(null)).toEqual({});
    expect(parseNotifyPrefs({ bogus: { email: false }, job: { email: "no", sms: false } })).toEqual({ job: { sms: false } });
  });

  it("maps a send's kind to a customer-facing type, and leaves the rest alone", () => {
    expect(notifyTypeOfKind("visit_confirmation")).toBe("visit");
    expect(notifyTypeOfKind("visit_reminder")).toBe("visit");
    expect(notifyTypeOfKind("estimate")).toBe("estimate");
    expect(notifyTypeOfKind("invoice")).toBe("invoice");
    expect(notifyTypeOfKind("receipt")).toBe("invoice");
    expect(notifyTypeOfKind("job_update")).toBe("job");
    expect(notifyTypeOfKind("appointment")).toBe("job");
    expect(notifyTypeOfKind("chat_reply")).toBe("message");
    expect(notifyTypeOfKind("campaign")).toBeNull();
    expect(notifyTypeOfKind("magic_link")).toBeNull();
    expect(notifyTypeOfKind(undefined)).toBeNull();
  });

  it("lists what is switched off for the record", () => {
    expect(switchedOff({ job: { sms: false }, invoice: { email: false, sms: true } })).toEqual([
      { type: "job", channel: "sms" }, { type: "invoice", channel: "email" },
    ]);
  });
});
