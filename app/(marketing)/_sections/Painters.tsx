import PainterCard from "../_components/PainterCard";
import Md from "../_components/Md";
import type { Painter } from "@/lib/marketing/siteContent";

/**
 * §4.9 — the trusted-network paragraph (verbatim), three painter cards and
 * the four statements. Painters come from Settings → Company → Website —
 * entering one there is the ⚑9.3 decision; until then the three cards are
 * visible placeholders.
 */
const PLACEHOLDERS = [1, 2, 3].map((n) => ({ n, name: `[Painter ${n}]`, meta: "[Specialty] · with Paint Group since [YYYY]", quote: "[One line in their own words]", photoPath: null as string | null, placeholder: true }));

export type PaintersCopy = { h2: string; lead: string; rules: string[] };

export default function Painters({ painters = [], copy }: { painters?: Painter[]; copy: PaintersCopy }) {
  const cards = painters.length
    ? painters.map((p, i) => ({
        n: i + 1, name: p.name, photoPath: p.photoPath, quote: p.quote, placeholder: false,
        meta: [p.specialty, p.since ? `with Paint Group since ${p.since}` : ""].filter(Boolean).join(" · "),
      }))
    : PLACEHOLDERS;
  return (
    <section className="sec light warm" id="painters">
      <div className="wrap">
        <h2>{copy.h2}</h2>
        <p className="lead" style={{ marginTop: 14 }}><Md src={copy.lead} inline /></p>
        <div className="painters">
          {cards.map((c) => <PainterCard key={c.n} {...c} />)}
        </div>
        <div className="rules">
          {copy.rules.map((r, i) => <div className="rule" key={i}><i aria-hidden="true" />{r}</div>)}
        </div>
      </div>
    </section>
  );
}
