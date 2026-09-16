import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { bookedJobFromZap, zapJobSchema } from "@/lib/import/booked/zap";
import { loadBookedWriteContext, writeBookedJob } from "@/lib/import/booked/write";
import { SubstrateResolver } from "@/lib/import/booked/build";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Part C — the handover door (brief C1). While Airtable and the platform both
 * run, a Zap posts every project that lands in *Future Booked Jobs* or *Needs
 * booking* here, with the PaintScout quote it fetched. The job is written
 * exactly as Part B writes one — silent acceptance, the working scope with
 * every figure an override, the work order straight into the Unscheduled tray
 * with the Airtable plan as its note — through the same lib/import/booked
 * path, so there is one implementation.
 *
 * Idempotent on record_id / quote_no: a second post for the same quote updates
 * the tray note when the plan changed and touches nothing else. Never
 * re-prices, never creates an offer, never emails anyone.
 *
 * The quote gives area prices and the job's total hours, not per-line hours,
 * so the job arrives with `hours_pending` and a work item asking the office
 * to type the hours from the PaintScout work order (Tom's C-1, 16 Sep 2026).
 */

const bodySchema = z.union([zapJobSchema, z.array(zapJobSchema).min(1).max(20)]);

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

  const results: Record<string, string> = {};
  let wctx: Awaited<ReturnType<typeof loadBookedWriteContext>> | null = null;
  for (const rec of records) {
    try {
      const conv = bookedJobFromZap(rec);
      if (!conv.ok) {
        // Zapier is the only reader of the response; a refused handover must reach the error monitor or nobody learns of it.
        reportError(new Error(`Airtable handover refused: ${conv.reason}`), { where: "airtableJobs.refused", extra: { recordId: rec.record_id, quoteNo: rec.quote_no } });
        results[rec.record_id] = `refused:${conv.reason}`;
        continue;
      }
      wctx ??= await loadBookedWriteContext(service);
      const job = { ...conv.job, import_note: [conv.job.import_note, ...conv.flags].join(" · ") };
      const r = await writeBookedJob(service, job, new SubstrateResolver([]), wctx, { importName: "airtable-handover", updateNote: true, hoursPending: true });
      // Provenance on the account: one note event per record, dedupe-keyed.
      await service.rpc("crm_log_event", {
        p_type: "note_added", p_account_id: r.accountId,
        p_payload: { body: `Imported from Airtable view ${rec.view.replace(/_/g, " ")} (quote ${rec.quote_no})${conv.flags.length ? ` — ${conv.flags.join("; ")}` : ""}`, origin: "airtable_handover" },
        p_source: "system", p_occurred_at: new Date().toISOString(), p_estimate_id: r.estimateId,
        p_work_order_id: r.workOrderId, p_invoice_id: null, p_property_id: r.propertyId, p_dedupe_key: `airtable_handover:${rec.record_id}:imported`,
      });
      results[rec.record_id] = r.status + (conv.flags.length ? `:${conv.flags.join(";")}` : "");
    } catch (e) {
      reportError(e, { where: "airtableJobs.record", extra: { recordId: rec.record_id, quoteNo: rec.quote_no } });
      results[rec.record_id] = `error:${e instanceof Error ? e.message : "exception"}`;
    }
  }
  return NextResponse.json({ received: true, results });
}
