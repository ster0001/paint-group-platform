import Link from "next/link";
import Outcomes from "./PackOutcomes";
import type { PackBundle } from "./pack-load";

/**
 * The pack — remote confirmation (estimator journey v2 §5, ⚑7).
 *
 * The plan's whole "quote it without looking at it" capability, and the one
 * screen it needs: everything a person requires to decide **fix it, ask, or
 * visit**, in the order they decide in, on one page.
 *
 * It is deliberately READ-ONLY. Fixing the price happens in the builder, where
 * prices have always been changed; asking happens in the thread, where the
 * customer is already talking to us; booking happens in the visit flow. A
 * fourth place to change money would be a fourth place for it to go wrong —
 * this page decides, it does not edit.
 *
 * C7b — the pack is a TAB on the estimate rather than a screen of its own.
 * It was `/quote/desk-check?id=…`: a second place to look at an estimate that
 * already has an editor. The reading view and the editing view are two views
 * of ONE record, and splitting them across routes is what made "open the desk
 * check" a different destination from "open the estimate".
 *
 * It renders a `PackBundle` the shell loaded ONCE (`pack-load.ts`) and shares
 * with the strip above the tabs, so the two can never show different figures.
 * Nothing about what it renders has changed: the pack is still re-derived
 * LIVE from the tree and compared against the copy frozen at send via
 * `packDrift` — a builder edit after sending must never be hidden.
 *
 * Staff-only is enforced by the shell that renders it (`app/quote/page.tsx`
 * already redirects a non-staff user), so the duplicate check is gone rather
 * than being asserted twice in two places that could drift.
 */
