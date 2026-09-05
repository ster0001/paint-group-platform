import PromiseExplorer from "../_components/PromiseExplorer";

/** §4.5 — "Four things we put in writing before we start." */
export default function PromiseSection({ variationPhotos = [] }: { variationPhotos?: string[] }) {
  return (
    <section className="sec light" id="promise">
      <div className="wrap">
        <h2>Four things we put in writing before we start.</h2>
        <p className="lead" style={{ marginTop: 14 }}>Tap each one to see exactly what it looks like inside your job.</p>
        <PromiseExplorer variationPhotos={variationPhotos} />
      </div>
    </section>
  );
}
