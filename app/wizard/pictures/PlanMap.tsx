/**
 * The floor plan, drawn (UI refresh S2, brief §7.2 step 4; components doc §4)
 * — one block per room, sized by how big a room of that kind usually is.
 * Ported from the mockup's `drawPlan()`: bedrooms along the top, halls and
 * stairs through the middle, living, kitchen and wet areas along the bottom.
 *
 * A room left out is dashed. The room editor (S4) reuses this with "still to
 * check" (amber) and "checked" (cyan) — the states are classes, so one
 * drawing serves both. Replaced by the customer's real floorplan when there
 * is one. Decorative and `aria-hidden`.
 */
export type PlanRoom = {
  name: string;
  /** The room's kind (`roomTypeForName` / the plan's own type). */
  roomType: string;
  state: "on" | "off" | "todo" | "ok";
};

/** Roughly how big a room of each kind is, in m² — only the proportions of the drawing ride on it. */
const AREA: Record<string, number> = {
  bedroom: 12, living: 18, lounge: 18, family: 18, dining: 12, kitchen: 12, open_plan_kitchen_living: 30,
  bathroom: 5, ensuite: 4, wc: 2, laundry: 4, hallway: 10, entry: 6, stairs: 8, study: 9, storage: 3, garage: 30,
};
const row = (t: string) => (t === "bedroom" || t === "study" ? "top" : t === "hallway" || t === "entry" || t === "stairs" || t === "storage" ? "mid" : "bot");

export default function PlanMap({ rooms }: { rooms: PlanRoom[] }) {
  let top = rooms.filter((r) => row(r.roomType) === "top");
  let hall = rooms.filter((r) => row(r.roomType) === "mid");
  let bot = rooms.filter((r) => row(r.roomType) === "bot");
  if (!top.length && bot.length > 1) { top = bot.slice(0, Math.ceil(bot.length / 2)); bot = bot.slice(top.length); }
  if (top.length > 5) { bot = top.slice(5).concat(bot); top = top.slice(0, 5); }
  if (bot.length > 6) { hall = hall.concat(bot.slice(6)); bot = bot.slice(0, 6); }

  const X = 22, W = 356;
  const weight = (r: PlanRoom) => Math.max(Math.sqrt(AREA[r.roomType] ?? 10), 2);
  const cells: Array<{ r: PlanRoom; x: number; y: number; w: number; h: number }> = [];
  const line = (list: PlanRoom[], y: number, h: number) => {
    const tot = list.reduce((a, r) => a + weight(r), 0);
    let x = X;
    for (const r of list) { const w = (weight(r) / tot) * W; cells.push({ r, x, y, w, h }); x += w; }
  };
  const rows = [top, hall, bot].filter((a) => a.length);
  if (rows.length === 1) line(rows[0], 22, 256);
  else if (!hall.length) { line(top, 22, 128); line(bot, 150, 128); }
  else if (!top.length || !bot.length) { line(top.length ? top : bot, 22, 190); line(hall, 212, 66); }
  else { line(top, 22, 104); line(hall, 126, 46); line(bot, 172, 106); }

  const short = (name: string, w: number) => {
    let n = name;
    if (n.length > w / 6.4) n = n.replace(/ room$/i, "").replace(" / Meals", "").replace(/Stairwell & upper hall/i, "Stairs").replace(" & Entry", "").trim();
    if (n.length > w / 6.4) n = n.slice(0, Math.max(3, Math.floor(w / 7)));
    return n;
  };
  return (
    <svg className="wz-plan" viewBox="0 0 400 300" aria-hidden="true" data-testid="pic-plan">
      <rect x="14" y="14" width="372" height="272" rx="10" fill="#F7F9FA" stroke="#16212A" strokeOpacity=".35" strokeWidth="2" />
      {cells.map(({ r, x, y, w, h }) => (
        <g key={r.name} className={r.state} data-room={r.name} data-state={r.state}>
          <rect className="rm" x={x + 2} y={y + 2} width={w - 4} height={h - 4} rx="5" />
          <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle">{short(r.name, w)}</text>
          <g className="tk" transform={`translate(${x + w - 22},${y + 10})`}>
            <circle cx="6" cy="6" r="8" fill="#0A7C8E" />
            <path d="M2.5 6.3l2.4 2.4L9.7 3.9" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
      ))}
    </svg>
  );
}
