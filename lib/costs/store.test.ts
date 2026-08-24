import { describe, expect, it } from "vitest";
import { billsDocPath, isOwnReceiptPath, safeDocKey, safeFileName } from "./store";

describe("cost-docs path contract — a crafted path never reaches storage", () => {
  it("message ids reduce to safe stable keys", () => {
    const a = safeDocKey("<CAB+x=y@mail.gmail.com>");
    expect(a).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(safeDocKey("<CAB+x=y@mail.gmail.com>")).toBe(a); // stable
    expect(safeDocKey("../../etc/passwd")).not.toContain("..");
  });

  it("filenames are sanitised with a fallback", () => {
    expect(safeFileName("invoice (final).pdf", "document")).toBe("invoice__final_.pdf");
    expect(safeFileName("../../evil", "document")).not.toContain("..");
    expect(safeFileName("", "document")).toBe("document");
  });

  it("bills paths are month-scoped and refuse bad months", () => {
    expect(billsDocPath("2026-08", "m1", "a.pdf")).toMatch(/^bills\/2026-08\/[A-Za-z0-9._-]+\/a\.pdf$/);
    expect(() => billsDocPath("2026/08", "m1", "a.pdf")).toThrow();
  });

  it("receipt paths: own prefix only, no traversal", () => {
    const uid = "11111111-1111-1111-1111-111111111111";
    expect(isOwnReceiptPath(`receipts/${uid}/123-doc.pdf`, uid)).toBe(true);
    expect(isOwnReceiptPath(`receipts/${uid}/../other/doc.pdf`, uid)).toBe(false);
    expect(isOwnReceiptPath("receipts/other-user/doc.pdf", uid)).toBe(false);
    expect(isOwnReceiptPath(`/receipts/${uid}/doc.pdf`, uid)).toBe(false);
    expect(isOwnReceiptPath(`receipts/${uid}//doc.pdf`, uid)).toBe(false);
    expect(isOwnReceiptPath(`bills/2026-08/x/doc.pdf`, uid)).toBe(false);
  });
});
