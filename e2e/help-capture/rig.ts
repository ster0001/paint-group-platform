import type { Locator, Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import type { LoopFixture } from "../fixtures/woLoop";

/**
 * Help-content capture rig (docs/briefs/claude-code-brief-help-content-foundation.md, A2).
 *
 * These specs are NOT gates: they drive the real flows in the real roles on the
 * C1 test stack and save the screenshots the help files embed, at
 * docs/help/<feature>/media/<role>-<step>.png. Re-run them whenever a screen
 * changes; the help files then need re-reading against the new pictures.
 *
 *   ./scripts/c1/run-e2e.sh e2e/help-capture/scheduling.spec.ts
 *
 * Test data only — every name, address and amount below is invented.
 */

export const PHONE = { width: 390, height: 844 };
export const DESK = { width: 1440, height: 900 };

export type HelpRole = "staff" | "pc" | "contractor" | "customer";

export async function shot(page: Page, feature: string, role: HelpRole, step: string, opts: { fullPage?: boolean } = {}) {
  const dir = `docs/help/${feature}/media`;
  mkdirSync(dir, { recursive: true });
  // Viewport-sized by default: the portal has a fixed bottom tab bar and
  // bottom sheets, which a full-page capture strands mid-image.
  // Let the streamed bits settle — the board and the portal both render behind
  // suspense boundaries, and a screenshot mid-stream is a skeleton.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/${role}-${step}.png`, fullPage: opts.fullPage ?? false });
}

const token = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join("");

export type TrayJobSpec = {
  title: string;
  address: string;
  contactFirstName: string;
  paymentCents: number;
  areas: { title: string; surfaces: { label: string; hours: number }[] }[];
  /** Assign + book straight away (skips the tray) — for flows that start on a booked job. */
  assigned?: { contractorId: string; startDate: string; stage: "in_progress" | "pre_start" };
};

/** An ISSUED job. Unassigned it sits in the staff tray; assigned it is a live job. */
export async function createHelpJob(db: SupabaseClient, spec: TrayJobSpec): Promise<LoopFixture> {
  const { data: est, error: estErr } = await db
    .from("estimates")
    .insert({
      status: "accepted", source: "manual", level_of_finish: 3, title: spec.title,
      builder_state: { blocks: [], contact: { first_name: spec.contactFirstName, email: "pg.help.customer@example.com" } },
    })
    .select("id").single();
  if (estErr) throw new Error(`help estimate: ${estErr.message}`);
  const estimateId = (est as { id: string }).id;

  const woRef = `WO-HELP${Math.floor(1000 + Math.random() * 9000)}`;
  const { data: wo, error: woErr } = await db
    .from("work_orders")
    .insert({
      estimate_id: estimateId,
      wo_ref: woRef,
      share_token: token(),
      contractor_id: spec.assigned?.contractorId ?? null,
      start_date: spec.assigned?.startDate ?? null,
      stage: spec.assigned?.stage ?? "offered",
      status: spec.assigned ? "in_progress" : "issued",
      issued_at: new Date().toISOString(),
      contractor_payment_cents: spec.paymentCents,
      wo_snapshot: {
        version: 1, woRef, status: "issued",
        jobTitle: spec.title, jobAddress: spec.address,
        contactFirstName: spec.contactFirstName, contactPhone: "0400 000 000", startDate: null,
        accessNotes: "Side gate — code on the day.", crewNotes: "", levelOfFinish: "Level 3", finishCode: "PG-3",
        contractorName: "", contractorPaymentCents: spec.paymentCents,
        materials: [{ product: "Dulux Wash&Wear Low Sheen", photoUrl: "", litres: 30, coverageMissing: false,
                      colourName: "Natural White", colourHex: "#F2F0EA", colourStatus: "confirmed" }],
        areas: spec.areas.map((a, i) => ({
          id: `a${i}`, title: a.title, finishCode: "PG-3", finishOverridden: false, photos: [],
          surfaces: a.surfaces.map((s, j) => ({
            key: `a${i}:${j}`, label: s.label, coats: 2, product: "Dulux Wash&Wear Low Sheen", prep: "Fill, sand, spot-prime", hours: s.hours,
            status: "not_started",
          })),
        })),
        exclusions: [], company: { name: "Paint Group", phone: "", logoUrl: "" },
      },
    })
    .select("id").single();
  if (woErr) throw new Error(`help work order: ${woErr.message}`);
  const workOrderId = (wo as { id: string }).id;

  const rows = spec.areas.flatMap((a, i) =>
    a.surfaces.map((s, j) => ({
      work_order_id: workOrderId, heading: a.title,
      heading_meta: `${a.surfaces.length} surfaces · 2 coats · PG-3`,
      label: s.label, surface_key: `a${i}:${j}`, sort: i * 100 + j,
    })),
  );
  const { data: seeded, error: sErr } = await db.from("wo_surfaces").insert(rows).select("id, heading, label");
  if (sErr) throw new Error(`help surfaces: ${sErr.message}`);
  return { estimateId, workOrderId, surfaces: seeded as LoopFixture["surfaces"] };
}

export async function destroyHelpJob(db: SupabaseClient, f: LoopFixture | null) {
  if (!f) return;
  // Children first, then the work order, then the estimate. One cascading
  // estimate delete hits the statement timeout when another suite is loading
  // the shared test project (6 Sep); a dozen small deletes never do.
  for (const t of [
    "contractor_invoices", "job_costs", "contractor_expenses", "expense_preapprovals", "material_costs",
    "booking_offers", "wo_walkthroughs", "wo_qa_checks" /* wo_qa_items cascade from it */, "wo_variations", "wo_photos",
    "wo_updates", "wo_events", "wo_surfaces", "wo_checklist_items", "wo_signoff", "wo_reports",
  ]) {
    await db.from(t).delete().eq("work_order_id", f.workOrderId);
  }
  await db.from("invoices").delete().eq("estimate_id", f.estimateId);
  await db.from("work_orders").delete().eq("id", f.workOrderId);
  // The estimate delete still cascades through its own children; under load it
  // can hit the statement timeout once. Retry before calling it a leak.
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await db.from("estimates").delete().eq("id", f.estimateId);
    if (!error) return;
    lastError = error.message;
    await new Promise((r) => setTimeout(r, 4_000));
  }
  throw new Error(`fixture leak: estimate ${f.estimateId} not deleted — ${lastError}`);
}

