/**
 * The email block system (session 3.2).
 *
 * A campaign email is a LIST OF TYPED BLOCKS, never a blob of HTML. Two
 * reasons, and both are the point of the whole studio:
 *
 *   · Nobody can make an ugly email. Spacing, type scale, colour and button
 *     shape are decided here, once, so the person writing chooses words and
 *     photographs — not padding.
 *   · The same blocks are what the AI fills in. A model that returns HTML can
 *     return anything; a model that returns three headline strings and a photo
 *     slot can be checked, corrected and re-run field by field.
 *
 * The renderer is deliberately old-fashioned: tables, inline styles, no
 * external CSS, no web fonts, no flexbox. Outlook is still Word underneath,
 * and a beautiful email that collapses in one client is not beautiful.
 */

import { z } from "zod";

export const BRAND = {
  ink: "#12161A",
  text: "#333B42",
  muted: "#6B747C",
  line: "#E4E8EB",
  paper: "#FFFFFF",
  wash: "#F6F8F9",
  accent: "#2FB9CB",
  onAccent: "#FFFFFF",
} as const;

export type Brand = { [K in keyof typeof BRAND]: string } & { logoUrl?: string | null; companyName?: string };

const text = (max = 2000) => z.string().trim().max(max);

export const blockSchemas = {
  hero: z.object({
    kind: z.literal("hero"),
    headline: text(120),
    sub: text(300).default(""),
    imageUrl: z.string().url().max(500).nullable().default(null),
  }),
  text: z.object({
    kind: z.literal("text"),
    body: text(4000),
  }),
  photo: z.object({
    kind: z.literal("photo"),
    imageUrl: z.string().url().max(500),
    caption: text(200).default(""),
  }),
  /** Two photos side by side — the before/after every painter wants. */
  beforeAfter: z.object({
    kind: z.literal("beforeAfter"),
    beforeUrl: z.string().url().max(500),
    afterUrl: z.string().url().max(500),
    caption: text(200).default(""),
  }),
  bullets: z.object({
    kind: z.literal("bullets"),
    heading: text(120).default(""),
    items: z.array(text(200)).min(1).max(8),
  }),
  quote: z.object({
    kind: z.literal("quote"),
    body: text(600),
    attribution: text(120).default(""),
  }),
  button: z.object({
    kind: z.literal("button"),
    label: text(60),
    url: z.string().url().max(500),
    /** Sub-label under the button: "Takes two minutes", "No obligation". */
    note: text(120).default(""),
  }),
  offer: z.object({
    kind: z.literal("offer"),
    headline: text(120),
    detail: text(400).default(""),
    /** An offer with no end date is a liability, so the field is required. */
    expiresOn: z.string().max(40),
  }),
  signoff: z.object({
    kind: z.literal("signoff"),
    body: text(600),
    name: text(80).default(""),
  }),
  divider: z.object({ kind: z.literal("divider") }),
} as const;

