import { cookies } from "next/headers";
import { contextBlocks } from "@/lib/movements/evaluate";
import { loadMovementsWeek } from "@/lib/movements/load";
import { weekEnd, weekStartFrom } from "@/lib/movements/week";
import { isDateString, todayIso } from "@/lib/scheduling/dates";
import { THEME_COOKIE } from "@/lib/theme/cookie";
import MovementsScreen from "./MovementsScreen";
import { toSerial } from "./world";

export const dynamic = "force-dynamic";

/**
 * PC Command → Movements (brief §3.4, Session 4): the tray of chips and the lanes × days
 * board for paint, materials, gear and rubbish, plus the Sources view (one materials list,
 * three doors). Day, Map and Gear are later sessions — no tabs for them yet.
 *
 * Staff-only: the console layout redirects anyone else. The week lives in the URL so the
 * data follows it; everything on screen is `lib/movements/evaluate.ts` over what
 * `loadMovementsWeek` read, and every change goes through app/pc/movements/actions.ts.
 */
export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ view?: string; week?: string; job?: string; movement?: string; day?: string; who?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === "sources" ? "sources" : sp.view === "day" ? "day" : sp.view === "gear" ? "gear" : "week";
  // Day view (Session 5): the week is the one the chosen day sits in; no day → today's week.
  const day = sp.day && isDateString(sp.day) ? sp.day : view === "day" ? todayIso() : null;
  const weekStart = weekStartFrom(sp.week ?? (day ?? undefined), todayIso());
  const to = weekEnd(weekStart);
  const week = await loadMovementsWeek(weekStart, to);
  const ctx = contextBlocks(week.world);

  // Ruling 15: this tab's design is the light theme. A browser that has never chosen a theme
  // (no cookie) is set light BEFORE paint, and keeps it — the console toggle changes it.
  const hasThemeCookie = Boolean((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <>
      {!hasThemeCookie && (
        <script
          // Runs during parse: the `.pc` root is already in the DOM, the lanes are not yet painted.
          dangerouslySetInnerHTML={{ __html: `(function(){try{var r=document.querySelector('.pc');if(r)r.setAttribute('data-theme','light');document.cookie='${THEME_COOKIE}=light; path=/; max-age=31536000; samesite=lax';}catch(e){}})();` }}
        />
      )}
      <MovementsScreen
        world={toSerial(week.world)}
        ctx={ctx}
        failures={week.failures}
        materialLines={week.materialLines}
        jobExtras={week.jobExtras}
        view={view}
        weekStart={weekStart}
        jobParam={sp.job ?? null}
        movementParam={sp.movement ?? null}
        dayParam={day}
        whoParam={sp.who ?? null}
      />
    </>
  );
}
