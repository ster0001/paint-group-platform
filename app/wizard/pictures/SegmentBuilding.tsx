/**
 * The building for a commercial segment (UI refresh S7, Tom 10 Oct 2026: "the
 * coloured image on the right should change depending on what is clicked").
 * One drawing per segment KEY — an identifier, never the segment's wording: an
 * office block, an industrial shed, a shop with an awning, a clinic, a school,
 * an apartment block, a street frontage, a hall. A key with no drawing (a new
 * segment, or none picked yet) shows the shop front the place step used.
 *
 * Same classes as `HousePicture` (`wz-house`, `.body`, `.glass`), so the
 * windows light for an inside job and the walls take their fresh coat for an
 * outside one. Decorative and `aria-hidden`.
 */
export default function SegmentBuilding({ segment, jobType }: { segment: string | null; jobType: "interior" | "exterior" | "both" }) {
  const lit = jobType !== "exterior";
  const fresh = jobType !== "interior";
  const k = segment ?? "";
  const win = (x: number, y: number, w = 26, h = 22) => <rect key={`${x}-${y}`} className="glass" x={x} y={y} width={w} height={h} rx="1.5" />;
  const grid = (x0: number, y0: number, cols: number, rows: number, dx: number, dy: number, w?: number, h?: number) =>
    Array.from({ length: cols * rows }, (_, i) => win(x0 + (i % cols) * dx, y0 + Math.floor(i / cols) * dy, w, h));
  return (
    <svg className={`wz-house wz-segbuild ${lit ? "lit" : ""} ${fresh ? "fresh" : ""}`} viewBox="0 0 400 300" aria-hidden="true"
      data-testid="pic-segment" data-segment={k || "none"}>
      <rect x="0" y="250" width="400" height="50" fill="#C9D6CC" />
      {k === "office" ? (
        <g data-part="office">
          <rect className="body" x="110" y="40" width="180" height="210" />
          <rect x="110" y="40" width="180" height="10" fill="#55636E" />
          {grid(124, 62, 5, 6, 32, 28)}
          <rect x="180" y="214" width="40" height="36" fill="#55636E" /><rect x="186" y="220" width="28" height="30" fill="#9FB3BF" />
        </g>
      ) : k === "warehouse" ? (
        <g data-part="warehouse">
          <polygon points="40,130 200,92 360,130" fill="#55636E" />
          <rect className="body" x="50" y="130" width="300" height="120" />
          <path d="M50 150h300M50 170h300M50 190h300M50 210h300M50 230h300" stroke="#16212A" strokeOpacity=".08" />
          <rect x="90" y="168" width="70" height="82" fill="#D6DDE1" stroke="#16212A" strokeOpacity=".2" />
          <path d="M90 180h70M90 192h70M90 204h70M90 216h70M90 228h70M90 240h70" stroke="#16212A" strokeOpacity=".15" />
          <rect x="190" y="168" width="70" height="82" fill="#D6DDE1" stroke="#16212A" strokeOpacity=".2" />
          <path d="M190 180h70M190 192h70M190 204h70M190 216h70M190 228h70M190 240h70" stroke="#16212A" strokeOpacity=".15" />
          <rect x="290" y="206" width="24" height="44" fill="#2F6F7A" />
          {win(286, 150, 44, 18)}
        </g>
      ) : k === "retail" ? (
        <g data-part="retail">
          <rect className="body" x="60" y="100" width="280" height="150" />
          <rect x="60" y="100" width="280" height="28" fill="#0D161C" /><rect x="140" y="108" width="120" height="12" rx="3" fill="#3BD8E9" />
          <path d="M56 128h288l-10 26H66z" fill="#E7A23B" /><path d="M86 128l-6 26M122 128l-4 26M158 128l-2 26M194 128v26M230 128l2 26M266 128l4 26M302 128l6 26" stroke="#fff" strokeOpacity=".6" strokeWidth="6" />
          {win(78, 168, 116, 82)}
          <rect x="206" y="168" width="40" height="82" fill="#55636E" />
          {win(258, 168, 64, 82)}
        </g>
      ) : k === "health" ? (
        <g data-part="health">
          <rect className="body" x="70" y="96" width="260" height="154" />
          <rect x="70" y="96" width="260" height="8" fill="#55636E" />
          <rect x="182" y="58" width="36" height="36" rx="4" fill="#fff" stroke="#16212A" strokeOpacity=".2" />
          <path d="M200 64v24M188 76h24" stroke="#D2463B" strokeWidth="8" />
          {grid(88, 118, 6, 2, 40, 40, 28, 24)}
          <rect x="178" y="200" width="44" height="50" fill="#9FB3BF" stroke="#55636E" strokeWidth="3" />
          <path d="M150 196h100" stroke="#0A7C8E" strokeWidth="6" />
        </g>
      ) : k === "school" ? (
        <g data-part="school">
          <polygon points="150,104 200,70 250,104" fill="#B5503B" />
          <rect className="body" x="40" y="130" width="320" height="120" />
          <rect className="body" x="150" y="104" width="100" height="146" />
          <circle cx="200" cy="126" r="12" fill="#fff" stroke="#16212A" strokeOpacity=".3" /><path d="M200 118v8l5 4" stroke="#16212A" strokeWidth="1.5" fill="none" />
          {grid(54, 150, 3, 2, 30, 46, 22, 30)}
          {grid(266, 150, 3, 2, 30, 46, 22, 30)}
          <rect x="182" y="200" width="36" height="50" fill="#55636E" />
          <path d="M370 250V150" stroke="#55636E" strokeWidth="2" /><path d="M370 150h22v14h-22" fill="#0A7C8E" />
        </g>
      ) : k === "strata" ? (
        <g data-part="strata">
          <rect className="body" x="90" y="34" width="220" height="216" />
          {Array.from({ length: 6 }, (_, r) => (
            <g key={r}>
              <rect x="90" y={70 + r * 30} width="220" height="4" fill="#16212A" fillOpacity=".12" />
              {[104, 160, 216, 272].map((x) => <rect key={x} className="glass" x={x} y={46 + r * 30} width="24" height="18" rx="1" />)}
            </g>
          ))}
          <rect x="182" y="222" width="36" height="28" fill="#55636E" /><rect x="170" y="216" width="60" height="6" fill="#0A7C8E" />
        </g>
      ) : k === "shopfront" ? (
        <g data-part="shopfront-street">
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect className="body" x={30 + i * 116} y={i === 1 ? 104 : 120} width="110" height={i === 1 ? 146 : 130} />
              <rect x={30 + i * 116} y={i === 1 ? 160 : 168} width="110" height="10" fill={["#0A7C8E", "#E7A23B", "#55636E"][i]} />
              {win(40 + i * 116, i === 1 ? 182 : 186, 54, 64)}
              <rect x={100 + i * 116} y={i === 1 ? 182 : 186} width="28" height={i === 1 ? 68 : 64} fill="#55636E" />
              {win(44 + i * 116, i === 1 ? 118 : 132, 34, 24)}{win(86 + i * 116, i === 1 ? 118 : 132, 34, 24)}
            </g>
          ))}
        </g>
      ) : k === "other" ? (
        <g data-part="hall">
          <polygon points="80,140 200,74 320,140" fill="#55636E" />
          <rect className="body" x="90" y="140" width="220" height="110" />
          <path d="M200 74V40M190 52h20" stroke="#55636E" strokeWidth="5" />
          <path d="M178 250v-44a22 22 0 0144 0v44z" fill="#55636E" />
          {win(110, 166, 30, 44)}{win(260, 166, 30, 44)}
          <circle className="glass" cx="200" cy="114" r="12" />
        </g>
      ) : (
        <g data-part="shopfront">
          <rect className="body" x="60" y="110" width="280" height="140" /><rect x="60" y="110" width="280" height="30" fill="#0D161C" />
          <rect x="150" y="119" width="100" height="12" rx="3" fill="#3BD8E9" /><polygon points="60,140 340,140 352,164 48,164" fill="#0A7C8E" />
          <rect className="glass" x="80" y="176" width="110" height="74" /><rect className="glass" x="250" y="176" width="70" height="74" />
          <rect x="204" y="176" width="34" height="74" fill="#55636E" />
        </g>
      )}
      <g data-part="trees"><circle cx="30" cy="236" r="16" fill="#8FB59A" /><rect x="27" y="242" width="6" height="12" fill="#6E5B45" /><circle cx="372" cy="240" r="12" fill="#8FB59A" /></g>
    </svg>
  );
}
