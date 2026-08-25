import { describe, expect, it } from "vitest";
import { candidateDocLinks } from "./links";

describe("candidateDocLinks — the Dulux click-here shape", () => {
  const HTML = `
    <p>Your invoice is ready.</p>
    <a href="https://einvoice.dulux.com.au/view?id=abc123">Click here to open your invoice</a>
    <a href="https://www.dulux.com.au/unsubscribe?u=1">Unsubscribe</a>
    <a href="http://insecure.example/invoice.pdf">http link</a>
    <a href="https://cdn.example.com/docs/inv-991.pdf">inv-991.pdf</a>
    <a href="https://www.facebook.com/dulux">Facebook</a>`;

  it("ranks a .pdf link and a labelled invoice link, drops plumbing and http", () => {
    const links = candidateDocLinks(HTML, "");
    expect(links[0]).toBe("https://cdn.example.com/docs/inv-991.pdf");
    expect(links).toContain("https://einvoice.dulux.com.au/view?id=abc123");
    expect(links.some((l) => l.includes("unsubscribe"))).toBe(false);
    expect(links.some((l) => l.startsWith("http://"))).toBe(false);
    expect(links.some((l) => l.includes("facebook"))).toBe(false);
  });

  it("finds bare document URLs in plain text", () => {
    const links = candidateDocLinks("", "Download: https://portal.supplier.com.au/invoice/991.pdf.");
    expect(links).toEqual(["https://portal.supplier.com.au/invoice/991.pdf"]);
  });

  it("the click-here shape: a bare 'here' label counts when the surrounding text names the invoice", () => {
    const html = `<p>To open the invoice for your account, please click
      <a href="https://e.supplier.com.au/t/s/xb8Zjg0">here</a></p>`;
    expect(candidateDocLinks(html, "")).toEqual(["https://e.supplier.com.au/t/s/xb8Zjg0"]);
  });

  it("a bare 'here' with no document context stays out", () => {
    const html = `<p>To manage your preferences click <a href="https://e.supplier.com.au/t/s/zz">here</a></p>`;
    expect(candidateDocLinks(html, "")).toEqual([]);
  });

  it("nothing document-like → nothing proposed", () => {
    expect(candidateDocLinks('<a href="https://example.com/">home</a>', "hello")).toEqual([]);
  });
});
