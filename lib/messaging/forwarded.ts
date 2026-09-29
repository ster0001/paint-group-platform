/**
 * Tom, 29 Sep 2026: "when a customer responds to our email to our
 * info@paintgroup email, it automatically saves their response in their CRM".
 *
 * Replies to a reply-domain address already land in the CRM (reply+<token>@).
 * A message that arrives at the OFFICE mailbox instead — a reply to an older
 * email, or a fresh one — reaches the CRM by a mailbox rule that forwards it
 * to the receiving domain. A forwarded email is FROM the office and carries
 * the customer's address only inside its body, under the "Forwarded message"
 * header block that every mail client writes. This reads that block back:
 * who really wrote it, and what they wrote, with the forwarding wrapper and
 * the header block removed.
 *
 * Pure text in, data out. Nothing here is instructions.
 */

export type ForwardedOrigin = {
  /** The original sender's address, lower-cased. */
  fromEmail: string;
  /** Their display name when the header carried one, else "". */
  fromName: string;
  /** The original subject when the header carried one, else "". */
  subject: string;
  /** The customer's own words: the text after the header block. */
  body: string;
};

const FROM_LINE = /^\s*(?:>\s*)?\*?\s*(?:From|De|Von)\s*:\s*\*?\s*(.+?)\s*$/im;
const SUBJECT_LINE = /^\s*(?:>\s*)?\*?\s*(?:Subject|Objet|Betreff)\s*:\s*\*?\s*(.+?)\s*$/im;
const HEADER_BLOCK = /^(?:\s*(?:>\s*)?(?:-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:|-{5,}\s*Original Message\s*-{5,})\s*$)/im;

/** "Name <addr>" | "addr" | "Name [mailto:addr]" → { name, email } (email lower-cased, or ""). */
export function parseAddressLine(raw: string): { name: string; email: string } {
  const s = raw.replace(/\s+/g, " ").trim();
  const angled = s.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/) ?? s.match(/\[mailto:\s*([^\]\s]+@[^\]\s]+)\s*\]/i);
  if (angled) {
    const name = s.slice(0, s.indexOf(angled[0])).replace(/["']/g, "").trim();
    return { name, email: angled[1].toLowerCase() };
  }
  const bare = s.match(/([^\s"'<>]+@[^\s"'<>]+\.[^\s"'<>]+)/);
  return bare ? { name: "", email: bare[1].toLowerCase() } : { name: "", email: "" };
}

/**
 * The forwarded original inside `text`, or null when there is no header
 * block or it names no address. `notThese` are addresses that cannot be the
 * customer (the office's own, the forwarding mailbox) — a From line naming
 * one of them is a chain of internal forwards, not a customer.
 */
export function forwardedOrigin(text: string, notThese: readonly string[] = []): ForwardedOrigin | null {
  if (!text) return null;
  const skip = new Set(notThese.map((a) => a.trim().toLowerCase()).filter(Boolean));
  const blockAt = text.search(HEADER_BLOCK);
  // Some clients (Outlook desktop) write the header lines with no banner —
  // accept a From: line inside the first 40 lines in that case.
  const scanFrom = blockAt >= 0 ? blockAt : 0;
  const head = text.slice(scanFrom, scanFrom + 4000);
  const fromMatch = head.match(FROM_LINE);
  if (!fromMatch) return null;
  if (blockAt < 0) {
    const lineNo = text.slice(0, scanFrom + (fromMatch.index ?? 0)).split("\n").length;
    if (lineNo > 40) return null;
  }
  const { name, email } = parseAddressLine(fromMatch[1]);
  if (!email || skip.has(email)) return null;
  const subject = head.match(SUBJECT_LINE)?.[1]?.replace(/^\s*(?:re|fwd?|tr|wg)\s*:\s*/i, "").trim() ?? "";

  // The body: after the header block's last header line (To:/Date:/Subject:/
  // Cc:), which ends at the first blank line following the From line.
  const fromAbs = scanFrom + (fromMatch.index ?? 0);
  const afterFrom = text.slice(fromAbs);
  // A "blank" line inside a quoted forward is a bare ">" (Apple Mail).
  const blank = afterFrom.search(/\n[ \t>]*\n/);
  let body = blank >= 0 ? afterFrom.slice(blank).trim() : "";
  // Gmail's quoting prefixes every forwarded line with "> " when the person
  // replied-and-forwarded; strip one level so the words read plainly.
  if (body && body.split("\n").every((l) => !l.trim() || l.startsWith(">"))) body = body.replace(/^>\s?/gm, "").trim();
  return { fromEmail: email, fromName: name, subject, body };
}
