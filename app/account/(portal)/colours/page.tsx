import { redirect } from "next/navigation";
import { getPortalAftercare, getPortalContext } from "@/lib/portal/data";
import { buildRegister, sheenOf } from "@/lib/portal/colours";
import PrintButton from "../PrintButton";
import ComingCard from "../ComingCard";

export const dynamic = "force-dynamic";

/**
 * 3a-5 · "My colours" — the permanent paint register (§4-F1). Every colour
 * on the walls, per area, kept for good. TBC colours read honestly amber;
 * printing produces the white register document.
 */
export default async function ColoursPage() {
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
      return { job, register, hasTbc };
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

      {registers.map(({ job, register, hasTbc }) => (
        <section key={job.workOrderId}>
          {registers.length > 1 && <h2>{job.title}</h2>}
          {hasTbc && (
            <div className="card" data-testid="colours-tbc-card">
              <span className="chip amber nodot">Colours to be confirmed</span>
              <p className="sub" style={{ marginTop: 8 }}>
                Some colours for this job are still being decided. They&apos;ll appear
                here the moment they&apos;re confirmed.
              </p>
            </div>
          )}
          {register.map((area, areaIdx) => (
            // Two rooms can share a title ("Bedroom") — the key needs the index.
            <div key={`${area.title}-${areaIdx}`}>
              <h2>{area.title}</h2>
              <div className="card">
                {area.rows.map((row, i) => {
                  const meta = [
                    row.surface.toUpperCase(),
                    sheenOf(row.product),
                    `${row.coats} COAT${row.coats === 1 ? "" : "S"}`,
                    row.code ? `CODE ${row.code}` : null,
                  ].filter(Boolean).join(" · ");
                  return (
                    <div className="sw-row" key={`${row.surface}-${row.product}-${i}`}>
                      <div
                        className={`sw${row.colourHex ? "" : " tbc"}`}
                        style={row.colourHex ? { background: row.colourHex } : undefined}
                      />
                      <div>
                        <div className="sw-nm">
                          {row.colourName ?? "Colour to be confirmed"}
                          {!row.colourName && <span className="chip amber nodot" style={{ marginLeft: 8 }}>TBC</span>}
                        </div>
                        <div className="sw-meta">{meta}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {job.warranty && (
            <p className="note" style={{ marginTop: 4 }}>
              Applied by {job.warranty.startsOn} · this register stays on file for good.
            </p>
          )}
        </section>
      ))}

      <div className="btn-row" style={{ marginTop: 18 }}>
        <PrintButton label="Download as PDF" />
        {phone && (
          <a className="btn btn-ghost" href={`tel:${phone.replace(/\s+/g, "")}`}>Need touch-up paint?</a>
        )}
      </div>
    </div>
  );
}
