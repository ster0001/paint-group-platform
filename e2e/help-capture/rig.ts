import type { Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { destroyLoopFixture, type LoopFixture } from "../fixtures/woLoop";

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
  // Bookings and walkthroughs hang off the work order; the estimate delete
  // cascades through work_orders, but be explicit about the offer rows so a
  // half-run never leaves a live offer against the shared test contractor.
  await db.from("booking_offers").delete().eq("work_order_id", f.workOrderId);
  await db.from("wo_walkthroughs").delete().eq("work_order_id", f.workOrderId);
  await destroyLoopFixture(db, f);
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
  const day = String(Number(targetIso.slice(8, 10)));
  await sheet.locator("button.cd2", { hasText: new RegExp(`^${day}$`) }).first().click();
}
