import { describe, expect, it } from "vitest";
import { htmlToPlain, replyAddress, replyTokenFrom } from "./record";

describe("reply routing (P3)", () => {
  it("finds the token in a routed To address, whatever the display name around it", () => {
    expect(replyTokenFrom("reply+AbC123xyz_-Q@reply.paintgroup.com.au")).toBe("AbC123xyz_-Q");
    expect(replyTokenFrom("Paint Group <REPLY+abc12345@Reply.Paintgroup.com.au>")).toBe("abc12345");
    expect(replyTokenFrom("info@paintgroup.com.au")).toBeNull();
    expect(replyTokenFrom(null)).toBeNull();
  });

  it("only routes replies when the reply domain is configured", () => {
    const before = process.env.REPLY_DOMAIN;
    delete process.env.REPLY_DOMAIN;
    expect(replyAddress("tok")).toBeNull();
    process.env.REPLY_DOMAIN = "reply.paintgroup.com.au";
    expect(replyAddress("tok")).toBe("reply+tok@reply.paintgroup.com.au");
    if (before == null) delete process.env.REPLY_DOMAIN; else process.env.REPLY_DOMAIN = before;
  });
});

describe("htmlToPlain", () => {
  it("keeps the words and the line breaks, drops the markup", () => {
    const html = `<html><style>p{color:red}</style><body><p>Hi Garry,</p><p>Your estimate is <b>ready</b>.<br/>Open it &amp; reply.</p></body></html>`;
    const text = htmlToPlain(html);
    expect(text).not.toMatch(/<|color:red/);
    expect(text).toContain("Hi Garry,\nYour estimate is ready");
    expect(text).toContain("\nOpen it & reply.");
  });
});
