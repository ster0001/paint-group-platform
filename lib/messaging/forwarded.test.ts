import { describe, expect, test } from "vitest";
import { forwardedOrigin, parseAddressLine } from "./forwarded";

const GMAIL = `Passing this on.

---------- Forwarded message ---------
From: Jane Citizen <jane.citizen@example.com>
Date: Mon, 29 Sep 2026 at 09:12
Subject: Re: Your painting estimate
To: Paint Group <info@paintgroup.com.au>


Hi Tom,

Yes please, let's go ahead with the hallway too.

Jane
`;

const OUTLOOK = `FYI

From: Bob Builder [mailto:bob@example.org]
Sent: Monday, 29 September 2026 9:12 AM
To: info@paintgroup.com.au
Subject: FW: Invoice INV-0153

Paid this morning, thanks.
`;

const APPLE = `Begin forwarded message:

> From: "Sam Lee" <sam@example.net>
> Subject: Re: Colours
> Date: 29 September 2026 at 9:12:00 am AEST
> To: info@paintgroup.com.au
>
> Let's do Natural White on the ceilings.
`;

describe("forwardedOrigin (Tom, 29 Sep)", () => {
  test("Gmail's forward header names the customer and hands back their words", () => {
    const o = forwardedOrigin(GMAIL, ["info@paintgroup.com.au"]);
    expect(o?.fromEmail).toBe("jane.citizen@example.com");
    expect(o?.fromName).toBe("Jane Citizen");
    expect(o?.subject).toBe("Your painting estimate");
    expect(o?.body).toMatch(/^Hi Tom,/);
    expect(o?.body).toMatch(/hallway too/);
    expect(o?.body).not.toMatch(/Forwarded message/);
  });
  test("Outlook's bannerless header block still reads", () => {
    const o = forwardedOrigin(OUTLOOK, ["info@paintgroup.com.au"]);
    expect(o?.fromEmail).toBe("bob@example.org");
    expect(o?.fromName).toBe("Bob Builder");
    expect(o?.subject).toBe("Invoice INV-0153");
    expect(o?.body).toBe("Paid this morning, thanks.");
  });
  test("Apple Mail's quoted forward is un-quoted", () => {
    const o = forwardedOrigin(APPLE, ["info@paintgroup.com.au"]);
    expect(o?.fromEmail).toBe("sam@example.net");
    expect(o?.fromName).toBe("Sam Lee");
    expect(o?.body).toBe("Let's do Natural White on the ceilings.");
  });
  test("a From line naming the office itself is not a customer", () => {
    const o = forwardedOrigin(GMAIL.replace("jane.citizen@example.com", "info@paintgroup.com.au"), ["info@paintgroup.com.au"]);
    expect(o).toBeNull();
  });
  test("a plain email with no forward block is left alone", () => {
    expect(forwardedOrigin("Hi, just checking in on the quote.\n\nThanks", [])).toBeNull();
  });
  test("address lines in their usual shapes", () => {
    expect(parseAddressLine("Jane <jane@example.com>")).toEqual({ name: "Jane", email: "jane@example.com" });
    expect(parseAddressLine("'Jane Citizen' <Jane@Example.com>")).toEqual({ name: "Jane Citizen", email: "jane@example.com" });
    expect(parseAddressLine("jane@example.com")).toEqual({ name: "", email: "jane@example.com" });
    expect(parseAddressLine("Jane [mailto:jane@example.com]")).toEqual({ name: "Jane", email: "jane@example.com" });
    expect(parseAddressLine("nobody here")).toEqual({ name: "", email: "" });
  });
});
