import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireStaff } from "@/lib/supabase/guards";
import { melbourneParts } from "@/lib/time/businessHours";
import { answeredWords } from "@/lib/visits/answeredSummary";
import { loadAnsweredSummary, loadRequest, staffOfferableSlots, type StaffSlotDay } from "@/lib/visits/requests";
import OfferTime from "./OfferTime";

/**
 * /crm/visit-requests/[id] — staff answer a request (addendum A §4.4): the
 * request as the customer made it, and every free slot of every estimator
 * over the booking window (zone lists set aside, far edges kept). Offering a
 * time books it for the customer and tells them; no code is needed.
 */
export const dynamic = "force-dynamic";

const DAY3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ZONE_WORDS: Record<string, string> = { zone_1: "Zone 1", zone_2: "Zone 2", zone_3: "Zone 3", zone_4: "Zone 4", zone_5: "Zone 5", pre_arranged: "Pre-arranged area", out_of_area: "Out of area", unmapped: "Suburb not in the list" };
const KIND_WORDS = { time: "Asked for a visit time", visit: "Asked for a site visit before the price range", call: "Asked for a call to finalise by phone" };

/** Outside the component so the render stays pure (react-compiler lint). */
function isOverdue(dueAt: string, answeredAt: string | null): boolean {
  return !answeredAt && new Date(dueAt).getTime() < new Date().getTime();
}

function when(iso: string): string {
  const p = melbourneParts(new Date(iso));
  return `${DAY3[p.weekday]} ${p.d}/${p.m} ${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

export default async function VisitRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return <main className="p-6 text-sm">Staff only.</main>;
  const svc = createServiceClient();
  if (!svc) return <main className="p-6 text-sm">The request can&rsquo;t be read just now.</main>;
  let req: Awaited<ReturnType<typeof loadRequest>> = null;
  let loadError: string | null = null;
  try { req = await loadRequest(supabase, id); } catch (e) { loadError = e instanceof Error ? e.message : "read failed"; }
  if (loadError) return <main className="p-6 text-sm text-red-700" data-testid="request-load-error">The request could not be loaded: {loadError}</main>;
  if (!req) return <main className="p-6 text-sm">No such request.</main>;
  let days: StaffSlotDay[] = [];
  let slotsError: string | null = null;
  if (!req.answered_at) {
    try { days = await staffOfferableSlots(svc, req); } catch (e) { slotsError = e instanceof Error ? e.message : "read failed"; }
  }
  // The answered line is the one confirmation staff see: the action revalidates
  // this page, so it replaces <OfferTime> the moment the answer is saved.
  let booked: string[] = [];
  let bookedError: string | null = null;
  if (req.answered_at) {
    try { const f = await loadAnsweredSummary(svc, req); booked = f ? answeredWords(f) : []; } catch (e) { bookedError = e instanceof Error ? e.message : "read failed"; }
  }
  const overdue = isOverdue(req.due_at, req.answered_at);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6" data-testid="visit-request">
      <p className="text-xs text-gray-500"><Link href="/crm/today" className="underline">Today</Link> · Visit request</p>
      <h1 className="mt-1 text-xl font-semibold text-gray-900">{req.name}</h1>
      <p className="text-sm text-gray-700">{KIND_WORDS[req.kind]}</p>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-gray-500">Property</dt><dd>{req.address || [req.suburb, req.postcode].filter(Boolean).join(" ") || "—"} <span className="text-xs text-gray-500">({ZONE_WORDS[req.zone] ?? req.zone})</span></dd></div>
        <div><dt className="text-xs text-gray-500">Reach them</dt><dd>{[req.mobile, req.email].filter(Boolean).join(" · ") || "—"}</dd></div>
        {req.kind === "time" && (req.preferred_days.length > 0 || req.time_of_day) && (
          <div><dt className="text-xs text-gray-500">Days that suit</dt><dd data-testid="request-prefs">{req.preferred_days.map((d) => DAY3[d]).join(", ")}{req.time_of_day ? ` · ${req.time_of_day}` : ""}</dd></div>
        )}
        {req.note && <div className="sm:col-span-2"><dt className="text-xs text-gray-500">Their note</dt><dd>{req.note}</dd></div>}
        <div><dt className="text-xs text-gray-500">Made</dt><dd>{when(req.created_at)}</dd></div>
        <div><dt className="text-xs text-gray-500">Reply due</dt><dd className={overdue ? "font-medium text-red-700" : ""} data-testid="request-due">{when(req.due_at)}{overdue ? " — overdue" : ""}</dd></div>
        {req.estimate_id && <div><dt className="text-xs text-gray-500">Estimate</dt><dd><Link href={`/quote?id=${req.estimate_id}`} className="underline">Open the estimate</Link></dd></div>}
        {req.account_id && <div><dt className="text-xs text-gray-500">Customer</dt><dd><Link href={`/crm/customers/${req.account_id}`} className="underline">Open the record</Link></dd></div>}
      </dl>

      {req.answered_at ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="request-answered">
          <p>Answered {when(req.answered_at)}{req.answer ? ` — ${req.answer}` : ""}.</p>
          {booked.map((l) => <p key={l}>{l}</p>)}
          {bookedError && <p className="text-red-700" data-testid="request-answered-error">The booking details could not be loaded: {bookedError}</p>}
        </div>
      ) : (
        <OfferTime requestId={req.id} kind={req.kind} days={days} slotsError={slotsError} />
      )}
    </main>
  );
}
