import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { customerOwnsDraft, getWizardActor } from "@/lib/supabase/guards";
import { loadCustomerScope, type EstimateRow } from "@/lib/wizard/customer-scope";
import Wordmark from "@/app/wizard/Wordmark";
import Finish from "./Finish";
import "../../wizard/wizard.css";

/**
 * /estimate/finish?id=… — prototype screen 10, the finish line (§3, §9.5).
 *
 * Loads exactly what the scope editor loads, because it must show the SAME
 * numbers and the same answers: a second loader would be a second opinion
 * about money, and the two would disagree the first time either changed.
 */
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your estimate · Paint Group",
  robots: { index: false, follow: false },
};

function Holding({ line, logoUrl }: { line: string; logoUrl?: string | null }) {
  return (
    <div className="wz">
      <header className="wz-top"><Wordmark logoUrl={logoUrl ?? null} /></header>
      <div className="wz-wrap" style={{ textAlign: "center", paddingTop: 80 }}><h1>{line}</h1></div>
    </div>
  );
}

export default async function FinishPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (!id) return <Holding line="That link is missing its estimate." />;

  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return <Holding line="Open your estimate from the link we sent you." />;
  const db = actor.kind === "customer" ? createServiceClient() : supabase;
  if (!db) return <Holding line="Your estimate isn't available just now — please try again shortly." />;

  const { data: estimate } = await db
    .from("estimates")
    .select("id, status, source, created_by, requires_site_check, builder_state, account_id")
    .eq("id", id).maybeSingle();
  const own = !estimate ? false : actor.kind !== "customer" || await customerOwnsDraft(db, actor, estimate as EstimateRow);
  if (!estimate || !own) return <Holding line="We couldn't find that estimate." />;

  const bundle = await loadCustomerScope(db, estimate as EstimateRow);

  /**
   * AUDIT 9.4 — an exterior-only job had no finish line.
   *
   * This returned "Open your estimate to finish it off." for every non-rooms
   * bundle, which is screen 10 dead-ending for every exterior customer: they
   * walked the whole flow and the last screen sent them back to the one before
   * it. The comment said so outright.
   *
   * The sides bundle has everything the summary needs — the range, the sides
   * and their progress, the geometry, the doors and windows, the condition
   * answers — so it renders the SAME `Finish` component off the SAME
   * `summaryRows`. A second summary would be a second opinion about the job.
   *
   * An exterior job never self-serves (an estimator signs every one off), so
   * `finishOptions` offers "send to your estimator" and "book a visit" rather
   * than a price to accept. That is the policy already; this screen just stops
   * hiding it.
   */
  if (bundle.kind === "sides") {
    const sides = bundle.initialSides;
    return (
      <div className="wz">
        <header className="wz-top"><Wordmark logoUrl={bundle.logoUrl} /></header>
        <Finish
          estimateId={bundle.estimateId}
          companyPhone={bundle.companyPhone}
          phoneHours={bundle.phoneHours}
          customerPhone={bundle.customerPhone}
          kind="sides"
          fixedPriceCents={Math.round((bundle.initial.rangeLoCents + bundle.initial.rangeHiCents) / 2)}
          input={{
            payload: bundle.initial,
            // An exterior job carries no derived paint systems and no interior
            // access answers (plan §4.4) — the rows simply do not render.
            systems: [],
            // SiteAccess is all-optional and every field of it is an INTERIOR
            // question (furniture, stairwell, lift). An exterior job answers
            // its access on the condition screen instead, which is the
            // `sides.access` field below — so this stays empty and the
            // interior access row simply does not render.
            access: {},
            extras: sides.sweepItems.filter((i) => i.on).map((i) => i.label),
            // `SideView` carries no flagged spots today — per-side photo
            // flagging is C10's work (prototype `s-ext-side`). Empty rather
            // than invented; the row does not render.
            spots: [],
            roomsConfirmed: 0,
            roomsTotal: 0,
            sides: {
              done: sides.progress.done,
              total: sides.progress.total,
              storeys: sides.geo.storeys,
              substrates: sides.geo.substrates,
              windows: sides.dw.windows,
              doors: sides.dw.doors,
              condition: sides.meta.cond.cond,
              rot: sides.meta.cond.rot,
              access: sides.meta.cond.acc,
            },
          }}
        />
      </div>
    );
  }

  if (bundle.kind !== "rooms") {
    return <Holding line="Open your estimate to finish it off." />;
  }

  const loop = bundle.initialInteriorLoop;
  const spots = bundle.initialRooms.flatMap((r) => r.spots ?? []).map((s) => s.label);

  return (
    <div className="wz">
      <header className="wz-top"><Wordmark logoUrl={bundle.logoUrl} /></header>
      <Finish
        estimateId={bundle.estimateId}
        companyPhone={bundle.companyPhone}
        phoneHours={bundle.phoneHours}
        customerPhone={bundle.customerPhone}
        // The midpoint of the range the engine produced — the "computed
        // central estimate" ⚑8 asks for, never the top of the band.
        fixedPriceCents={Math.round((bundle.initial.rangeLoCents + bundle.initial.rangeHiCents) / 2)}
        input={{
          payload: bundle.initial,
          systems: bundle.initialSystems,
          access: bundle.initialAccess.answers,
          extras: bundle.initialExtras.offer.filter((o) => bundle.initialExtras.on.includes(o.code)).map((o) => o.label),
          spots,
          roomsConfirmed: loop ? loop.rooms.filter((r) => r.confirmed).length : bundle.initialRooms.length,
          roomsTotal: bundle.initialRooms.length,
        }}
      />
    </div>
  );
}
