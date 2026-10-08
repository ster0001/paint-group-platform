import Link from "next/link";
import { requireContractor } from "@/lib/contractor/session";
import { createClient } from "@/lib/supabase/server";
import { loadStandards } from "@/lib/standards/load";
import { loadMyStandards } from "@/lib/standards/status";
import { SIGN_SECTIONS, ackedCount, isSignSection, nextSignSection, type SignSectionKey } from "@/lib/standards/acks";
import { surfacesOn } from "@/lib/standards/model";
import { SectionBody, StandardsUnavailable, SurfaceAllLevels } from "@/app/components/standards/StandardsViews";
import SignoffStep from "./SignoffStep";

export const dynamic = "force-dynamic";

/**
 * The first-time sign-off (brief Step 2; rulings S4–S7): an intro, then six
 * sections read one at a time, each with one tick, then a confirmation
 * screen. Resumable: with no `?s=` it opens at the first section not yet
 * ticked. Full-screen while the gate applies — the tab bar is hidden on this
 * route (PortalTabs) so there is one thing to do. A painter who has already
 * confirmed can re-read it from Help; nothing is written again.
 */
export default async function StandardsConfirmPage({ searchParams }: { searchParams: Promise<{ s?: string; done?: string }> }) {
  const { contractor } = await requireContractor();
  const { s, done } = await searchParams;
  const supabase = await createClient();
  const [{ standards, error }, mine] = await Promise.all([loadStandards(), contractor ? loadMyStandards(supabase, contractor.id) : Promise.resolve({ my: null, error: "no painter" })]);
  if (!standards || !mine.my) return <div className="wrap"><StandardsUnavailable message={error ?? mine.error ?? ""} /></div>;
  const my = mine.my;
  const gated = my.status === "blocked";
  const acked = my.acked;
  const count = ackedCount(acked);

  // The confirmation screen.
  if (done === "1" || (my.status === "confirmed" && !s)) {
    return (
      <div className={`wrap signoff ${gated ? "gated" : ""}`} data-testid="signoff-done">
        <span className="slab">All done</span>
        <h1>Standards confirmed</h1>
        <div className="card">
          <div className="perk on"><span className="ic">✓</span><span>6 of 6 sections confirmed</span></div>
          <div className="perk on"><span className="ic">✓</span><span>{my.confirmedAt ? new Date(my.confirmedAt).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Melbourne" }) : "Today"} · Version {my.confirmedNo ?? my.requiredVersionNo}</span></div>
          <div className="perk on"><span className="ic">✓</span><span>A copy is being saved in your documents and emailed to you</span></div>
        </div>
        <p className="hint">You can read the standards any time under Help, or from any surface on a work order.</p>
        <Link href="/portal" className="btn cy" data-testid="signoff-home">Go to my jobs</Link>
      </div>
    );
  }

  const current: SignSectionKey | null = isSignSection(s) ? s : nextSignSection(acked);

  // The intro, before the first tick.
  if (!current || (!s && count === 0)) {
    const first = nextSignSection(acked) ?? "levels";
    return (
      <div className={`wrap signoff ${gated ? "gated" : ""}`} data-testid="signoff-intro">
        <span className="slab">Before your next job offer</span>
        <h1>Read and confirm the Paint Group finish standards</h1>
        <p>This is what we expect on every job, and what our team checks against. It also shows when you can charge a variation.</p>
        {my.previousConfirmedNo != null && my.changeNote && (
          <div className="card amberish" data-testid="signoff-change-note">
            <span className="chip amb">What changed since Version {my.previousConfirmedNo}</span>
            <p style={{ marginTop: 8 }}>{my.changeNote}</p>
          </div>
        )}
        <div className="card">
          <div className="tick-head"><b>6 short sections</b><span className="tick-count">about 10 min</span></div>
          <ol className="std-clean" style={{ marginTop: 8 }}>{SIGN_SECTIONS.map((x) => <li key={x.key}>{x.title}</li>)}</ol>
        </div>
        <div className="std-note">{gated
          ? "You will not receive job offers until all 6 sections are confirmed. Jobs you have already started are not affected."
          : "Confirm all 6 sections to keep getting job offers. Jobs you have already started are not affected."}</div>
        <Link href={`/portal/standards/confirm?s=${first}`} className="btn cy" data-testid="signoff-start">Start</Link>
        {!gated && <Link href="/portal" className="btn gh">Not now</Link>}
      </div>
    );
  }

  const index = SIGN_SECTIONS.findIndex((x) => x.key === current);
  const section = SIGN_SECTIONS[index];
  const last = index === SIGN_SECTIONS.length - 1;
  const after = SIGN_SECTIONS[index + 1]?.key;
  const already = acked.has(current);

  return (
    <div className={`wrap signoff std ${gated ? "gated" : ""}`} data-testid="signoff-section" data-section={current}>
      <div className="std-row">
        <span className="std-eyebrow grow">Section {index + 1} of 6</span>
        {index > 0 && <Link href={`/portal/standards/confirm?s=${SIGN_SECTIONS[index - 1].key}`} className="std-link">‹ Back</Link>}
      </div>
      <div className="signoff-progress" aria-label={`${count} of 6 sections confirmed`}>
        {SIGN_SECTIONS.map((x) => <i key={x.key} className={acked.has(x.key) || x.key === current ? "on" : ""} />)}
      </div>
      <h1>{section.title}</h1>
      {current === "interior" && (
        <>
          <p>Tap each surface to read it. The level on your work order tells you which line to follow.</p>
          <p>{standards.interior.intro}</p>
          {surfacesOn(standards, "interior").map((sf) => <SurfaceAllLevels key={sf.key} surface={sf} />)}
        </>
      )}
      {current === "exterior" && (
        <>
          <p>{standards.exterior.intro}</p>
          <div className="std-card"><h3>Every exterior surface</h3><ul className="std-clean">{standards.exterior.rules.map((r) => <li key={r}>{r}</li>)}</ul></div>
          {surfacesOn(standards, "exterior").map((sf) => <SurfaceAllLevels key={sf.key} surface={sf} />)}
        </>
      )}
      {current !== "interior" && current !== "exterior" && section.body.map((b) => (
        <div key={b}>
          {b === "checklist" && <h3 style={{ marginTop: 12 }}>Final checklist</h3>}
          <SectionBody standards={standards} section={b} />
        </div>
      ))}
      {already ? (
        <div className="signoff-foot" data-testid="signoff-already">
          <p className="hint">You have already confirmed this section.</p>
          <Link href={last ? "/portal/standards/confirm?done=1" : `/portal/standards/confirm?s=${after}`} className="btn cy" data-testid="signoff-next">
            {last ? "Finish" : "Next section"}
          </Link>
        </div>
      ) : (
        <SignoffStep key={current} section={current} last={last}
          nextHref={after ? `/portal/standards/confirm?s=${after}` : "/portal/standards/confirm?done=1"}
          doneHref="/portal/standards/confirm?done=1" />
      )}
    </div>
  );
}
