/**
 * Session 6 — the export streams: 10,000 rows come out as many chunks, the
 * first carries the BOM, every row is RFC 4180, and a formula-looking cell
 * is neutralised. Nothing here builds the whole file as one string first.
 */
import { describe, expect, it } from "vitest";
import { csvCell, csvStream } from "./csv";
import { estimatesSent } from "./metrics/sales";

describe("csvStream", () => {
  it("streams 10k rows in many chunks, BOM first, header then one CRLF line per row", async () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({ sent_on: "2026-09-01", title: `Job ${i}, "quoted"`, status: "sent", total_cents: i * 100, lead_source: "referral", sent_by_user_id: null }));
    const reader = csvStream(estimatesSent, rows).getReader();
    const dec = new TextDecoder("utf-8", { ignoreBOM: true });   // the default decoder swallows the BOM
    let chunks = 0; let text = "";
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks += 1; text += dec.decode(value, { stream: true }); }
    expect(chunks).toBeGreaterThan(100);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split("\r\n");
    expect(lines[0]).toBe("Sent,Estimate,Status,\"Total (cents, inc GST)\",Lead source,Sent by (user id)");
    expect(lines).toHaveLength(10_002);   // header + 10k rows + the trailing empty string after the last CRLF
    expect(lines[1]).toBe("2026-09-01,\"Job 0, \"\"quoted\"\"\",sent,0,referral,");
  });
  it("neutralises a formula-looking cell", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+61 400")).toBe("'+61 400");
  });
});
