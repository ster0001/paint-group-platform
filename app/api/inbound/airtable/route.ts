import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { loadMatchContext } from "@/lib/costs/pipeline";
import { matchJob } from "@/lib/costs/match";
import { orderRefsIn } from "@/lib/costs/rules";
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

const recordSchema = z.object({
  record_id: z.string().min(1).max(200),
  supplier: z.string().max(200).default(""),
  brand: z.string().max(200).default(""),
  order_ref: z.string().max(300).default(""),
  address: z.string().max(300).default(""),
  amount_cents: z.number().int().positive().max(100_000_000),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const bodySchema = z.union([recordSchema, z.array(recordSchema).min(1).max(50)]);

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
          total_cents: rec.amount_cents,
          invoice_date: rec.invoice_date,
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
        p_amount_cents: rec.amount_cents,
        p_invoice_date: rec.invoice_date ?? null,
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
