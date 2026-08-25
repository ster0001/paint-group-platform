import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { loadMatchContext } from "@/lib/costs/pipeline";
import { matchJob } from "@/lib/costs/match";
import { orderRefsIn, parseAuDate } from "@/lib/costs/rules";
import { safeDocKey, storeCostDoc } from "@/lib/costs/store";
import { melbourneDate } from "@/lib/workorder/console";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Airtable transition door (⚑A2/⚑20) — the Zapier/Airtable materials path
 * pushes records here (Zapier webhook action, Bearer AIRTABLE_SYNC_SECRET)
 * and they write THROUGH the same pipeline: an intake row for provenance and
 * the cross-door duplicate guard, then the idempotent material_costs upsert.
 * Retired by Tom after bills@ runs clean for a month.
 */

// Zapier-tolerant: numbers arrive as text ("412.80"), money as dollars, and
// dates in whatever shape the Airtable field holds. `amount` (dollars) or
// `amount_cents` — one is required; dates fall back to the AU day-first
// reader and an unreadable date is dropped, never a reason to lose the record.
const recordSchema = z
  .object({
    record_id: z.string().min(1).max(200),
    supplier: z.string().max(200).default(""),
    brand: z.string().max(200).default(""),
    order_ref: z.string().max(300).default(""),
    address: z.string().max(300).default(""),
    amount_cents: z.coerce.number().int().positive().max(100_000_000).optional(),
    amount: z.coerce.number().positive().max(1_000_000).optional(), // dollars
    invoice_date: z.string().max(40).optional(),
  })
  .refine((r) => r.amount_cents != null || r.amount != null, {
    message: "amount or amount_cents required",
  });

const bodySchema = z.union([recordSchema, z.array(recordSchema).min(1).max(50)]);

function centsOf(rec: z.infer<typeof recordSchema>): number {
  return rec.amount_cents ?? Math.round((rec.amount ?? 0) * 100);
}

function isoDateOf(raw: string | undefined): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return parseAuDate(raw) ?? null;
}

export async function POST(req: Request) {
  const secret = process.env.AIRTABLE_SYNC_SECRET;
  if (!secret) return new NextResponse("Sync not configured.", { status: 503 });
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized.", { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return new NextResponse("Bad payload.", { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return new NextResponse("Bad payload.", { status: 400 });
  const records = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  const service = createServiceClient();
  if (!service) return new NextResponse("Service unavailable.", { status: 503 });

  const { jobs, vendors } = await loadMatchContext(service);
  const month = melbourneDate(new Date()).slice(0, 7);
  const results: Record<string, string> = {};

  for (const rec of records) {
    try {
      // The record itself is the provenance document.
      const docPath = `airtable/${month}/${safeDocKey(rec.record_id)}.json`;
      await storeCostDoc(
        service,
        docPath,
        new Uint8Array(Buffer.from(JSON.stringify(rec))),
        "application/json",
      );

      // Current practice puts the address in the order-reference field —
      // both matchers run (§5): PG/WO refs first, then the address.
      const proposal = matchJob(
        {
          supplier: rec.supplier,
          order_ref: orderRefsIn(rec.order_ref)[0],
          address_text: rec.address || rec.order_ref,
          total_cents: centsOf(rec),
          invoice_date: isoDateOf(rec.invoice_date) ?? undefined,
          job_hints: orderRefsIn(rec.order_ref),
        },
        `${rec.order_ref}\n${rec.address}`,
        "",
        jobs,
        vendors,
      );

      const { data, error } = await service.rpc("material_cost_sync_airtable", {
        p_record_id: rec.record_id,
        p_supplier: rec.supplier,
        p_brand: rec.brand,
        p_order_ref: rec.order_ref,
        p_address: rec.address,
        p_amount_cents: centsOf(rec),
        p_invoice_date: isoDateOf(rec.invoice_date),
        p_raw_doc_path: docPath,
        p_proposed_wo: proposal.woId,
        p_match_reason: proposal.reason,
      });
      results[rec.record_id] = error ? `error:${error.message}` : String(data ?? "");
    } catch (e) {
      reportError(e, { where: "airtableSync.record", extra: { recordId: rec.record_id } });
      results[rec.record_id] = "error:exception";
    }
  }

  return NextResponse.json({ received: true, results });
}
