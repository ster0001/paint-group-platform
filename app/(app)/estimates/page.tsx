import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { maybeSweep } from "@/lib/wizard/sweep";
import NewEstimateButton, { type TemplateMeta } from "./NewEstimateButton";
import EstimatesTable from "./EstimatesTable";
import AssistantFab from "@/app/quote/AssistantFab";
import { LIST_FILTERS as FILTERS, filterQuery, SOURCE_FILTERS, SOURCE_LABEL, sourceFilterOf, sourceQuery } from "@/lib/estimate/displayStatus";
import { buildListRow, hasWizardData, LIST_SELECT, type RawListRow } from "@/lib/estimate/listRows";
import { loopProgress } from "@/lib/wizard/confirm-state";
import { bandsFromSettings } from "@/lib/wizard/policy";
import WizardSessionsTable from "./WizardSessionsTable";
import WaitingTable from "./WaitingTable";
import { getWorkQueue } from "@/app/crm/queue";
import { estimatesPageItems } from "@/lib/crm/work-queue";
import { journeyFromRow, WIZARD_BUCKETS, WIZARD_SESSION_COLUMNS, type WizardBucket, type WizardJourney } from "@/lib/wizard/journey";

export const dynamic = "force-dynamic";

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; bucket?: string; source?: string; mode?: string; open?: string; built?: string }>;
}) {
  const { status, bucket, source, mode, open, built } = await searchParams;
  // C7b: the source filter on the status tabs. `built`, not `source` — the
  // Wizard tab already uses `source` for a session's entry_source.
  const sourceFilter = sourceFilterOf(built);
  const supabase = await createClient();

  const { data: tplRow0 } = await supabase.from("settings").select("value").eq("key", "estimate_templates").maybeSingle();
  const templates0: TemplateMeta[] = (Array.isArray(tplRow0?.value) ? (tplRow0!.value as { id: string; name: string }[]) : [])
    .map((t) => ({ id: t.id, name: t.name }));
  const tabs = (
    <div className="mt-4 flex flex-wrap gap-1 border-b border-gray-200">
      {FILTERS.map((f) => {
        const active = (status ?? "waiting") === f;
        return (
          <Link
            key={f}
            href={f === "waiting" ? "/estimates" : `/estimates?status=${f}${sourceFilter !== "all" ? `&built=${sourceFilter}` : ""}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize ${
              active ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
            data-testid={`estimates-tab-${f}`}
          >
            {f}
          </Link>
        );
      })}
    </div>
  );

  /**
   * C7b — "Waiting on you", first and default.
   *
   * `getWorkQueue()` is the SAME call CRM Today makes (`app/crm/today/page.tsx`),
   * through the one evaluator in `lib/crm/work-queue.ts`. This tab does not
   * query, sort, bucket or count anything itself — it filters the queue to the
   * subjects this page is about and renders what comes back. That is the whole
   * ruling: a confirmation waiting on an estimator is an attention item like
   * any other, and two answers to "what needs attention?" is the bug class
   * phase 0 spent itself removing.
   */
  if ((status ?? "waiting") === "waiting") {
    const queue = await getWorkQueue();
    const mine = estimatesPageItems(queue.items);
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Estimates</h1>
          <NewEstimateButton templates={templates0} />
        </div>
        {tabs}
        <WaitingTable items={mine} now={new Date()} />
        <AssistantFab estimateId={null} />
      </div>
    );
  }

  // Buckets brief §5 — the Wizard tab: open sessions (no estimate yet), with
  // bucket / source / mode filters; Ready sorts oldest request first.
  if (status === "wizard") {
    await maybeSweep(createServiceClient());
    const bucketOk = (WIZARD_BUCKETS as readonly string[]).includes(bucket ?? "") ? (bucket as WizardBucket) : null;
    let q = supabase.from("wizard_drafts").select(WIZARD_SESSION_COLUMNS).is("converted_at", null)
      .order("last_seen_at", { ascending: false }).limit(500);
    if (bucketOk) q = q.eq("bucket", bucketOk);
    if (source) q = q.eq("entry_source", source);
    if (mode === "home" || mode === "business") q = q.eq("mode", mode);
    const { data: rows } = await q;
    const order: Record<string, number> = { ready_call: 0, ready_visit: 0, needs_help: 1, priced_no_request: 2, online_now: 3, dropped: 4 };
    const sessions: WizardJourney[] = ((rows ?? []) as unknown as Record<string, unknown>[]).map(journeyFromRow)
      .sort((a, b) => (order[a.bucket] - order[b.bucket]) || (a.bucket.startsWith("ready")
        ? (a.outcomeAt ?? "").localeCompare(b.outcomeAt ?? "")
        : (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "")));
    const sources = [...new Set(sessions.map((s) => s.entrySource).filter((x): x is string => Boolean(x)))];
    const chip = (label: string, href: string, on: boolean) => (
      <Link key={href} href={href} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{label}</Link>
    );
    const base = (b?: string, s?: string, m?: string) => {
      const p = new URLSearchParams({ status: "wizard" });
      if (b) p.set("bucket", b); if (s) p.set("source", s); if (m) p.set("mode", m);
      return `/estimates?${p.toString()}`;
    };
    return (
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Estimates</h1>
          <NewEstimateButton templates={templates0} />
        </div>
        {tabs}
        <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="wizard-filters">
          <span className="mr-1 text-xs uppercase tracking-wide text-gray-400">Bucket</span>
          {chip("All", base(undefined, source, mode), !bucketOk)}
          {chip("Ready · call", base("ready_call", source, mode), bucketOk === "ready_call")}
          {chip("Ready · visit", base("ready_visit", source, mode), bucketOk === "ready_visit")}
          {chip("Needs help", base("needs_help", source, mode), bucketOk === "needs_help")}
          {chip("Dropped", base("dropped", source, mode), bucketOk === "dropped")}
          {chip("Priced · no request", base("priced_no_request", source, mode), bucketOk === "priced_no_request")}
          {chip("Online now", base("online_now", source, mode), bucketOk === "online_now")}
          <span className="ml-3 mr-1 text-xs uppercase tracking-wide text-gray-400">Mode</span>
          {chip("Home", base(bucket, source, mode === "home" ? undefined : "home"), mode === "home")}
          {chip("Business", base(bucket, source, mode === "business" ? undefined : "business"), mode === "business")}
          {sources.length > 0 && <span className="ml-3 mr-1 text-xs uppercase tracking-wide text-gray-400">Source</span>}
          {sources.map((s) => chip(s, base(bucket, source === s ? undefined : s, mode), source === s))}
        </div>
        <WizardSessionsTable sessions={sessions} openId={open ?? null} />
        <AssistantFab estimateId={null} />
      </div>
    );
  }

  // "Viewed" is sent + the customer's first open (viewed_at) — one DB status,
  // two tabs (Tom, 4 Sep). The row shows "viewed" the same way.
  const fq = filterQuery(status);
  /**
   * C7b — the list reads what its rows need to DERIVE their status (brief
   * 2.2): the latest confirmation request, the customer's opens, the work
   * order, the photo count and one scalar out of the wizard state. All via
   * `LIST_SELECT`'s embeds on existing foreign keys — one round trip, and no
   * stored status string anywhere.
   */
  let query = supabase
    .from("estimates")
    .select(LIST_SELECT)
    .order("created_at", { ascending: false });
  if (fq.status) query = query.eq("status", fq.status);
  if (fq.viewed === true) query = query.not("viewed_at", "is", null);
  if (fq.viewed === false) query = query.is("viewed_at", null);
  const sq = sourceQuery(sourceFilter);
  if (sq && "eq" in sq) query = query.eq("source", sq.eq);
  if (sq && "or" in sq) query = query.or(sq.or);
  const { data: rawRows, error: listError } = await query;
  const estimates = (rawRows ?? []) as unknown as RawListRow[];

  // Buckets brief §5: the wizard session behind each listed estimate. Read
  // the converted sessions newest-first rather than `in(ids)` — a thousand
  // uuids on the query string is longer than the request line allows.
  const { data: sessionRows } = await supabase.from("wizard_drafts").select(WIZARD_SESSION_COLUMNS)
    .not("estimate_id", "is", null).order("last_seen_at", { ascending: false }).limit(1000);
  const sessionOf = new Map<string, WizardJourney>();
  for (const r of ((sessionRows ?? []) as unknown as Record<string, unknown>[])) {
    const j = journeyFromRow(r);
    if (j.estimateId && !sessionOf.has(j.estimateId)) sessionOf.set(j.estimateId, j);
  }
  /**
   * "9 of 9": the confirm loop's own `customer.confirmed` flags live on the
   * blocks, and the blocks are the heavy part of `builder_state`. They are
   * read ONLY for the wizard rows on this page that can show a count (an
   * open or answered request, or a priced session with no request), newest
   * first, and only for the first 150 of those — a row past the cap simply
   * shows its line without the count (`loop: null` never prints "0 of 0").
   * The cap follows the list itself, which has no pagination yet (parking lot).
   */
  const LOOP_READ_CAP = 150;
  const wantsLoop = estimates.filter((e) => hasWizardData(e) && (
    (e.requests ?? []).some((r) => r.status === "requested" || r.status === "question_asked")
    || sessionOf.get(e.id)?.bucket === "priced_no_request"
  )).slice(0, LOOP_READ_CAP);
  const [{ data: blockRows }, { data: bandsRow }] = await Promise.all([
    wantsLoop.length > 0
      ? supabase.from("estimates").select("id, builder_state").in("id", wantsLoop.map((e) => e.id))
      : Promise.resolve({ data: [] as Array<{ id: string; builder_state: unknown }> }),
    supabase.from("settings").select("value").eq("key", "wizard_bands").maybeSingle(),
  ]);
  const loopOf = new Map((blockRows ?? []).map((r) => [r.id as string, loopProgress(r.builder_state)]));
  const bands = bandsFromSettings(bandsRow?.value);
  const now = new Date();
  const rows = estimates.map((e) => buildListRow(e, { wizard: sessionOf.get(e.id) ?? null, loop: loopOf.get(e.id) ?? null, bands, now }));

  // C7b (brief 2.5): the source filter, a segmented control under the tabs.
  const sourceControl = (
    <div className="mt-3 inline-flex rounded-md border border-gray-300 text-xs" role="group" aria-label="Source" data-testid="source-filter">
      {SOURCE_FILTERS.map((f) => {
        const p = new URLSearchParams();
        if (status && status !== "all") p.set("status", status);
        if (f !== "all") p.set("built", f);
        const qs = p.toString();
        const on = sourceFilter === f;
        return (
          <Link
            key={f}
            href={`/estimates${qs ? `?${qs}` : "?status=all"}`}
            data-testid={`source-${f}`}
            aria-pressed={on}
            className={`px-2.5 py-1 first:rounded-l-md last:rounded-r-md ${on ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"}`}
          >
            {SOURCE_LABEL[f]}
          </Link>
        );
      })}
    </div>
  );

  const templates = templates0;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Estimates</h1>
        <NewEstimateButton templates={templates} />
      </div>

      {tabs}
      {sourceControl}

      {listError ? (
        // A failed read is not "no estimates" — say what happened (6 Sep: the
        // list came back empty on the test project under load and read as none).
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800" data-testid="estimates-error">
          The estimates list could not be loaded: {listError.message}. Reload the page.
        </div>
      ) : rows.length > 0 ? (
        <EstimatesTable estimates={rows} />
      ) : (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
          No estimates{status && status !== "all" ? ` marked “${status}”` : ""}{sourceFilter === "customers" ? " from customers" : sourceFilter === "inhouse" ? " built in-house" : ""} yet.{" "}
          <Link href="/quote" className="font-medium text-gray-700 hover:underline">
            Create one →
          </Link>
        </div>
      )}
      <AssistantFab estimateId={null} />
    </div>
  );
}
