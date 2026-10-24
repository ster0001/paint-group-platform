import { describe, expect, it } from "vitest";
import { icsPlain, inviteWords } from "./invite";

// Tom, 24 Oct 2026: "Paint · Taubmans ¬∑ 1 line ¬∑ 2 cans" is not an instruction. The calendar entry's
// title is the ask, its description is the text message's words, and both are plain ASCII.
describe("the movement calendar entry", () => {
  const vars = {
    ask: "Please collect the paint (Taubmans · 1 line · 2 cans) from Dulux Trade Oakleigh and deliver it to 6 Fleet St",
    wo_ref: "PG-0101", day: "Mon 26 Oct", when: "07:00–08:00", where: "Dulux Trade Oakleigh, 12 Shop Rd", order_line: "Order 4471 under Paint Group. ",
    note: "leave with Josef", link: "https://x/pc/movements/run?day=2026-10-26", company_name: "Paint Group",
  };
  it("titles the entry with the ask and the job, in ASCII", () => {
    const w = inviteWords(vars);
    expect(w.summary).toBe("Please collect the paint (Taubmans - 1 line - 2 cans) from Dulux Trade Oakleigh and deliver it to 6 Fleet St (PG-0101)");
    expect(w.summary).toMatch(/^[\x20-\x7E]+$/);
  });
  it("describes it with the text message's words: when, where, order, note, link", () => {
    const d = inviteWords(vars).description;
    expect(d).toContain("Mon 26 Oct at 07:00-08:00, Dulux Trade Oakleigh, 12 Shop Rd.");
    expect(d).toContain("Order 4471 under Paint Group. leave with Josef");
    expect(d).toContain("Details, with Navigate and Call: https://x/pc/movements/run?day=2026-10-26");
    expect(d).toMatch(/^[\x20-\x7E\n]+$/);
  });
  it("icsPlain keeps words and drops the glyphs that mojibake", () => {
    expect(icsPlain("Rubbish — how? · 3 m³ → tip")).toBe("Rubbish - how? - 3 m to tip");
  });
});
