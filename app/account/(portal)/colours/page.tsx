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
  const registers = jobs
    .map((job) => ({ job, register: buildRegister(job.areas, job.materials, job.liveColours) }))
    .filter((r) => r.register.length > 0);

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

      {registers.map(({ job, register }) => (
        <section key={job.workOrderId}>
          {registers.length > 1 && <h2>{job.title}</h2>}
          {register.map((area) => (
            <div key={area.title}>
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