export const INTERIOR_AREAS: TrayJobSpec["areas"] = [
  { title: "Living room", surfaces: [{ label: "Walls", hours: 6 }, { label: "Ceiling", hours: 3 }, { label: "Skirting", hours: 1.5 }] },
  { title: "Kitchen", surfaces: [{ label: "Walls", hours: 4 }, { label: "Ceiling", hours: 2 }] },
  { title: "Hallway", surfaces: [{ label: "Walls", hours: 3 }, { label: "Doors — 4", hours: 4 }] },
  { title: "Bedroom 1", surfaces: [{ label: "Walls", hours: 4 }, { label: "Ceiling", hours: 2 }, { label: "Skirting", hours: 1 }] },
  { title: "Bedroom 2", surfaces: [{ label: "Walls", hours: 3.5 }, { label: "Ceiling", hours: 2 }] },
];

/** Calendar-date arithmetic the repo way: UTC parse, UTC add, never toISOString of a local midnight. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pick a day in the portal CalendarGrid (mode="pick"), paging months as needed. */
export async function pickCalendarDay(page: Page, sheet: import("@playwright/test").Locator, fromIso: string, targetIso: string) {
  const fromMonth = Number(fromIso.slice(0, 7).replace("-", ""));
  const toMonth = Number(targetIso.slice(0, 7).replace("-", ""));
  const forward = (toMonth % 100) - (fromMonth % 100) + 12 * (Math.floor(toMonth / 100) - Math.floor(fromMonth / 100));
  for (let i = 0; i < forward; i++) await sheet.locator("button.btn.gh.narrow").nth(1).click();
  // A day the painter marked off, or a booked one, carries a <small> label
  // after the number ("14OFF"); match the number, not the whole text.
  const day = String(Number(targetIso.slice(8, 10)));
  await sheet.locator("button.cd2", { hasText: new RegExp(`^${day}(?:[A-Z]|$)`) }).first().click();
}

// ---- test photos + framing --------------------------------------------------

/**
 * A believable "photo" for uploads: a soft two-tone gradient PNG of the given
 * size, encoded here with zlib so the rig needs no image library. A 1×1 pixel
 * passes the MIME check too, but renders as a flat colour block in every
 * screenshot, which reads as broken.
 */
export function placeholderPng(width = 480, height = 360, seed = 0): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      const t = (x / width + y / height) / 2;
      raw[o] = Math.round(120 + 60 * t + ((seed * 37) % 40));      // r
      raw[o + 1] = Math.round(135 + 50 * (1 - t) + ((seed * 17) % 30)); // g
      raw[o + 2] = Math.round(150 + 40 * t);                        // b
    }
  }
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  const crc = (buf: Buffer) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Scroll a card to the middle of the viewport before shooting it. */
export async function frame(page: Page, target: Locator) {
  await target.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.waitForTimeout(300);
}

/** Tall desktop for long two-column pages such as the PC job page. */
export const DESK_TALL = { width: 1440, height: 1300 };

// ---- walkthrough GIFs -----------------------------------------------------------

/**
 * A walkthrough GIF is a run of frames captured while a help file's steps are
 * performed, with a caption banner injected into the page for each step, then
 * joined into an animated GIF with sharp (already a dependency). No video
 * decoder is needed, so this runs anywhere the e2e suite runs.
 */
export type Frame = { at: number; png: Buffer };

const CAPTION_KEY = "__helpCaption";

