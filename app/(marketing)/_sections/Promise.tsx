import PromiseExplorer, { type PromiseCopy } from "../_components/PromiseExplorer";

/** §4.5 — "Four things we put in writing before we start." Copy from site content (session 8). */
export default function PromiseSection({ variationPhotos = [], copy }: { variationPhotos?: string[]; copy: PromiseCopy }) {
  return (
    <section className="sec light" id="promise">
      <div className="wrap">
        <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }}>{copy.kicker}</div>
        <h2>{copy.h2}</h2>
        <p className="lead" style={{ marginTop: 14 }}>{copy.lead}</p>
        <PromiseExplorer variationPhotos={variationPhotos} copy={copy} />
      </div>
    </section>
  );
}
