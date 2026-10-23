import PainterCard from "../_components/PainterCard";
import Md from "../_components/Md";
import type { Painter } from "@/lib/marketing/siteContent";
import { BRAND_DEFAULTS, sinceLine, type Brand } from "@/lib/marketing/brand";

/**
 * §4.9 — the trusted-network paragraph (verbatim), three painter cards and
 * the four statements. Painters come from Settings → Company → Website —
 * entering one there is the ⚑9.3 decision; until then the three cards are
 * visible placeholders. The "since" line is the brand's (Paint Home brief
 * §4: `painting with us since YYYY`; the painters are the same people).
 */
const placeholders = (brand: Pick<Brand, "sinceTemplate">) => [1, 2, 3].map((n) => ({ n, name: `[Painter ${n}]`, meta: `[Specialty] · ${sinceLine(brand, "[YYYY]")}`, quote: "[One line in their own words]", photoPath: null as string | null, placeholder: true }));

export type PaintersCopy = { h2: string; lead: string; rules: string[] };

export default function Painters({ painters = [], copy, brand = BRAND_DEFAULTS.paintgroup }: { painters?: Painter[]; copy: PaintersCopy; brand?: Pick<Brand, "sinceTemplate"> }) {
  const cards = painters.length
    ? painters.map((p, i) => ({
        n: i + 1, name: p.name, photoPath: p.photoPath, quote: p.quote, placeholder: false,
        meta: [p.specialty, p.since ? sinceLine(brand, p.since) : ""].filter(Boolean).join(" · "),
      }))
    : placeholders(brand);
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