export default function PackPane({ bundle }: { bundle: PackBundle }) {
  if (bundle.kind === "holding") return <Holding line={bundle.line} href={bundle.href} />;
  const { estimate, pack, payload, recommended, request, assignee, drift, bandPct, range, docs, history } = bundle;
  const money = (c: number) => `$${(c / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-5 pb-24" data-testid="desk-check">
      <header>
        <Link href="/crm/today" className="text-xs text-gray-500 hover:underline">← Today</Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">{estimate.title?.trim() || "Desk check"}</h1>
        <p className="mt-1 text-sm text-gray-500">
          The customer confirmed this scope and asked us to fix the price. Everything they told us is below.
        </p>
      </header>

      {/* 0 — WHAT WE PROMISED. Before anything we have derived: the estimator
              needs to know what the customer was actually told, because that is
              the number they will hold us to. */}
      {request && (
        <section className="rounded-md border border-gray-200 bg-white p-3" data-testid="desk-check-promise">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">What we promised</div>
          <p className="mt-1 text-sm text-gray-800">
            {request.kind === "visit"
              ? "They asked for a person to come and look."
              : "They asked us to confirm it without a visit."}
            {" "}
            <span className="text-gray-500">
              {new Date(request.requested_at).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}
              {request.requested_by === "staff" ? " · entered by staff" : ""}
            </span>
          </p>
          <p className="mt-1 text-xs text-gray-600">
            {assignee?.full_name || assignee?.email
              ? <>Assigned to <b>{assignee.full_name || assignee.email}</b>.</>
              : "Not assigned to anyone — nobody covers this postcode, so it is here for whoever picks it up."}
            {request.suggested_action && request.suggested_action !== recommended && (
              <> {" "}The rules suggested <b>{request.suggested_action}</b> at the time; they say <b>{recommended}</b> now.</>
            )}
          </p>
          {/* C14: a brief-path estimate — the customer's brief, verbatim, above the (empty) tree. */}
          {(() => {
            const brief = (request.pack as { brief?: { segmentName?: string; briefKey?: string; what?: string[]; answers?: Record<string, string>; notes?: string; date?: string | null; photoSourceIds?: string[]; checklist?: Array<{ key: string; value: string | null }> } } | null)?.brief;
            if (!brief) return null;
            return (
              <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm" data-testid="pack-brief">
                <p className="font-semibold text-sky-900">Brief — {brief.segmentName ?? brief.briefKey}</p>
                <p className="mt-1 text-gray-800"><b>Needs painting:</b> {(brief.what ?? []).join(", ") || "—"}</p>
                {Object.entries(brief.answers ?? {}).map(([q, a]) => (
                  <p key={q} className="text-gray-800"><b>{q}</b> {a}</p>
                ))}
                {brief.date && <p className="text-gray-800"><b>Meeting date:</b> {brief.date}</p>}
                {brief.notes && <p className="mt-1 whitespace-pre-wrap text-gray-800"><b>Notes:</b> {brief.notes}</p>}
                <p className="mt-1 text-xs text-gray-600">
                  {(brief.photoSourceIds ?? []).length} photo{(brief.photoSourceIds ?? []).length === 1 ? "" : "s"} on the estimate
                  {(brief.checklist ?? []).length ? ` · checklist: ${(brief.checklist ?? []).map((c) => c.key + (c.value ? ` (${c.value})` : "")).join(", ")}` : ""}
                </p>
              </div>
            );
          })()}
          {drift && (
            <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="desk-check-drift">
              The price has moved {drift.direction} by {money(Math.abs(drift.deltaCents))} since they were told.
              They were shown <b>{money(request.pack?.totalCents ?? 0)}</b>; the tree now prices at <b>{money(pack.totalCents)}</b>.
              Fix the price they SAW, or tell them why it changed — never quote a number they have not seen.
            </p>
          )}
        </section>
      )}

      {/* 1 — can this be fixed from here at all? */}
      <section
        className={`rounded-md border p-3 ${pack.verdict.eligible ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}
        data-testid="desk-check-verdict"
      >
        <div className="text-sm font-medium text-gray-900">
          {pack.verdict.eligible
            ? `This one can be fixed without a visit — ${money(pack.totalCents)}`
            : `This one needs a visit — ${pack.verdict.reason}`}
        </div>
        <p className="mt-1 text-xs text-gray-700" data-testid="desk-check-band">
          The honest range is {money(range.loCents)} – {money(range.hiCents)} (±{bandPct}% at {payload.accuracyPct}% confidence).
          Fixing a price closes that band to one number, so read the open items first.
        </p>
        <p className="mt-1 text-xs text-gray-600">
          {pack.clean
            ? "Nothing is left open. Check it reads right, then fix the price and send it."
            : pack.open.length > 0
              ? `${pack.open.length} thing${pack.open.length === 1 ? "" : "s"} still open — settle ${pack.open.length === 1 ? "it" : "them"} or ask before you fix a price.`
              : "Read it through before you fix a price."}
        </p>
      </section>

      {history.length > 0 && (
        <Card title="This customer, before" testid="desk-check-history">
          <ul className="space-y-1.5 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex items-baseline justify-between gap-3">
                <Link href={`/quote?id=${h.id}`} className="text-gray-700 hover:underline">
                  {h.title?.trim() || "Untitled estimate"}
                </Link>
                <span className="shrink-0 text-xs text-gray-500">
                  {h.status}{h.total_cents ? ` · ${money(h.total_cents)}` : ""}
                  {" · "}{new Date(h.created_at).toLocaleDateString("en-AU", { dateStyle: "medium" })}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            What we quoted this account before. A second quote on an address should start from what the first one learned.
          </p>
        </Card>
      )}

      {/* 6 — what is still open, first: it decides everything below it. */}
      {pack.open.length > 0 && (
        <Card title="Still open" testid="desk-check-open">
          <ul className="space-y-1.5 text-sm">
            {pack.open.map((d, i) => (
              <li key={i} className="text-gray-700">
                <span className="font-medium">{d.room}</span> — {d.what}
                <span className="block text-xs text-gray-500">{d.needs}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 3 — what did they tell us is wrong? */}
      <Card
        title={`Flagged spots${pack.spotCount > 0 ? ` — ${pack.spotCount}` : ""}`}
        testid="desk-check-spots"
        subtitle={pack.spotsToPrice > 0 ? `${pack.spotsToPrice} still to price` : undefined}
      >
        {pack.spotCount === 0 ? (
          <p className="text-sm text-gray-500">They didn&rsquo;t point anything out.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {pack.rooms.flatMap((r) => r.spots.map((s) => (
              <li key={s.surfaceId} className="flex flex-wrap items-baseline gap-x-2 text-gray-700">
                <span className="font-medium">{r.name}</span>
                <span>{s.label}</span>
                <span className="text-xs text-gray-500">
                  {s.prepHr > 0 ? `${s.prepHr}h allowed` : "not priced — your call"}
                  {!s.fromCustomer && " · read from a photo"}
                </span>
                {s.crewNote && <span className="w-full text-xs text-gray-500">{s.crewNote}</span>}
              </li>
            )))}
          </ul>
        )}
        {docs.photos.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="desk-check-photos">
            {docs.photos.map((p) => (
              <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
                {/* Signed storage URLs, not a known host — next/image would need
                    every Supabase project added to remotePatterns, and these are
                    thumbnails on a staff-only page. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.label} className="h-24 w-24 rounded border border-gray-200 object-cover" />
              </a>
            ))}
          </div>
        )}
      </Card>

      {/* 4 — what have we assumed on their behalf? */}
      <Card title="What we've allowed for" testid="desk-check-systems">
        {pack.systems.length === 0 ? (
          <p className="text-sm text-gray-500">No interior systems on this job.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {pack.systems.map((l) => (
              <li key={l.group}>
                <span className="font-medium text-gray-900">{l.title}</span>
                <span className="text-gray-500"> · {l.coats} coat{l.coats === 1 ? "" : "s"}{l.undercoat ? " (one an undercoat)" : ""}</span>
                <span className="block text-xs text-gray-600">{l.sentence}</span>
                {l.review && <span className="block text-xs text-amber-700">Needs your eye: {l.crewNote}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 5 — what will make it slower? */}
      <Card title="Site and access" testid="desk-check-access">
        {pack.access.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing that changes our setup.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            {pack.access.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        )}
      </Card>

      {/* 2 — what did they actually confirm? Last, because it is the longest. */}
      <Card title={`The rooms — ${pack.rooms.length}`} testid="desk-check-rooms">
        <ul className="space-y-2 text-sm">
          {pack.rooms.map((r) => (
            <li key={r.areaId}>
              <span className="font-medium text-gray-900">{r.name}</span>
              {r.m2 != null && <span className="text-gray-500"> · {r.m2} m²</span>}
              {r.condition && <span className="text-amber-700"> · {r.condition}</span>}
              <span className="block text-xs text-gray-600">{r.painting.join(" · ") || "nothing ticked"}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Outcomes estimateId={estimate.id} accountId={estimate.account_id} recommended={recommended} eligible={pack.verdict.eligible} />
    </main>
  );
}

function Card({ title, subtitle, testid, children }: {
  title: string; subtitle?: string; testid: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-gray-200 bg-white p-3" data-testid={testid}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-gray-900">{title}</h2>
        {subtitle && <span className="text-xs text-amber-700">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function Holding({ line, href }: { line: string; href?: string }) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <p className="text-sm text-gray-700">{line}</p>
      {href && <Link href={href} className="mt-3 inline-block text-sm text-blue-700 hover:underline">Open the builder →</Link>}
    </main>
  );
}
