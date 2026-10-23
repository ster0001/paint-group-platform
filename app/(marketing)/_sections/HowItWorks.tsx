import TelLink from "../_components/TelLink";
import { BRAND_DEFAULTS, type Brand } from "@/lib/marketing/brand";

export type StepsCopy = { h2: string; steps: Array<{ title: string; body: string }>; talkLine: string };

/** §4.3 — four white cards on warm; copy from site content (session 8). The number and hours are the brand's (lib/marketing/brand.ts). */
export default function HowItWorks({ copy, brand = BRAND_DEFAULTS.paintgroup }: { copy: StepsCopy; brand?: Pick<Brand, "phoneDisplay" | "hoursLine"> }) {
  return (
    <section className="sec light warm" id="how">
      <div className="wrap">
        <h2>{copy.h2}</h2>
        <div className="grid4">
          {copy.steps.map((st, i) => (
            <div className="card" key={i}><span className="n">{String(i + 1).padStart(2, "0")}</span><h3>{st.title}</h3><p>{st.body}</p></div>
          ))}
        </div>
        <div className="phone-row">
          {copy.talkLine} <b><TelLink where="how">Call {brand.phoneDisplay}</TelLink></b><span>{brand.hoursLine}</span>
        </div>
      </div>
    </section>
  );
}
