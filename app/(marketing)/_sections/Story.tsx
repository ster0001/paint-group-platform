import ProgressStory from "../_components/ProgressStory";

/**
 * §4.7 — "How you're kept informed": the 22-second scripted story of one
 * job as the customer sees it on their phone. Playback, replay, pause on
 * blur and the reduced-motion end state all live in ProgressStory; the
 * timeline itself is lib/marketing/progressStory (tested for drift).
 */
export default function Story({ photos = [] }: { photos?: string[] }) {
  return (
    <section className="sec light warm" id="story">
      <ProgressStory photos={photos} />
    </section>
  );
}