export const blockSchema = z.discriminatedUnion("kind", [
  blockSchemas.hero, blockSchemas.text, blockSchemas.photo, blockSchemas.beforeAfter,
  blockSchemas.bullets, blockSchemas.quote, blockSchemas.button, blockSchemas.offer,
  blockSchemas.signoff, blockSchemas.divider,
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockKind = Block["kind"];

export const templateSchema = z.object({
  subject: text(150),
  /** The line under the subject in most inboxes. Worth writing. */
  preheader: text(200).default(""),
  blocks: z.array(blockSchema).max(30),
});
export type Template = z.infer<typeof templateSchema>;

/** What the studio offers when someone adds a block. */
export const BLOCK_MENU: Array<{ kind: BlockKind; label: string; hint: string }> = [
  { kind: "hero", label: "Headline", hint: "The one thing they should read" },
  { kind: "text", label: "Paragraph", hint: "Say it plainly" },
  { kind: "photo", label: "Photo", hint: "One of your own jobs" },
  { kind: "beforeAfter", label: "Before & after", hint: "Two photos, side by side" },
  { kind: "bullets", label: "Bullet list", hint: "What's included, what happens next" },
  { kind: "quote", label: "Customer quote", hint: "A review, in their words" },
  { kind: "button", label: "Button", hint: "The one action" },
  { kind: "offer", label: "Offer", hint: "Needs an end date" },
  { kind: "signoff", label: "Sign-off", hint: "From a person, not a company" },
  { kind: "divider", label: "Divider", hint: "A breath between sections" },
];

/** A sensible empty block, so "add" never lands on a broken form. */
export function blankBlock(kind: BlockKind): Block {
  switch (kind) {
    case "hero": return { kind, headline: "", sub: "", imageUrl: null };
    case "text": return { kind, body: "" };
    case "photo": return { kind, imageUrl: "https://", caption: "" };
    case "beforeAfter": return { kind, beforeUrl: "https://", afterUrl: "https://", caption: "" };
    case "bullets": return { kind, heading: "", items: [""] };
    case "quote": return { kind, body: "", attribution: "" };
    case "button": return { kind, label: "Get my estimate", url: "https://", note: "" };
    case "offer": return { kind, headline: "", detail: "", expiresOn: "" };
    case "signoff": return { kind, body: "", name: "" };
    case "divider": return { kind };
  }
}

// ---- rendering --------------------------------------------------------------

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Paragraph breaks survive; nothing else in the input is markup. */
const para = (s: string, style: string): string =>
  esc(s).split(/\n{2,}/).filter(Boolean)
    .map((p) => `<p style="${style}">${p.replace(/\n/g, "<br />")}</p>`)
    .join("");

const row = (inner: string, pad = "0 32px"): string =>
  `<tr><td style="padding:${pad};">${inner}</td></tr>`;

function renderBlock(b: Block, brand: Brand): string {
  const body = `margin:0 0 14px;font:400 16px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.text};`;
  switch (b.kind) {
    case "hero":
      return [
        b.imageUrl
          ? `<tr><td style="padding:0 0 22px;"><img src="${esc(b.imageUrl)}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;" /></td></tr>`
          : "",
        row(
          `<h1 style="margin:0 0 8px;font:600 27px/1.25 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.ink};letter-spacing:-.02em;">${esc(b.headline)}</h1>` +
          (b.sub ? `<p style="margin:0;font:400 17px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.muted};">${esc(b.sub)}</p>` : ""),
          "8px 32px 6px",
        ),
      ].join("");
    case "text":
      return row(para(b.body, body), "10px 32px 0");
    case "photo":
      return row(
        `<img src="${esc(b.imageUrl)}" width="536" alt="${esc(b.caption)}" style="display:block;width:100%;height:auto;border:0;border-radius:10px;" />` +
        (b.caption ? `<p style="margin:8px 0 0;font:400 13px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.muted};">${esc(b.caption)}</p>` : ""),
        "16px 32px 6px",
      );
    case "beforeAfter":
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="50%" style="padding-right:6px;vertical-align:top;">
            <img src="${esc(b.beforeUrl)}" width="262" alt="Before" style="display:block;width:100%;height:auto;border:0;border-radius:8px;" />
            <p style="margin:6px 0 0;font:600 11px/1.4 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.muted};letter-spacing:.1em;text-transform:uppercase;">Before</p>
          </td>
          <td width="50%" style="padding-left:6px;vertical-align:top;">
            <img src="${esc(b.afterUrl)}" width="262" alt="After" style="display:block;width:100%;height:auto;border:0;border-radius:8px;" />
            <p style="margin:6px 0 0;font:600 11px/1.4 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.accent};letter-spacing:.1em;text-transform:uppercase;">After</p>
          </td></tr></table>` +
        (b.caption ? `<p style="margin:10px 0 0;font:400 13px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.muted};">${esc(b.caption)}</p>` : ""),
        "16px 32px 6px",
      );
    case "bullets":
      return row(
        (b.heading ? `<p style="margin:0 0 8px;font:600 16px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.ink};">${esc(b.heading)}</p>` : "") +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0">` +
        b.items.filter(Boolean).map((i) =>
          `<tr><td width="18" style="vertical-align:top;padding:0 0 8px;color:${brand.accent};font:600 16px/1.6 Helvetica,Arial,sans-serif;">&#8226;</td>` +
          `<td style="padding:0 0 8px;font:400 16px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.text};">${esc(i)}</td></tr>`).join("") +
        `</table>`,
        "12px 32px 4px",
      );
    case "quote":
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="border-left:3px solid ${brand.accent};padding:4px 0 4px 16px;">
            <p style="margin:0 0 6px;font:400 italic 17px/1.6 Georgia,'Times New Roman',serif;color:${brand.ink};">&ldquo;${esc(b.body)}&rdquo;</p>
            ${b.attribution ? `<p style="margin:0;font:400 13px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.muted};">— ${esc(b.attribution)}</p>` : ""}
          </td></tr></table>`,
        "14px 32px 6px",
      );
    case "button":
      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:${brand.accent};border-radius:8px;">
            <a href="${esc(b.url)}" style="display:inline-block;padding:14px 26px;font:600 16px/1 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.onAccent};text-decoration:none;">${esc(b.label)}</a>
          </td></tr></table>` +
        (b.note ? `<p style="margin:9px 0 0;font:400 13px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.muted};">${esc(b.note)}</p>` : ""),
        "18px 32px 8px",
      );
    case "offer":
      return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:${brand.wash};border:1px solid ${brand.line};border-radius:12px;padding:18px 20px;">
            <p style="margin:0 0 6px;font:600 18px/1.35 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.ink};">${esc(b.headline)}</p>
            ${b.detail ? `<p style="margin:0 0 8px;font:400 15px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.text};">${esc(b.detail)}</p>` : ""}
            <p style="margin:0;font:600 12px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.muted};letter-spacing:.06em;text-transform:uppercase;">Ends ${esc(b.expiresOn)}</p>
          </td></tr></table>`,
        "16px 32px 6px",
      );
    case "signoff":
      return row(
        para(b.body, body) +
        (b.name ? `<p style="margin:2px 0 0;font:600 16px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${brand.ink};">${esc(b.name)}</p>` : ""),
        "12px 32px 4px",
      );
    case "divider":
      return row(`<div style="height:1px;background:${brand.line};line-height:1px;font-size:0;">&nbsp;</div>`, "20px 32px");
  }
}

/**
 * The whole email.
 *
 * `{{unsubscribe}}` is written into the footer by the renderer, not by the
 * person writing — an email that can go out without one is a compliance
 * problem waiting for a bad day.
 */
export function renderEmail(t: Template, brand: Brand = BRAND): string {
  const b = { ...BRAND, ...brand };
  const company = b.companyName || "Paint Group";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" /><title>${esc(t.subject)}</title></head>
<body style="margin:0;padding:0;background:${b.wash};">
<div style="display:none;font-size:1px;color:${b.wash};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(t.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${b.wash};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${b.paper};border-radius:14px;overflow:hidden;">
  <tr><td style="padding:24px 32px 0;">
    ${b.logoUrl
      ? `<img src="${esc(b.logoUrl)}" alt="${esc(company)}" height="26" style="display:block;height:26px;width:auto;border:0;" />`
      : `<p style="margin:0;font:600 16px/1 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${b.ink};letter-spacing:-.02em;">${esc(company)}</p>`}
  </td></tr>
  ${t.blocks.map((blk) => renderBlock(blk, b)).join("\n  ")}
  <tr><td style="padding:26px 32px 30px;">
    <div style="height:1px;background:${b.line};line-height:1px;font-size:0;margin:0 0 14px;">&nbsp;</div>
    <p style="margin:0;font:400 12px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${b.muted};">
      ${esc(company)} · <a href="{{unsubscribe}}" style="color:${b.muted};text-decoration:underline;">Unsubscribe</a><br />
      You're receiving this because you asked us for a painting quote.
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** The plain-text part. Every email needs one, and it is also the honest test
 *  of whether the words work without the design carrying them. */
export function renderPlainText(t: Template, brand: Brand = BRAND): string {
  const lines: string[] = [];
  for (const b of t.blocks) {
    switch (b.kind) {
      case "hero": lines.push(b.headline.toUpperCase(), b.sub); break;
      case "text": case "signoff": lines.push(b.body, b.kind === "signoff" ? (b as { name: string }).name : ""); break;
      case "photo": lines.push(b.caption); break;
      case "beforeAfter": lines.push(b.caption || "Before and after"); break;
      case "bullets": lines.push(b.heading, ...b.items.filter(Boolean).map((i) => `- ${i}`)); break;
      case "quote": lines.push(`"${b.body}"`, b.attribution ? `- ${b.attribution}` : ""); break;
      case "button": lines.push(`${b.label}: ${b.url}`, b.note); break;
      case "offer": lines.push(b.headline, b.detail, `Ends ${b.expiresOn}`); break;
      case "divider": lines.push("---"); break;
    }
  }
  lines.push("", `${brand.companyName || "Paint Group"} · Unsubscribe: {{unsubscribe}}`);
  return lines.filter((l) => l !== "").join("\n\n").slice(0, 20000);
}

/** Words that make a template unsendable until a human looks. Deliberately
 *  small and specific — a warning nobody reads is worse than none. */
export function templateWarnings(t: Template): string[] {
  const out: string[] = [];
  const all = JSON.stringify(t.blocks).toLowerCase();
  if (!t.subject.trim()) out.push("No subject line.");
  if (t.subject.length > 78) out.push("Subject is long — most inboxes cut it around 45 characters.");
  if (!t.blocks.some((b) => b.kind === "button")) out.push("No button: nothing for them to do.");
  if (t.blocks.some((b) => b.kind === "offer" && !b.expiresOn.trim())) out.push("An offer with no end date.");
  if (/\bhttps:\/\/\s*"|"https:\/\/"/.test(JSON.stringify(t.blocks))) out.push("A link or image is still empty.");
  if (/\bguarantee[ds]?\b|\bwarrant(y|ies)\b/.test(all)) {
    out.push("Mentions a guarantee or warranty — check the wording against what you actually offer.");
  }
  if (/\b(free|no charge)\b/.test(all) && !t.blocks.some((b) => b.kind === "offer")) {
    out.push("Says something is free outside an offer block, so nothing states the terms.");
  }
  return out;
}
