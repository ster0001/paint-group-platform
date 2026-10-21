import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { movementsTabOn } from "@/lib/movements/tabSwitch";
import { contextBlocks } from "@/lib/movements/evaluate";
import { loadMovementsWeek } from "@/lib/movements/load";
import { weekEnd, weekStartFrom } from "@/lib/movements/week";
import { isDateString, todayIso } from "@/lib/scheduling/dates";
import { THEME_COOKIE } from "@/lib/theme/cookie";
import { HOW_IT_WORKS_KEY } from "./howItWorksKey";
import MovementsScreen from "./MovementsScreen";
import { toSerial } from "./world";

export const dynamic = "force-dynamic";

/**
 * PC Command → Movements (brief §3.4, Session 4): the tray of chips and the lanes × days
 * board for paint, materials, gear and rubbish, plus the Sources view (one materials list,
 * three doors), Day (Session 5), Map (Session 6, needs the browser key) and Gear (Session 6).
 *
 * Staff-only: the console layout redirects anyone else. The week lives in the URL so the
 * data follows it; everything on screen is `lib/movements/evaluate.ts` over what
 * `loadMovementsWeek` read, and every change goes through app/pc/movements/actions.ts.
 */
export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ view?: string; week?: string; job?: string; movement?: string; day?: string; who?: string }> }) {
  const sp = await searchParams;
  const mapsOn = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY);
  const view = sp.view === "sources" ? "sources" : sp.view === "day" ? "day" : sp.view === "map" ? "map" : sp.view === "gear" ? "gear" : "week";
  // Day and Map views: the week is the one the chosen day sits in; no day → today's week.
  const day = sp.day && isDateString(sp.day) ? sp.day : view === "day" || view === "map" ? todayIso() : null;
  const weekStart = weekStartFrom(sp.week ?? (day ?? undefined), todayIso());
  const to = weekEnd(weekStart);
  // The switch and the week are read together (one round trip, not two in a row — the first
  // byte waits on this); a switched-off tab still redirects before anything is drawn.
  const [tabOn, week, cookieStore] = await Promise.all([movementsTabOn(await createClient()), loadMovementsWeek(weekStart, to), cookies()]);
  if (!tabOn) redirect("/pc");
  const ctx = contextBlocks(week.world);

  // Ruling 15: this tab's design is the light theme. A browser that has never chosen a theme
  // (no cookie) is set light BEFORE paint, and keeps it — the console toggle changes it.
  const hasThemeCookie = Boolean(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <>
      {!hasThemeCookie && (
        <script
          // Runs during parse: the `.pc` root is already in the DOM, the lanes are not yet painted.
          dangerouslySetInnerHTML={{ __html: `(function(){try{var r=document.querySelector('.pc');if(r)r.setAttribute('data-theme','light');document.cookie='${THEME_COOKIE}=light; path=/; max-age=31536000; samesite=lax';}catch(e){}})();` }}
        />
      )}
      {week.world.settings.showHowItWorks && (
        <script
          // The strip opens on a browser's first visit (HowItWorks.tsx reads localStorage in an
          // effect). Deciding that during parse, before paint, lets movements.css show it open
          // from the first frame, so the board underneath does not jump when hydration opens it.
          dangerouslySetInnerHTML={{ __html: `(function(){try{if(window.localStorage.getItem('${HOW_IT_WORKS_KEY}')!=='1'){var r=document.querySelector('.pc');if(r)r.setAttribute('data-how','open');}}catch(e){}})();` }}
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
        mapsOn={mapsOn}
      />
    </>
  );
}
