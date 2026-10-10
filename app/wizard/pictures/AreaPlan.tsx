/**
 * The area plan (UI refresh S7, brief §7.10; components doc §4) — the picture
 * beside a commercial Areas and Job step: one block per kind of area, sized by
 * its count, named in the segment's own words ("Private offices × 4"). An
 * "also being painted" area is a slim block along the bottom. Every label
 * arrives from the segment row; nothing here names an area itself.
 * Decorative (`aria-hidden`) — the counts are in words on the left.
 */
export type AreaBlock = { key: string; label: string; count: number; also?: boolean };

export default function AreaPlan({ blocks, highlight = null }: { blocks: AreaBlock[]; highlight?: string | null }) {
  const main = blocks.filter((b) => !b.also && b.count > 0);
  const also = blocks.filter((b) => b.also);
  const X0 = 20, W = 360, Y0 = 20, GAP = 6;
  const alsoH = also.length ? 40 : 0;
  const avail = 260 - alsoH - (also.length ? GAP : 0) - GAP * Math.max(0, main.length - 1);
  // One full-width row per kind of area, taller for a bigger count — the name always fits.
  const weight = (b: AreaBlock) => 1 + Math.min(b.count, 12) / 4;
  const sum = main.reduce((n, b) => n + weight(b), 0) || 1;
  const laid = main.reduce<Array<AreaBlock & { y: number; h: number }>>((acc, b) => {
    const y = acc.length ? acc[acc.length - 1].y + acc[acc.length - 1].h + GAP : Y0;
    return [...acc, { ...b, y, h: Math.max(46, (weight(b) / sum) * avail) }];
  }, []);
  const cellsX = X0 + 8;
  return (
    <svg className="wz-areaplan" viewBox="0 0 400 300" aria-hidden="true" data-testid="pic-areas">
      {laid.map(({ y, h, ...b }) => {
        const cells = Math.min(b.count, 12);
        const cw = (X0 + W - 8 - cellsX) / Math.max(cells, 1);
        return (
          <g key={b.key} className={`blk ${highlight === b.key ? "hl" : ""}`} data-area={b.key} data-count={b.count}>
            <rect className="room" x={X0} y={y} width={W} height={h} rx="5" />
            <text x={X0 + 10} y={y + 17}>{b.label.length > 40 ? `${b.label.slice(0, 39)}…` : b.label} <tspan className="n">× {b.count}</tspan></text>
            {Array.from({ length: cells }, (_, i) => (
              <rect key={i} className="cell" x={cellsX + i * cw + 2} y={y + 24} width={Math.max(4, cw - 4)} height={h - 30} rx="2" />
            ))}
          </g>
        );
      })}
      {also.map((b, i) => {
        const w = W / also.length;
        const y = Y0 + 260 - alsoH;
        return (
          <g key={b.key} className="blk also" data-area={b.key}>
            <rect className="room" x={X0 + i * w + 2} y={y} width={w - 4} height={alsoH} rx="5" />
            <text x={X0 + i * w + 10} y={y + 25}>{b.label.length > 14 ? `${b.label.slice(0, 13)}…` : b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
