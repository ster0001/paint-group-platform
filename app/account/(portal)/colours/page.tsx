import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalAftercare, getPortalContext } from "@/lib/portal/data";
import { buildRegister, byColour, describeProduct, displayCode, longDay, swatchLetter, type ColourGroup, type RegisterArea } from "@/lib/portal/colours";
import PrintButton from "../PrintButton";
import ComingCard from "../ComingCard";

export const dynamic = "force-dynamic";

/**
 * 3a-5 · "My colours" — the permanent paint register (§4-F1). Every colour
 * on the walls, kept for good. TBC colours read honestly amber; printing
 * produces the white register document.
 *
 * Portal UX brief (25 Oct 2026): one card per COLOUR listing its surfaces
 * and where (E2, default), a "By area" toggle for the old view; brand ·
 * line · finish off the product name and never an id as a "code" (E1);
 * the real hex or the colour's initial as the swatch (E3); Download PDF and
 * touch-up on a sticky row under each property (E4); properties collapse to
 * their heading + colour count, the first open (E5); "on file for good"
 * once, in the intro; "Applied by 17 Sep 2026" per property (E6).
 */
export default async function ColoursPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const byArea = view === "area";
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const { jobs } = await getPortalAftercare(ctx.accounts.map((a) => a.id));
  // TBC is never a register row (ruling 3, 30 Aug): unconfirmed colours show
  // as one honest amber card per job, not as placeholder swatches.
  const registers = jobs
    .map((job) => {
      const full = buildRegister(job.areas, job.materials, job.liveColours, job.coloursFinalised);
      const register = full
        .map((a) => ({ ...a, rows: a.rows.filter((r) => r.colourName) }))
        .filter((a) => a.rows.length > 0);
      const hasTbc = full.some((a) => a.rows.some((r) => !r.colourName));
      return { job, register, hasTbc, groups: byColour(register) };
    })
    .filter((r) => r.register.length > 0 || r.hasTbc);

  if (registers.length === 0) {
    return (
      <ComingCard
        title="My colours"
        body="Every colour on your walls will be kept here for good — brand, colour name and finish, room by room. It appears as soon as your colours are confirmed with your first job."
      />
    );
  }

  const phone = ctx.companyPhone;

  return (
    <div>
      <h1>My colours</h1>
      <div className="card raised">
        <p className="sub">
          Every colour on your walls, kept here for good. Come back in six months — or six
          years — and it will still be waiting for you.
        </p>
      </div>

      {/* E2: the view toggle — server-rendered links, no script. */}
      <div className="tabs" role="tablist" aria-label="View" data-testid="colours-view">
        <Link href="/account/colours" className={`tab-btn${byArea ? "" : " on"}`} role="tab" aria-selected={!byArea}>By colour</Link>
        <Link href="/account/colours?view=area" className={`tab-btn${byArea ? " on" : ""}`} role="tab" aria-selected={byArea}>By area</Link>
      </div>

      {registers.map(({ job, register, hasTbc, groups }, i) => {
        const applied = longDay(job.warranty?.startsOn ?? null);
        const colourCount = groups.filter((g) => g.colourName).length;
        const heading = (
          <h2 className="row" style={{ margin: 0 }}>
            <span>{job.title}{colourCount > 0 ? <span className="count"> · {colourCount} colour{colourCount === 1 ? "" : "s"}</span> : null}</span>
            {applied && <span className="count" data-testid="applied-by">Applied by {applied}</span>}
          </h2>
        );
        const body = (
          <>
            {/* E4: the actions sit under the heading, sticky while this property scrolls. */}
            <div className="acts sticky" data-testid="colour-actions">
              <PrintButton label="Download PDF" small />
              {phone && (
                // ⚑ E4: today this rings the office — there is no prefilled message to carry, so it stays a call.
                <a className="btn btn-ghost sm" href={`tel:${phone.replace(/\s+/g, "")}`}>Need touch-up paint?</a>
              )}
            </div>
            {hasTbc && (
              <div className="card" data-testid="colours-tbc-card">
                <span className="chip amber nodot">Colours to be confirmed</span>
                <p className="sub" style={{ marginTop: 8 }}>
                  Some colours for this job are still being decided. They&apos;ll appear
                  here the moment they&apos;re confirmed.
                </p>
              </div>
            )}
            {byArea ? <ByArea register={register} /> : <ByColour groups={groups} />}
          </>
        );
        // E5: with more than one property each collapses to its heading; the first stays open.
        return registers.length > 1 ? (
          <details key={job.workOrderId} className="group" open={i === 0} data-testid="colour-property">
            <summary>{heading}</summary>
            {body}
          </details>
        ) : (
          <section key={job.workOrderId} data-testid="colour-property">
            <div style={{ margin: "24px 0 10px" }}>{heading}</div>
            {body}
          </section>
        );
      })}
    </div>
  );
}

function Swatch({ hex, name }: { hex: string | null; name: string | null }) {
  // E3: the real colour when known; otherwise the initial on surface-2, never a blank grey.
  if (hex) return <div className="sw" style={{ background: hex }} aria-hidden="true" />;
  if (!name) return <div className="sw tbc" aria-hidden="true" />;
  return <div className="sw letter" aria-hidden="true" data-testid="swatch-letter">{swatchLetter(name)}</div>;
}

function productLine(g: Pick<ColourGroup, "brand" | "line" | "finish" | "product">): string {
  return [g.brand, g.line, g.finish].filter(Boolean).join(" · ") || g.product;
}

function ByColour({ groups }: { groups: ColourGroup[] }) {
  const named = groups.filter((g) => g.colourName);
  if (named.length === 0) return null;
  return (
    <div className="card">
      {named.map((g) => (
        <div className="sw-row" key={g.key} data-testid="colour-card">
          <Swatch hex={g.colourHex} name={g.colourName} />
          <div style={{ minWidth: 0 }}>
            <div className="sw-nm">{g.colourName}</div>
            <div className="sw-meta">
              {productLine(g)}{g.coats ? ` · ${g.coats}` : ""}
              {g.code ? <> · <span className="money" style={{ fontWeight: 500 }}>Code {g.code}</span></> : null}
            </div>
            <div className="sw-meta" style={{ color: "var(--ink-3)" }}>
              {g.surfaces.map((s) => `${s.surface} — ${s.areas.join(", ")}`).join(" · ")}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ByArea({ register }: { register: RegisterArea[] }) {
  return (
    <>
      {register.map((area, areaIdx) => (
        // Two rooms can share a title ("Bedroom") — the key needs the index.
        <div key={`${area.title}-${areaIdx}`}>
          <h2 style={{ fontSize: 13.5 }}>{area.title}</h2>
          <div className="card">
            {area.rows.map((row, i) => {
              const d = describeProduct(row.product);
              const code = displayCode(row.code, row.colourHex);
              const meta = [row.surface, productLine({ ...d, product: row.product }), `${row.coats} coat${row.coats === 1 ? "" : "s"}`].join(" · ");
              return (
                <div className="sw-row" key={`${row.surface}-${row.product}-${i}`}>
                  <Swatch hex={row.colourHex} name={row.colourName} />
                  <div style={{ minWidth: 0 }}>
                    <div className="sw-nm">{row.colourName ?? "Colour to be confirmed"}</div>
                    <div className="sw-meta">{meta}{code ? <> · <span className="money" style={{ fontWeight: 500 }}>Code {code}</span></> : null}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
