import { runStandardsReminderSweep } from "@/lib/automations/sweeps/standardsReminders";
import { runPainterStatusSweep } from "@/lib/painterStatus/run";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runSweep } from "@/lib/campaigns/runSweep";
import { releaseDueHolds } from "@/lib/automations/dispatch";
import { runMoneySignoffSweep } from "@/lib/automations/sweeps/moneySignoff";
import { runJobReminderSweep } from "@/lib/automations/sweeps/jobReminders";
import { reportError } from "@/lib/monitoring/report";

/**
 * The campaign sweep, on a schedule.
 *
 * Enrols people and QUEUES messages. It sends nothing — every message it
 * writes sits in `queued` until a person approves it on the queue screen. That
 * is the same rule the wo-sweep follows: a cron may draft, only a human may
 * send.
 *
 * Refuses everything without CRON_SECRET rather than falling back to running
 * unauthenticated, because it writes.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;   // Vercel Pro (decision 6.9, 7 Sep)

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no" }, { status: 401 });
  }

  const db = createServiceClient();
  if (!db) return NextResponse.json({ error: "no service client" }, { status: 503 });

  try {
    const now = new Date();
    // `?only=reminders` (the e2e, a hand run) skips the campaign engine.
    const params = new URL(req.url).searchParams;
    const only = params.get("only");
    const outcomes = only === "reminders" || only === "standards" || only === "moments" || only === "status" ? [] : await runSweep(db, now);
    // Session 3: money and sign-off reminder ladders, every half hour.
    // `?force=1` (the e2e, a deliberate hand run) ignores the offer reminder's
    // 22:00–04:59 Melbourne night window — the same word the wo-sweep uses.
    // Nothing else is forced: an offer still has to be live and its rung due.
    const reminders = only === "moments" || only === "standards" || only === "status" ? null : await runMoneySignoffSweep(db, now, { ignoreOfferWindow: params.get("force") === "1" });
    // Tom, 25 Sep: the painter's "update your work order" texts — day 1,
    // mid-job and last-day moments by job length (lib/workorder/jobRhythm.ts).
    const jobReminders = only === "standards" || only === "status" ? null : await runJobReminderSweep(db, now);
    // Standards Step 2: "please confirm the finish standards" on days 2, 4 and 6
    // after the invite, and the new-version message (lib/standards/acks.ts).
    const standards = only === "moments" || only === "status" ? null : await runStandardsReminderSweep(db, now);
    // Step 5: the evaluator, for painters whose jobs saw an event in the last
    // 35 minutes (a tick, a check, a call back, a sign-off) — every trigger
    // in §4.4 is an event. `?only=status` runs every painter.
    const status = only === "status"
      ? await runPainterStatusSweep(db, { now })
      : await runPainterStatusSweep(db, { now, since: new Date(now.getTime() - 35 * 60_000) });
    // Session 1: automatic job messages held for quiet hours or the daily
    // cap are released here — every 30 minutes, so a held text goes at the
    // opening, not at the next daily sweep. Only messages the office already
    // approved (or never asked to approve) come this way.
    const released = await releaseDueHolds(db, now);
    return NextResponse.json({
      ok: true,
      swept: outcomes.length,
      outcomes,
      released,
      reminders,
      jobReminders,
      standards,
      status: { ran: status.ran, failed: status.failed },
      note: "Campaign steps are queued only. Held automatic messages whose time has come are sent.",
    });
  } catch (e) {
    reportError(e, { where: "cron.campaignSweep" });
    return NextResponse.json({ error: "sweep failed" }, { status: 500 });
  }
}
