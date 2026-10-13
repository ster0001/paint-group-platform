import type { ActivityLine } from "@/lib/invoicing/activity";
import { OpenJobLink } from "./ActionsClient";
import { melbourneToday } from "@/lib/invoicing/derive";
import { money, shortDate } from "./labels";

/** The Melbourne calendar day of an instant (CLAUDE.md: never the UTC slice). */
const day = (iso: string) => shortDate(melbourneToday(new Date(iso)));

/** The Activity block (§6.7, Step 8a): lib/invoicing/activity.ts's lines, worded and dated here. */
export function ActivityFeed({ lines, addressOf }: { lines: ActivityLine[]; addressOf: Map<string, string> }) {
  if (!lines.length) return <div className="empty">No invoice activity yet.</div>;
  return (
    <div className="feed">
      {lines.map((l) => {
        const address = l.estimateId ? addressOf.get(l.estimateId) ?? null : null;
        return (
          <div className="fl" key={l.key} data-type={l.type}>
            <i className={`dot ${l.tone}`} />
            <div className="fb">
              <b>{l.title}</b>
              <small>{[l.invoiceLabel, l.amountCents !== null ? money(l.amountCents) : null, l.detail].filter(Boolean).join(" · ")}
                {address && l.estimateId ? <> · <OpenJobLink className="jl" estimateId={l.estimateId}>{address}</OpenJobLink></> : null}</small>
            </div>
            <span className="fd">{l.count > 1 ? `${day(l.firstAt)} – ${day(l.at)}` : day(l.at)}</span>
          </div>
        );
      })}
    </div>
  );
}
