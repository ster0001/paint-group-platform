import { createClient } from "@/lib/supabase/server";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";
import { suburbOnly } from "@/lib/scheduling/offers";

// Server-only: reads the signed-in contractor's issued work orders. RLS already
// restricts this to their own rows (see 20260825000000), but every query filters
// explicitly too so the intent is readable without cross-referencing the policy.

export type ContractorJob = {
  id: string;
  woRef: string;
  status: string;
  startDate: string | null;
  issuedAt: string | null;
  viewedAt: string | null;
  paymentCents: number | null;
  /** True once the contractor has committed — full address and contact shown. */
  committed: boolean;
  /** The contractor-safe document frozen at issue. Null if somehow unset. */
  doc: WorkOrderDoc | null;
};

const JOB_COLUMNS =
  "id, wo_ref, status, start_date, issued_at, viewed_at, contractor_payment_cents, wo_snapshot";

type Row = {
  id: string;
  wo_ref: string;
  status: string;
  start_date: string | null;
  issued_at: string | null;
  viewed_at: string | null;
  contractor_payment_cents: number | null;
  wo_snapshot: unknown;
};

function toJob(r: Row, committed: boolean): ContractorJob {
  const snap = r.wo_snapshot as WorkOrderDoc | null;
  // Only trust a v1 snapshot; anything else is treated as missing rather than
  // rendered half-formed.
  const doc = snap && (snap as Partial<WorkOrderDoc>).version === 1 ? snap : null;

  // Live status and start date win over the frozen copy — staff can move a
  // start date after issuing without re-issuing the whole document.
  let out = doc ? { ...doc, status: r.status ?? doc.status, startDate: r.start_date ?? doc.startDate } : null;

  // PRIVACY GATE (workflow spec): suburb only while an offer is still open;
  // full address and customer contact once the contractor has committed.
  // Redacted HERE, on the server, so the real address is never sent to the
  // browser at all — not merely hidden in the markup.
  if (out && !committed) {
    out = {
      ...out,
      jobAddress: suburbOnly(out.jobAddress),
      contactFirstName: "",
      contactPhone: "",
    };
  }

  return {
    id: r.id,
    woRef: r.wo_ref,
    status: r.status,
    startDate: r.start_date,
    issuedAt: r.issued_at,
    viewedAt: r.viewed_at,
    paymentCents: r.contractor_payment_cents,
    committed,
    doc: out,
  };
}

/**
 * Which of these work orders the contractor has actually committed to.
 *
 * Committed means an accepted offer exists, OR no offer was ever made — in the
 * second case staff assigned the job directly, which is itself the commitment,
 * and there is no open offer for the privacy rule to protect. Anything with a
 * live, declined or expired offer stays redacted.
 */
async function committedSet(workOrderIds: string[]): Promise<Set<string>> {
  if (workOrderIds.length === 0) return new Set();
  const supabase = await createClient();
  const { data } = await supabase
    .from("booking_offers")
    .select("work_order_id, state")
    .in("work_order_id", workOrderIds);

  const rows = (data as { work_order_id: string; state: string }[] | null) ?? [];
  const hasAnyOffer = new Set(rows.map((r) => r.work_order_id));
  const accepted = new Set(rows.filter((r) => r.state === "accepted").map((r) => r.work_order_id));
  return new Set(workOrderIds.filter((id) => accepted.has(id) || !hasAnyOffer.has(id)));
}

export async function listContractorJobs(contractorId: string): Promise<ContractorJob[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("work_orders")
    .select(JOB_COLUMNS)
    .eq("contractor_id", contractorId)
    .not("issued_at", "is", null)
    .order("start_date", { ascending: true, nullsFirst: false });
  const rows = (data as Row[] | null) ?? [];
  const committed = await committedSet(rows.map((r) => r.id));
  return rows.map((r) => toJob(r, committed.has(r.id)));
}

export async function getContractorJob(contractorId: string, id: string): Promise<ContractorJob | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("work_orders")
    .select(JOB_COLUMNS)
    .eq("contractor_id", contractorId)
    .eq("id", id)
    .not("issued_at", "is", null)
    .maybeSingle();
  if (!data) return null;
  const row = data as Row;
  const committed = await committedSet([row.id]);
  return toJob(row, committed.has(row.id));
}

/** Current work first, then what's coming, then what's done. */
export function groupJobs(jobs: ContractorJob[]) {
  return {
    current: jobs.filter((j) => j.status === "in_progress"),
    upcoming: jobs.filter((j) => j.status === "issued"),
    previous: jobs.filter((j) => j.status === "complete"),
  };
}

export const JOB_STATUS_CHIP: Record<string, { cls: string; label: string }> = {
  issued: { cls: "grn", label: "Booked" },
  in_progress: { cls: "cyn", label: "In progress" },
  complete: { cls: "gry", label: "Completed" },
};

export const money = (cents: number | null | undefined) =>
  cents == null ? "—" : "$" + (cents / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });

export const shortDate = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-AU", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "Australia/Melbourne",
      })
        .format(new Date(iso + "T00:00:00"))
        .toUpperCase()
    : "TBC";
