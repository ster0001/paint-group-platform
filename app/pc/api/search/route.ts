import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { STAGE_LANES, type WoStage } from "@/lib/workorder/stages";
import { formatEstimateNumber, parseEstimateNumber } from "@/lib/estimate/number";
import type { PcSearchHit } from "../../PcSearch";

/**
 * Tom, 1 Oct 2026: "a search bar in the PC command on all pages to search for
 * projects". A project is a work order: matched by its reference, its job
 * title or address (the issued snapshot), the customer's name, the estimate's
 * title, or a typed estimate number. Two bounded reads through the staff
 * session (RLS on both tables) — one on the work order's own columns, one on
 * the estimate's — merged and deduped, open jobs first.
 */
export const dynamic = "force-dynamic";

type WoRow = {
  id: string; wo_ref: string; stage: WoStage; start_date: string | null;
  wo_snapshot: { jobTitle?: string; jobAddress?: string } | null;
  contractors: { company_name: string | null; profiles: { name: string | null } | null } | null;
  estimates: { number: number | null; title: string | null; contact_first: string | null; contact_last: string | null; job_street: string | null; job_city: string | null } | null;
};
type EstRow = {
  id: string; number: number | null; title: string | null; contact_first: string | null; contact_last: string | null;
  job_street: string | null; job_city: string | null;
  work_orders: Array<Omit<WoRow, "estimates">> | Omit<WoRow, "estimates"> | null;
};

const EST_FIELDS = "number, title, contact_first:builder_state->contact->>first_name, contact_last:builder_state->contact->>last_name, job_street:builder_state->jobAddress->>address, job_city:builder_state->jobAddress->>city";
const WO_FIELDS = "id, wo_ref, stage, start_date, wo_snapshot, contractors(company_name, profiles(name))";
const LIMIT = 10;

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ hits: [] });
  // `%`/`_` would be wildcards; `,` and `(` would break the or() filter list.
  const needle = q.toLowerCase().replace(/[%_,()]/g, "");
  if (!needle) return NextResponse.json({ hits: [] });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "no" }, { status: 401 });
  const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profileError) return NextResponse.json({ error: "Search isn't available just now." }, { status: 503 });
  if (profile?.role !== "staff") return NextResponse.json({ error: "no" }, { status: 403 });

  const like = `%${needle}%`;
  const n = parseEstimateNumber(q);
  const [byWo, byEstimate] = await Promise.all([
    supabase.from("work_orders")
      .select(`${WO_FIELDS}, estimates(${EST_FIELDS})`)
      .or(`wo_ref.ilike.${like},wo_snapshot->>jobTitle.ilike.${like},wo_snapshot->>jobAddress.ilike.${like}`)
      .limit(LIMIT),
    (() => {
      const base = supabase.from("estimates").select(`id, ${EST_FIELDS}, work_orders!inner(${WO_FIELDS})`);
      return n != null
        ? base.eq("number", n).limit(LIMIT)
        : base.or(`title.ilike.${like},builder_state->contact->>first_name.ilike.${like},builder_state->contact->>last_name.ilike.${like},builder_state->jobAddress->>address.ilike.${like},builder_state->jobAddress->>city.ilike.${like}`).limit(LIMIT);
    })(),
  ]);
  if (byWo.error || byEstimate.error) {
    return NextResponse.json({ error: (byWo.error ?? byEstimate.error)?.message ?? "Search failed." }, { status: 503 });
  }

  const rows = new Map<string, WoRow>();
  for (const w of (byWo.data ?? []) as unknown as WoRow[]) rows.set(w.id, w);
  for (const e of (byEstimate.data ?? []) as unknown as EstRow[]) {
    const wos = Array.isArray(e.work_orders) ? e.work_orders : e.work_orders ? [e.work_orders] : [];
    for (const w of wos) {
      if (rows.has(w.id)) continue;
      rows.set(w.id, { ...w, estimates: { number: e.number, title: e.title, contact_first: e.contact_first, contact_last: e.contact_last, job_street: e.job_street, job_city: e.job_city } });
    }
  }

  const hits: PcSearchHit[] = [...rows.values()]
    // Open jobs before closed ones; within that, the nearest start date first.
    .sort((a, b) => Number(a.stage === "closed") - Number(b.stage === "closed") || (a.start_date ?? "9").localeCompare(b.start_date ?? "9"))
    .slice(0, LIMIT)
    .map((w) => {
      const est = w.estimates;
      const customer = [est?.contact_first, est?.contact_last].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
      const address = w.wo_snapshot?.jobAddress || [est?.job_street, est?.job_city].filter(Boolean).join(", ");
      const painter = (w.contractors?.profiles?.name || w.contractors?.company_name || "").trim();
      const number = est?.number != null ? `#${formatEstimateNumber(est.number)}` : "";
      return {
        id: w.id,
        title: w.wo_snapshot?.jobTitle || est?.title || w.wo_ref,
        line: [w.wo_ref, number, customer, address, painter].filter(Boolean).join(" · "),
        stage: STAGE_LANES[w.stage]?.title ?? w.stage,
        closed: w.stage === "closed",
      };
    });
  return NextResponse.json({ hits });
}
