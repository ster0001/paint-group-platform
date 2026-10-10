/**
 * The house, drawn (UI refresh S2, brief §7.2; components doc §4) — the
 * picture beside the Address and Place steps. Inline SVG from the mockup's
 * `#house`; no library.
 *
 * It answers three things: the property type (a house, a townhouse between
 * neighbours, a block, a shop front), the storeys (the roof lifts and the
 * upper floor slides in), and what is being painted (inside lights the
 * windows, outside gives the walls a fresh coat, both does both). The outside
 * picture element by element is S5's; this one is the home-inside version.
 *
 * Decorative and `aria-hidden`: every answer is also in words on the left.
 */
export type HouseKind = "house" | "townhouse" | "unit_apartment" | "commercial";

export default function HousePicture({ kind, storeys, jobType }: {
  kind: HouseKind;
  storeys: "single" | "double";
  jobType: "interior" | "exterior" | "both";
}) {
  const two = storeys === "double" && kind !== "unit_apartment" && kind !== "commercial";
  const lit = jobType !== "exterior";
  const fresh = jobType !== "interior";
  const isHouse = kind === "house" || kind === "townhouse";
  return (
    <svg className={`wz-house ${two ? "two" : ""} ${lit ? "lit" : ""} ${fresh ? "fresh" : ""}`} viewBox="0 0 400 300" aria-hidden="true"
      data-testid="pic-house" data-kind={kind} data-storeys={two ? "double" : "single"} data-job={jobType}>
      <rect x="0" y="250" width="400" height="50" fill="#C9D6CC" />
      {kind === "townhouse" && (
        <g data-part="neighbours">
          <rect x="18" y="170" width="72" height="80" fill="#DCE3E7" /><rect x="310" y="170" width="72" height="80" fill="#DCE3E7" />
          <polygon points="8,170 54,138 100,170" fill="#B4C0C8" /><polygon points="300,170 346,138 392,170" fill="#B4C0C8" />
        </g>
      )}
      {isHouse && (
        <g>
          <g className="up" data-part="upper">
            <rect className="body" x="90" y="90" width="220" height="72" />
            <g stroke="#16212A" strokeOpacity=".1"><path d="M90 102h220M90 114h220M90 126h220M90 138h220M90 150h220" /></g>
            <rect className="frame" x="118" y="106" width="52" height="38" rx="2" /><rect className="glass" x="123" y="111" width="42" height="28" />
            <rect className="frame" x="230" y="106" width="52" height="38" rx="2" /><rect className="glass" x="235" y="111" width="42" height="28" />
          </g>
          <rect className="body" x="90" y="160" width="220" height="90" />
          <g stroke="#16212A" strokeOpacity=".1"><path d="M90 175h220M90 190h220M90 205h220M90 220h220M90 235h220" /></g>
          <g className="roof">
            <polygon className="roof-tiles" points="66,162 200,88 334,162" />
            <rect x="250" y="100" width="20" height="34" fill="#55636E" />
            <polygon className="trim" points="66,162 200,88 334,162 326,162 200,96 74,162" />
            <rect className="trim" x="74" y="162" width="252" height="6" />
            <rect x="62" y="157" width="276" height="5" rx="2" fill="#4E5F6B" />
          </g>
          <rect className="frame" x="183" y="190" width="34" height="60" rx="2" /><rect x="187" y="194" width="26" height="56" fill="#0A7C8E" /><circle cx="208" cy="224" r="2" fill="#fff" />
          <rect className="frame" x="112" y="186" width="54" height="40" rx="2" /><rect className="glass" x="117" y="191" width="44" height="30" />
          <rect className="frame" x="234" y="186" width="54" height="40" rx="2" /><rect className="glass" x="239" y="191" width="44" height="30" />
        </g>
      )}
      {kind === "unit_apartment" && (
        <g data-part="block">
          <rect className="body" x="110" y="46" width="180" height="204" /><rect x="104" y="40" width="192" height="10" fill="#55636E" />
          {[[128, 66], [181, 66], [234, 66], [128, 112], [234, 112], [128, 158], [181, 158], [234, 158]].map(([x, y]) => (
            <rect key={`${x}-${y}`} className="glass" x={x} y={y} width="38" height="30" />
          ))}
          <rect x="181" y="112" width="38" height="30" fill="#FFE9A8" stroke="#0A7C8E" strokeWidth="3" />
          <rect x="184" y="206" width="32" height="44" fill="#0A7C8E" />
        </g>
      )}
      {kind === "commercial" && (
        <g data-part="shopfront">
          <rect className="body" x="60" y="110" width="280" height="140" /><rect x="60" y="110" width="280" height="30" fill="#0D161C" />
          <rect x="150" y="119" width="100" height="12" rx="3" fill="#3BD8E9" /><polygon points="60,140 340,140 352,164 48,164" fill="#0A7C8E" />
          <rect className="glass" x="80" y="176" width="110" height="74" /><rect className="glass" x="250" y="176" width="70" height="74" />
          <rect x="204" y="176" width="34" height="74" fill="#55636E" />
        </g>
      )}
      <g data-part="trees"><circle cx="52" cy="232" r="20" fill="#8FB59A" /><rect x="49" y="240" width="6" height="14" fill="#6E5B45" /><circle cx="356" cy="238" r="14" fill="#8FB59A" /></g>
    </svg>
  );
}
