import { permanentRedirect } from "next/navigation";

/**
 * The timeline moved into the Projects console — scheduling is the first step
 * of the job workflow, not a separate corner of the app. Old links, bookmarks
 * and specs still land somewhere real rather than on a 404.
 */
export default function ScheduleMoved() {
  permanentRedirect("/pc/schedule");
}
