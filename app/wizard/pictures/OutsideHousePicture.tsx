/**
 * The house from the street, element by element (UI refresh S5, brief §7.8;
 * components doc §4) — the picture beside the Outside step. Inline SVG from
 * the mockup's `#house` in its exterior mode; no library.
 *
 * Each element on the house is its own shape with `data-e` and `data-on`:
 * the body, window frames, doors, fascias, gutters and downpipes, eaves take
 * their fresh coat when ticked. Each "other area" (`data-x`) appears beside
 * the house when ticked. The wall material sets the texture, two storeys add
 * the upper floor, and the colour answer sets the wall's tone (⚑ 15: three
 * set tones, no swatches). Decorative and `aria-hidden`.
 */
const TONE: Record<string, string> = { same: "#ddd3be", new: "#a9d6de", bold: "#faf8f3" };

export default function OutsideHousePicture({ elements, standalone, materials, storeys, colour, highlight = null }: {
  elements: readonly string[];
  standalone: readonly string[];
  materials: readonly string[];
  storeys: "single" | "double";
  colour: string;
  highlight?: string | null;
}) {
  const on = (e: string) => elements.includes(e);
  const x = (k: string) => standalone.includes(k);
  const two = storeys === "double";
  const mat = materials.includes("brick") ? "brick" : materials.includes("cement_sheet") || materials.includes("panelling") ? "sheet" : materials.includes("weatherboards") || materials.length === 0 ? "boards" : "plain";
  const e = (k: string, extra = "") => `e e-${k} ${on(k) ? "on" : ""} ${highlight === k ? "hl" : ""} ${extra}`;
  return (
    <svg className={`wz-outhouse ${two ? "two" : ""}`} viewBox="0 0 400 300" aria-hidden="true" data-testid="pic-outside"
      style={{ ["--extc" as string]: TONE[colour] ?? TONE.new } as React.CSSProperties}>
      <defs>
        <pattern id="wz-brk" width="20" height="10" patternUnits="userSpaceOnUse"><path d="M0 .5H20M0 5.5H20M5 .5V5.5M15 5.5V10" stroke="#16212A" strokeOpacity=".16" fill="none" /></pattern>
        <pattern id="wz-pk" width="10" height="26" patternUnits="userSpaceOnUse"><path d="M3 26V6l2-4 2 4v20z" fill="#FFFFFF" stroke="#16212A" strokeOpacity=".3" strokeWidth=".8" /></pattern>
      </defs>
      <rect x="0" y="250" width="400" height="50" fill="#C9D6CC" />
      <g className={`x ${x("paling_fence") ? "on" : ""}`} data-x="paling_fence" data-on={x("paling_fence") ? "1" : "0"}>
        <rect x="6" y="214" width="84" height="36" fill="#B79C78" /><rect x="310" y="214" width="84" height="36" fill="#B79C78" />
        <path d="M14 214v36M22 214v36M30 214v36M38 214v36M46 214v36M54 214v36M62 214v36M70 214v36M78 214v36M318 214v36M326 214v36M334 214v36M342 214v36M350 214v36M358 214v36M366 214v36M374 214v36M382 214v36" stroke="#16212A" strokeOpacity=".18" />
      </g>
      <g className={`x ${x("shed") ? "on" : ""}`} data-x="shed" data-on={x("shed") ? "1" : "0"}>
        <rect x="338" y="210" width="52" height="40" fill="#E9EEF1" stroke="#16212A" strokeOpacity=".2" /><polygon points="332,210 364,192 396,210" fill="#6B7780" /><rect x="355" y="224" width="18" height="26" fill="#55636E" />
      </g>
      <g className={`x ${x("pergola") ? "on" : ""}`} data-x="pergola" data-on={x("pergola") ? "1" : "0"}>
        <path d="M18 250V198M82 250V198" stroke="#5E6E79" strokeWidth="6" /><path d="M8 198h84M8 206h84" stroke="#5E6E79" strokeWidth="5" /><path d="M22 192v18M36 192v18M50 192v18M64 192v18M78 192v18" stroke="#5E6E79" strokeWidth="3" />
      </g>
      <g className="up">
        <rect className={e("body")} data-e="body" data-on={on("body") ? "1" : "0"} x="90" y="90" width="220" height="72" />
        {mat === "boards" && <g stroke="#16212A" strokeOpacity=".1"><path d="M90 102h220M90 114h220M90 126h220M90 138h220M90 150h220" /></g>}
        {mat === "brick" && <rect x="90" y="90" width="220" height="72" fill="url(#wz-brk)" />}
        <rect className={e("windows")} data-e="windows" x="118" y="106" width="52" height="38" rx="2" /><rect className="glass" x="123" y="111" width="42" height="28" />
        <rect className={e("windows")} data-e="windows" x="230" y="106" width="52" height="38" rx="2" /><rect className="glass" x="235" y="111" width="42" height="28" />
        <rect className={e("gutters")} data-e="gutters" x="303" y="176" width="5" height="74" />
      </g>
      <rect className={e("body")} data-e="body" data-on={on("body") ? "1" : "0"} x="90" y="160" width="220" height="90" />
      {mat === "boards" && <g stroke="#16212A" strokeOpacity=".1"><path d="M90 175h220M90 190h220M90 205h220M90 220h220M90 235h220" /></g>}
      {mat === "brick" && <rect x="90" y="160" width="220" height="90" fill="url(#wz-brk)" />}
      {mat === "sheet" && <g stroke="#16212A" strokeOpacity=".14"><path d="M134 160v90M178 160v90M222 160v90M266 160v90" /></g>}
      <g className="roof">
        <polygon className="hr" points="66,162 200,88 334,162" /><rect x="250" y="100" width="20" height="34" fill="#55636E" />
        <polygon className={e("fascias")} data-e="fascias" data-on={on("fascias") ? "1" : "0"} points="66,162 200,88 334,162 326,162 200,96 74,162" />
        <rect className={e("eaves")} data-e="eaves" data-on={on("eaves") ? "1" : "0"} x="74" y="162" width="252" height="6" />
        <rect className={e("gutters")} data-e="gutters" data-on={on("gutters") ? "1" : "0"} x="62" y="157" width="276" height="5" rx="2" />
        <rect className={e("gutters")} data-e="gutters" x="303" y="162" width="5" height="88" />
      </g>
      <rect className={e("doors")} data-e="doors" data-on={on("doors") ? "1" : "0"} x="183" y="190" width="34" height="60" rx="2" />
      <rect className={e("doors", "leaf")} data-e="doors" x="187" y="194" width="26" height="56" /><circle cx="208" cy="224" r="2" fill="#fff" />
      <rect className={e("windows")} data-e="windows" data-on={on("windows") ? "1" : "0"} x="112" y="186" width="54" height="40" rx="2" /><rect className="glass" x="117" y="191" width="44" height="30" />
      {!x("garage_door") && <><rect className={e("windows")} data-e="windows" x="234" y="186" width="54" height="40" rx="2" /><rect className="glass" x="239" y="191" width="44" height="30" /></>}
      <g className={`x ${x("garage_door") ? "on" : ""}`} data-x="garage_door" data-on={x("garage_door") ? "1" : "0"}>
        <rect x="228" y="190" width="68" height="60" fill="#F4F6F7" stroke="#16212A" strokeOpacity=".25" /><path d="M228 202h68M228 214h68M228 226h68M228 238h68" stroke="#16212A" strokeOpacity=".16" />
      </g>
      <g className={`x ${x("deck") ? "on" : ""}`} data-x="deck" data-on={x("deck") ? "1" : "0"}>
        <rect x="148" y="248" width="104" height="10" fill="#B08A5E" stroke="#16212A" strokeOpacity=".2" /><path d="M160 248v10M174 248v10M188 248v10M202 248v10M216 248v10M230 248v10M242 248v10" stroke="#16212A" strokeOpacity=".2" />
      </g>
      <g className={`x ${x("picket_fence") ? "on" : ""}`} data-x="picket_fence" data-on={x("picket_fence") ? "1" : "0"}>
        <rect x="6" y="252" width="170" height="26" fill="url(#wz-pk)" /><rect x="6" y="264" width="170" height="3" fill="#fff" stroke="#16212A" strokeOpacity=".2" strokeWidth=".6" />
      </g>
      <g className={`x ${x("wall") ? "on" : ""}`} data-x="wall" data-on={x("wall") ? "1" : "0"}>
        <rect x="224" y="258" width="170" height="18" fill="#E4DED2" stroke="#16212A" strokeOpacity=".2" /><rect x="222" y="254" width="174" height="5" fill="#C4BBA8" />
      </g>
    </svg>
  );
}
