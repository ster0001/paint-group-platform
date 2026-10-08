import Link from "next/link";
import TrafficLight from "@/app/components/status/TrafficLight";
import { COLOUR_NAME, homeSubline } from "@/lib/painterStatus/copy";
import type { MyStatus } from "@/lib/painterStatus/mine";

/**
 * Home: the status card (brief §7). The lit lamp, the status in words, one
 * line on what it gets them, the steps to Green when not Green. The whole
 * card opens My status. Rendered only when the painter has a row they may
 * read — an employed painter who never led a job, or every painter while the
 * office keeps status staff-only, sees nothing here.
 */
export default function StatusCard({ status, lead, greenRun = 4 }: { status: MyStatus; lead: boolean; greenRun?: number }) {
  const lit = Math.min(status.streak, greenRun);
  return (
    <Link href="/portal/status" className={`card statuscard st-${status.colour}`} data-testid="status-card" data-colour={status.colour}>
      <TrafficLight colour={status.colour} />
      <div className="plain grow">
        <div className="eyebrow">{lead ? "Your status · jobs you led" : "Your status"}</div>
        <div className="statusname" data-testid="status-word">{COLOUR_NAME[status.colour]}</div>
        <div className="small">{homeSubline(status.colour, status.streak, greenRun, lead)}</div>
        {status.colour !== "green" && (
          <div className="ststeps" aria-label={`${lit} of ${greenRun} clean jobs in a row`}>
            {Array.from({ length: greenRun }, (_, i) => <i key={i} className={i < lit ? "on" : ""} />)}
          </div>
        )}
        <span className="link">See your score ›</span>
      </div>
    </Link>
  );
}
