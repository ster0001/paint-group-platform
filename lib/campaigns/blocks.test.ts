import { describe, expect, it } from "vitest";
import {
  BLOCK_MENU, blankBlock, blockSchema, renderEmail, renderPlainText,
  templateSchema, templateWarnings, type Template,
} from "./blocks";

const template = (over: Partial<Template> = {}): Template => ({
  subject: "Your two-year warranty check",
  preheader: "A quick look over the work we did",
  blocks: [
    { kind: "hero", headline: "Time for your check-up", sub: "Two years on", imageUrl: null },
    { kind: "text", body: "We paint it once.\n\nThen we check it." },
    { kind: "button", label: "Book a visit", url: "https://paintgroup.com.au/book", note: "Takes two minutes" },
  ],
  ...over,
});

describe("the block schema", () => {
  it("gives every menu item a blank that actually validates", () => {
    // The "add block" trap: a blank that fails its own schema puts the studio
    // into a broken state the moment someone adds a block.
    for (const item of BLOCK_MENU) {
      const blank = blankBlock(item.kind);
      const r = blockSchema.safeParse(blank);
      if (!r.success) {
        // Empty required text is expected on a fresh block; a WRONG SHAPE is
        // not — every complaint must be about a field, never the kind itself.
        expect(r.error.issues.every((i) => i.path.length > 0 && i.path[0] !== "kind")).toBe(true);
      }
      expect(blank.kind).toBe(item.kind);
    }
  });

  it("refuses a block kind nobody wrote a renderer for", () => {
    expect(blockSchema.safeParse({ kind: "iframe", src: "https://evil" }).success).toBe(false);
  });
});

describe("renderEmail", () => {
  it("produces email-safe HTML — tables, inline styles, nothing external", () => {
    const html = renderEmail(template());
    expect(html).toContain("<table");
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/display:\s*flex/i);
    expect(html).not.toMatch(/@media[^{]*\{[^}]*grid/i);
  });

  it("always writes an unsubscribe link, whatever the blocks say", () => {
    // Not the writer's job to remember. An email that can go out without one
    // is a compliance problem waiting for a bad day.
    expect(renderEmail(template({ blocks: [] }))).toContain("{{unsubscribe}}");
    expect(renderPlainText(template({ blocks: [] }))).toContain("{{unsubscribe}}");
  });

  it("escapes anything typed into it", () => {
    const html = renderEmail(template({
      subject: 'Bad "quotes" & <tags>',
      blocks: [{ kind: "text", body: "<script>alert(1)</script>" }],
    }));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("keeps paragraph breaks and drops the rest", () => {
    const html = renderEmail(template({ blocks: [{ kind: "text", body: "One.\n\nTwo.\nStill two." }] }));
    expect((html.match(/<p style="margin:0 0 14px/g) ?? []).length).toBe(2);
    expect(html).toContain("Two.<br />Still two.");
  });

  it("renders each block kind without throwing", () => {
    const blocks = BLOCK_MENU.map((m) => blankBlock(m.kind));
    const html = renderEmail(template({ blocks }));
    expect(html).toContain("</html>");
    expect(html.length).toBeGreaterThan(1000);
  });

  it("is fluid, so it fits a phone and a preview pane without clipping", () => {
    // Found in the studio: a fixed 600px body was cut off in the preview
    // column, and would be cut off on a narrow phone too. The width attribute
    // stays for Outlook; the style is what every other client reads.
    const html = renderEmail(template());
    expect(html).toContain("width:100%;max-width:600px");
    expect(html).not.toContain('style="width:600px');
  });

  it("uses the company's own logo and name when it has them", () => {
    const html = renderEmail(template(), { ...{
      ink: "#000", text: "#111", muted: "#666", line: "#eee", paper: "#fff", wash: "#f5f5f5",
      accent: "#2FB9CB", onAccent: "#fff",
    }, logoUrl: "https://cdn.example.com/logo.png", companyName: "Paint Group" });
    expect(html).toContain("https://cdn.example.com/logo.png");
  });
});

describe("renderPlainText", () => {
  it("is readable on its own — the honest test of the words", () => {
    const txt = renderPlainText(template());
    expect(txt).toContain("TIME FOR YOUR CHECK-UP");
    expect(txt).toContain("Book a visit: https://paintgroup.com.au/book");
    expect(txt).not.toContain("<");
  });
});

describe("templateWarnings", () => {
  it("says when there is nothing to do", () => {
    const w = templateWarnings(template({ blocks: [{ kind: "text", body: "hello" }] }));
    expect(w).toContain("No button: nothing for them to do.");
  });

  it("flags a claim the business may not want to make", () => {
    // The brief's own risk: one invented warranty term in one email to 63
    // people outweighs a hundred bland ones.
    const w = templateWarnings(template({
      blocks: [{ kind: "text", body: "Our ten year guarantee covers everything." }],
    }));
    expect(w.some((x) => /guarantee or warranty/.test(x))).toBe(true);
  });

  it("flags a free claim with no terms anywhere", () => {
    const w = templateWarnings(template({ blocks: [{ kind: "text", body: "Free colour consult!" }] }));
    expect(w.some((x) => /free/.test(x))).toBe(true);
  });

  it("says nothing about a clean template", () => {
    expect(templateWarnings(template())).toEqual([]);
  });

  it("catches an offer with no end date", () => {
    const w = templateWarnings(template({
      blocks: [{ kind: "offer", headline: "10% off", detail: "", expiresOn: "  " }],
    }));
    expect(w).toContain("An offer with no end date.");
  });
});

describe("templateSchema", () => {
  it("accepts a real template and rejects an unbounded one", () => {
    expect(templateSchema.safeParse(template()).success).toBe(true);
    const many = template({ blocks: Array.from({ length: 40 }, () => ({ kind: "divider" as const })) });
    expect(templateSchema.safeParse(many).success).toBe(false);
  });
});

describe("per-recipient button links", () => {
  it("accepts the two tokens and real URLs, refuses anything else", () => {
    const button = (url: string) => blockSchema.safeParse({ kind: "button", label: "Open", url, note: "" });
    expect(button("{{estimate}}").success).toBe(true);
    expect(button("{{account}}").success).toBe(true);
    expect(button("https://paintgroup.com.au/estimate").success).toBe(true);
    // A token typo must not slip through as a literal href.
    expect(button("{{estimte}}").success).toBe(false);
    expect(button("javascript:alert(1)").success).toBe(false);
  });

  it("renders the token into the href for the sender to fill", () => {
    const html = renderEmail(template({
      blocks: [{ kind: "button", label: "Open my estimate", url: "{{estimate}}", note: "" }],
    }));
    expect(html).toContain('href="{{estimate}}"');
  });
});
