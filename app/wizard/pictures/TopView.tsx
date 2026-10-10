/**
 * The house from above (UI refresh S5, brief §7.8; components doc §4) — the
 * picture beside the Sides step, and the "Your home from above" card in the
 * side-by-side editor. Four edges, the street at the bottom.
 *
 * States per side, as classes and `data-state`: "on" (being painted — thick
 * cyan), "off" (left off — grey dashed), and in the editor "todo" (amber,
 * still to check) and "ok" (cyan, checked). `onPick` makes an edge a target
 * (the editor opens that side); without it the drawing is decorative. The
 * edges carry `data-edge`, never `data-side` — that is the side cards' hook.
 */
export type TopSide = { key: "front" | "back" | "left" | "right"; label: string; state: "on" | "off" | "todo" | "ok" | "skip" };

const G: Record<TopSide["key"], [number, number, number, number, number, number]> = {
  front: [112, 226, 288, 226, 200, 250],
  back: [112, 56, 288, 56, 200, 42],
  left: [110, 58, 110, 224, 74, 146],
  right: [290, 58, 290, 224, 326, 146],
};

export default function TopView({ sides, onPick }: { sides: TopSide[]; onPick?: (key: TopSide["key"]) => void }) {
  return (
    <svg className="wz-top-view" viewBox="0 0 400 300" aria-hidden={onPick ? undefined : true} data-testid="pic-top">
      <rect x="0" y="266" width="400" height="34" fill="#DDE3E7" />
      <text className="street" x="200" y="288" textAnchor="middle">Street</text>
      <rect x="110" y="56" width="180" height="170" rx="3" fill="#fff" stroke="#16212A" strokeOpacity=".12" />
      <path d="M110 56l90 85 90-85M110 226l90-85 90 85" stroke="#16212A" strokeOpacity=".1" fill="none" />
      {sides.map((s) => {
        const g = G[s.key];
        return (
          <g key={s.key} className={s.state} data-edge={s.key} data-state={s.state}
            onClick={onPick ? () => onPick(s.key) : undefined} style={onPick ? { cursor: "pointer" } : undefined}>
            <line className="hit" x1={g[0]} y1={g[1]} x2={g[2]} y2={g[3]} />
            <line className="edge" x1={g[0]} y1={g[1]} x2={g[2]} y2={g[3]} />
            <text x={g[4]} y={g[5]} textAnchor="middle">{s.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
