import { describe, expect, it } from "vitest";
import { buildPainterMessageItems, GROUP_OF_KIND, homeOf, isCustomerVisible, pcItems, crmItems, type PainterMessageQueueRow } from "./work-queue";
import { melbourneInstant } from "@/lib/time/businessHours";

/**
 * Tom, 9 Oct 2026: a painter's message in a project's Messages box is a PC
 * work item ("<painter> replied on <job>") until someone in the office reads
 * the thread. Derived from the thread's read state — never stored — so the
 * reader decides which threads arrive here; this pins what the card says.
 */
const row = (over: Partial<PainterMessageQueueRow> = {}): PainterMessageQueueRow => ({
  threadId: "t1", workOrderId: "wo1", contractorId: "c1",
  lastPainterAt: melbourneInstant(2026, 10, 9, 10, 5).toISOString(),
  officeWroteFirst: true, woRef: "WO-101", where: "12 Test St, Thornbury", painter: "Josef Kovac",
  unread: [{ body: "Back wall has rot under the sill — photo attached.", photos: 1, at: melbourneInstant(2026, 10, 9, 10, 5).toISOString() }],
  ...over,
});

describe("painter messages on PC Command", () => {
  it("says who replied on which job, opens the thread for that painter, homed on PC only", () => {
    const [item] = buildPainterMessageItems([row()], melbourneInstant(2026, 10, 9, 10, 30));
    expect(item.kind).toBe("painter_message");
    expect(item.title).toBe("Josef Kovac replied on WO-101 — 12 Test St, Thornbury");
    expect(item.detail).toBe("“Back wall has rot under the sill — photo attached.” + 1 photo. Open it to read and reply — that clears this card.");
    expect(item.action).toEqual({ label: "Read and reply", href: "/pc/wo/wo1?painter=c1#messages" });
    expect(item.bucket).toBe("today");
    expect(homeOf("painter_message")).toBe("pc");
    expect(pcItems([item])).toHaveLength(1);
    expect(crmItems([item])).toHaveLength(0);
    expect(GROUP_OF_KIND.painter_message).toBe("messages");
    expect(isCustomerVisible("painter_message")).toBe(false);
  });

  it("a painter who wrote first 'wrote about'; several unread are counted; photos alone are named", () => {
    const [item] = buildPainterMessageItems([row({
      officeWroteFirst: false,
      unread: [
        { body: "", photos: 3, at: melbourneInstant(2026, 10, 9, 10, 5).toISOString() },
        { body: "Morning", photos: 0, at: melbourneInstant(2026, 10, 9, 9, 50).toISOString() },
      ],
    })], melbourneInstant(2026, 10, 9, 10, 30));
    expect(item.title).toBe("Josef Kovac wrote about WO-101 — 12 Test St, Thornbury");
    expect(item.detail.startsWith("2 messages: “3 photos”.")).toBe(true);
    expect(item.since).toBe(melbourneInstant(2026, 10, 9, 9, 50).toISOString());
  });

  it("the key moves with the newest message, so a new one after a dismissal comes back", () => {
    const a = buildPainterMessageItems([row()], new Date())[0].key;
    const b = buildPainterMessageItems([row({ lastPainterAt: melbourneInstant(2026, 10, 9, 11, 0).toISOString() })], new Date())[0].key;
    expect(a).not.toBe(b);
    expect(a.startsWith("painter_message:thread:t1:")).toBe(true);
  });

  it("goes overdue when nobody has read it by the next day", () => {
    const [item] = buildPainterMessageItems([row()], melbourneInstant(2026, 10, 10, 9));
    expect(item.bucket).toBe("overdue");
  });
});
