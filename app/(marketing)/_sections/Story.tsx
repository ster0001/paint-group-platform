/**
 * §4.7 — "How you're kept informed". Session 5 ships the STATIC END STATE
 * (the reduced-motion fallback the brief specifies: Day 5, every area done,
 * signed off, the eight captions listed). Session 6 replaces the phone's
 * contents with the 22-second scripted timeline and keeps this markup as
 * its reduced-motion branch. The phone frame is aria-hidden; the captions
 * are the accessible text.
 */
export const STORY_CAPTIONS = [
  "Monday, 7:31am — Felipe's on site.",
  "You get a message before the first brush touches a wall.",
  "Photos from the site, every day.",
  "Every area ticked off as it's finished — no guessing.",
  "An update in plain words at the end of each day.",
  "Anything extra is priced and approved by you before it starts.",
  "Then you walk it with us, room by room.",
  "You sign off. Then you pay.",
];

const AREAS = ["Living room", "Hallway", "Main bedroom", "Bedroom 2", "Kitchen"];

export default function Story() {
  return (
    <section className="sec light warm" id="story">
      <div className="wrap storywrap">
        <div className="storycopy">
          <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }}>Your portal · one job, start to finish · demo data</div>
          <h2>Watch it happen from wherever you are.</h2>
          <p className="lead" style={{ marginTop: 14 }}>This is what five days looks like from your phone.</p>
          <ol className="capsr static" data-testid="story-captions">
            {STORY_CAPTIONS.map((c) => <li key={c}>{c}</li>)}
          </ol>
        </div>
        <div className="device" aria-hidden="true" data-testid="story-phone">
          <div className="notch" />
          <div className="ptop">
            <div><b>12 Elm Street, Northcote</b><div className="mono" style={{ color: "var(--color-muted)" }}>Interior · 4 rooms + hallway · $9,180 inc. GST</div></div>
            <span className="pill green">Day 5 of 5</span>
          </div>
          <div className="ptrack"><i style={{ width: "100%" }} /></div>
          <div className="pareas">
            {AREAS.map((a) => (
              <div key={a} className="parea" data-s="done"><span><b>{a}</b><small>Walls ✓ Ceiling ✓ Trim ✓</small></span><span className="state done">Done</span></div>
            ))}
          </div>
          <div className="psign on">
            <div className="mono" style={{ color: "var(--color-emerald)" }}>Signed off · 12 Elm Street</div>
            <svg viewBox="0 0 260 70" className="sig" aria-hidden="true"><path d="M8 48 C 30 10, 48 62, 70 30 S 110 60, 130 28 S 170 10, 190 44 S 230 60, 252 22" fill="none" stroke="#EDF0F2" strokeWidth="2.5" strokeLinecap="round" /></svg>
            <div className="row"><span>Final invoice</span><span className="money">$9,180</span></div>
            <small style={{ color: "var(--color-muted)" }}>inc. GST · due now · thank you</small>
          </div>
        </div>
      </div>
    </section>
  );
}
