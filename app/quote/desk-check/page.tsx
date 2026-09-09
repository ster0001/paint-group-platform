import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadScopeRules } from "@/lib/extract/scope-cache";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { editorPayload, type WizardDeferred } from "@/lib/wizard/view";
import { policyFromSettings, settingValue } from "@/lib/wizard/policy";
import { wizardStateSchema } from "@/lib/wizard/state";
import { PAINT_SYSTEMS_KEY, paintSystemsFrom } from "@/lib/pricing/systems";
import { deskCheckPack, recommendedOutcome } from "@/lib/wizard/desk-check";
import { estimateDocuments } from "@/lib/wizard/documents";
import Outcomes from "./Outcomes";

/**
 * /quote/desk-check?id= — remote confirmation (estimator journey v2 §5, ⚑7).
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
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Desk check · Paint Group", robots: { index: false, follow: false } };

export default async function DeskCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") {
    return <main className="mx-auto max-w-2xl p-6"><h1 className="text-xl font-semibold">Staff only</h1></main>;
  }
  if (!id) return <Holding line="That link is missing its estimate." />;

  const { data: estimate } = await supabase
    .from("estimates")
    // No total column: the pack prices LIVE from the tree below, so a stored
    // total could only disagree with what the estimator is looking at.
    .select("id, title, status, account_id, builder_state")
    .eq("id", id)
    .maybeSingle();
  if (!estimate) return <Holding line="We couldn't find that estimate." />;

  const state = (estimate.builder_state ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(state.blocks) ? (state.blocks as Array<Record<string, unknown>>) : [];
  const deferred: WizardDeferred[] = Array.isArray(state.aiDeferred) ? (state.aiDeferred as WizardDeferred[]) : [];
  const snap = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);

  const [rules, ctx, docs] = await Promise.all([
    loadScopeRules(supabase),
    loadPricingContext(supabase),
    estimateDocuments(supabase, id),
  ]);
  const payload = editorPayload(blocks, ctx, adjustmentsFrom(state), deferred);

  if (!snap.success) {
    return <Holding line="This estimate wasn't built in the wizard, so there's nothing to desk-check. Open it in the builder instead." href={`/quote?id=${id}`} />;
  }

  const pack = deskCheckPack(blocks, snap.data, {
    totalCents: payload.totals.totalCents,
    rules,
    deferred,
    policy: policyFromSettings(settingValue(ctx.settings, "wizard_policy")),
    systems: paintSystemsFrom(settingValue(ctx.settings, PAINT_SYSTEMS_KEY)),
  });
  const recommended = recommendedOutcome(pack);
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
        <p className="mt-1 text-xs text-gray-600">
          {pack.clean
            ? "Nothing is left open. Check it reads right, then fix the price and send it."
            : pack.open.length > 0
              ? `${pack.open.length} thing${pack.open.length === 1 ? "" : "s"} still open — settle ${pack.open.length === 1 ? "it" : "them"} or ask before you fix a price.`
              : "Read it through before you fix a price."}
        </p>
      </section>

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

      <Outcomes estimateId={id} accountId={estimate.account_id} recommended={recommended} eligible={pack.verdict.eligible} />
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
