/**
 * The warehouse, inside (UI refresh S7, brief §7.10; components doc §4) — the
 * picture beside the Building and Job steps of the warehouse pattern. Each
 * ticked surface (`data-s`, `data-on`) takes its fresh coat: the walls, the
 * underside of the roof, the steel, roller and personnel doors (as many as
 * counted, up to a few), bollards, line marking, offices and a mezzanine. The
 * height label follows the roof-height answer. Decorative and `aria-hidden`.
 */
export default function WarehousePicture({ surfaces, heightLabel, rollerDoors, personnelDoors, offices }: {
  surfaces: readonly string[];
  heightLabel: string;
  rollerDoors: number;
  personnelDoors: number;
  offices: number;
}) {
  const on = (k: string) => surfaces.includes(k);
  const cls = (k: string, extra = "") => `s s-${k} ${on(k) ? "on" : ""} ${extra}`;
  const rollers = Math.min(3, on("roller") ? Math.max(1, rollerDoors) : 2);
  const pdoors = Math.min(2, on("personnel") ? Math.max(1, personnelDoors) : 1);
  return (
    <svg className="wz-warehouse" viewBox="0 0 400 300" aria-hidden="true" data-testid="pic-warehouse">
      {/* the underside of the roof and its trusses */}
      <polygon className={cls("roof")} data-s="roof" data-on={on("roof") ? "1" : "0"} points="20,70 200,22 380,70 380,84 20,84" />
      <g className={cls("steel", "truss")} data-s="steel" data-on={on("steel") ? "1" : "0"}>
        <path d="M20 84L200 36L380 84M80 84L110 61M140 84L150 47M260 84L250 47M320 84L290 61" fill="none" strokeWidth="3" />
        <rect x="70" y="84" width="7" height="166" /><rect x="196" y="84" width="7" height="166" /><rect x="323" y="84" width="7" height="166" />
      </g>
      {/* the back wall, in panels */}
      <rect className={cls("walls")} data-s="walls" data-on={on("walls") ? "1" : "0"} x="20" y="84" width="360" height="166" />
      <path d="M80 84v166M140 84v166M200 84v166M260 84v166M320 84v166" stroke="#16212A" strokeOpacity=".08" />
      {/* the height, from the answer */}
      <g className="hgt"><path d="M392 86V248M388 86h8M388 248h8" /><text x="388" y="170" textAnchor="end" transform="rotate(-90 388 170)">{heightLabel}</text></g>
      {/* roller doors */}
      {Array.from({ length: rollers }, (_, i) => (
        <g key={`r${i}`} className={cls("roller")} data-s="roller" data-on={on("roller") ? "1" : "0"}>
          <rect x={92 + i * 64} y="150" width="52" height="100" />
          <path d={`M${92 + i * 64} 162h52M${92 + i * 64} 174h52M${92 + i * 64} 186h52M${92 + i * 64} 198h52M${92 + i * 64} 210h52M${92 + i * 64} 222h52M${92 + i * 64} 234h52`} className="slats" />
        </g>
      ))}
      {/* personnel doors */}
      {Array.from({ length: pdoors }, (_, i) => (
        <rect key={`p${i}`} className={cls("personnel")} data-s="personnel" data-on={on("personnel") ? "1" : "0"} x={26 + i * 22} y="198" width="18" height="52" />
      ))}
      {/* offices inside, and a mezzanine over them */}
      <g className={`x ${on("offices") ? "on" : ""}`} data-s="offices" data-on={on("offices") ? "1" : "0"}>
        <rect className={cls("offices")} x="290" y="176" width="78" height="74" />
        {Array.from({ length: Math.min(3, Math.max(1, offices)) }, (_, i) => <rect key={i} className="glass" x={296 + i * 24} y="190" width="18" height="22" />)}
      </g>
      <g className={`x ${on("mezz") ? "on" : ""}`} data-s="mezz" data-on={on("mezz") ? "1" : "0"}>
        <rect className={cls("mezz")} x="284" y="164" width="90" height="8" /><path d="M286 156h86M290 156v8M310 156v8M330 156v8M350 156v8M370 156v8" className="rail" />
      </g>
      <g className={`x ${on("amenities") ? "on" : ""}`} data-s="amenities" data-on={on("amenities") ? "1" : "0"}>
        <rect className={cls("amenities")} x="290" y="100" width="78" height="48" /><text x="329" y="128" textAnchor="middle" className="lbl">WC</text>
      </g>
      {/* the floor, its line marking and bollards */}
      <rect x="0" y="250" width="400" height="50" fill="#C9CFD3" />
      <g className={`x ${on("lines") ? "on" : ""}`} data-s="lines" data-on={on("lines") ? "1" : "0"}>
        <path d="M20 270h360M20 290h360" className="line" />
      </g>
      <g className={`x ${on("bollards") ? "on" : ""}`} data-s="bollards" data-on={on("bollards") ? "1" : "0"}>
        <rect className="bol" x="82" y="232" width="8" height="22" rx="3" /><rect className="bol" x="146" y="232" width="8" height="22" rx="3" /><rect className="bol" x="210" y="232" width="8" height="22" rx="3" />
      </g>
    </svg>
  );
}