/** Install the caption banner on every page load in this context (call before the first goto). */
export async function installCaptions(page: Page) {
  await page.addInitScript((key: string) => {
    const mount = () => {
      if (document.getElementById("help-caption")) return;
      const el = document.createElement("div");
      el.id = "help-caption";
      el.setAttribute("style", [
        "position:fixed", "left:12px", "right:12px", "bottom:calc(env(safe-area-inset-bottom, 0px) + 84px)", "z-index:2147483647",
        "background:rgba(10,11,13,.92)", "color:#EDF0F2", "border:1px solid #3BD8E9", "border-radius:12px",
        "padding:10px 14px", "font:600 15px/1.35 -apple-system,BlinkMacSystemFont,Inter,Segoe UI,sans-serif",
        "box-shadow:0 6px 24px rgba(0,0,0,.5)", "pointer-events:none", "display:none",
      ].join(";"));
      document.documentElement.appendChild(el);
      const text = sessionStorage.getItem(key);
      const top = sessionStorage.getItem(key + ":top");
      if (top) { el.style.top = `${top}px`; el.style.bottom = "auto"; }
      if (text) { el.textContent = text; el.style.display = "block"; }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  }, CAPTION_KEY);
}

/** Show a caption (survives navigations via sessionStorage). Empty string hides it. */
export async function caption(page: Page, text: string, opts: { bottom?: number; top?: number } = {}) {
  await page.evaluate(([key, t, bottom, top]) => {
    sessionStorage.setItem(key as string, t as string);
    if (top != null) sessionStorage.setItem(key + ":top", String(top));
    const el = document.getElementById("help-caption");
    if (el) {
      el.textContent = t as string;
      el.style.display = t ? "block" : "none";
      if (bottom != null) { el.style.bottom = `${bottom}px`; el.style.top = "auto"; }
      if (top != null) { el.style.top = `${top}px`; el.style.bottom = "auto"; }
    }
  }, [CAPTION_KEY, text, opts.bottom ?? null, opts.top ?? null] as const);
  await page.waitForTimeout(900); // let the reader catch the caption before anything moves
}

/** Capture frames until stop(); ~5 fps, tolerant of navigations mid-capture. */
export function startRecording(page: Page, intervalMs = 220): { stop: () => Promise<Frame[]> } {
  const frames: Frame[] = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        // Skip mid-load frames: a half-rendered document, or one without its
        // viewport meta yet (which mobile emulation draws at 980px and shrinks).
        const ok = await page.evaluate(
          (w) => document.readyState === "complete" && window.innerWidth === w,
          page.viewportSize()?.width ?? 0,
        );
        if (ok) {
          const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
          frames.push({ at: Date.now(), png });
        }
      } catch {
        // navigating — skip this tick
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return {
    stop: async () => { running = false; await loop; return frames; },
  };
}

/**
 * Join frames into docs/help/<feature>/media/<name>.gif. Frame delays follow real
 * time; if the whole run exceeds maxSeconds it is sped up uniformly (the brief
 * caps a walkthrough at 60 s). The last frame holds for two seconds.
 */
export async function writeGif(frames: Frame[], feature: string, name: string, opts: { width: number; maxSeconds?: number }) {
  const sharp = (await import("sharp")).default;
  if (frames.length < 2) throw new Error(`not enough frames for ${name}`);
  const dir = `docs/help/${feature}/media`;
  mkdirSync(dir, { recursive: true });
  const delays = frames.map((f, i) => (i + 1 < frames.length ? Math.max(60, frames[i + 1].at - f.at) : 2000));
  const total = delays.reduce((a, b) => a + b, 0);
  const max = (opts.maxSeconds ?? 58) * 1000;
  const factor = total > max ? max / total : 1;
  const scaled = delays.map((d, i) => (i + 1 < frames.length ? Math.max(40, Math.round(d * factor)) : 2000));
  const resized = await Promise.all(frames.map((f) => sharp(f.png).resize({ width: opts.width }).png().toBuffer()));
  const out = `${dir}/${name}.gif`;
  await sharp(resized, { join: { animated: true } })
    .gif({ delay: scaled, loop: 0, colours: 128, effort: 7 })
    .toFile(out);
  return { path: out, frames: frames.length, seconds: Math.round(scaled.reduce((a, b) => a + b, 0) / 100) / 10, spedUp: factor < 1 };
}

// ---- shared tap/upload helpers for the walkthrough specs -------------------------

let photoSeed = 100;

/** Click something that opens the phone's file picker and give it a placeholder photo. */
export async function uploadPhoto(page: Page, trigger: Locator, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await trigger.click();
  await (await chooser).setFiles({ name, mimeType: "image/png", buffer: placeholderPng(480, 360, photoSeed++) });
}

/**
 * Tap a tick row once; if the tap opened the picker (an area's first or last
 * tick asks for its before / finished shot), supply a photo instead.
 */
export async function tapWithPhoto(page: Page, row: Locator, name: string): Promise<"photo" | "tick"> {
  const chooser = page.waitForEvent("filechooser", { timeout: 2_500 }).catch(() => null);
  await row.click();
  const fc = await chooser;
  if (fc) {
    await fc.setFiles({ name, mimeType: "image/png", buffer: placeholderPng(480, 360, photoSeed++) });
    await page.waitForTimeout(1500);
    return "photo";
  }
  await page.waitForTimeout(600);
  return "tick";
}

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const daysFromNow = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
