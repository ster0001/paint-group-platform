import TelLink from "../_components/TelLink";
import { HOURS_LINE, PHONE_DISPLAY } from "@/lib/marketing/site";

/** §4.3 — four white cards on warm, copy verbatim from the prototype. */
export default function HowItWorks() {
  return (
    <section className="sec light warm" id="how">
      <div className="wrap">
        <h2>Four steps. You&rsquo;re in charge of every one.</h2>
        <div className="grid4">
          <div className="card"><span className="n">01</span><h3>See your price</h3><p>Type your address, answer a few questions, add photos if you have them. A price range appears on screen. About ten minutes.</p></div>
          <div className="card"><span className="n">02</span><h3>We confirm it with you</h3><p>The more you tell us, the tighter the range. Our estimator will go through all of the details with you in person, or over the phone to finalise your offer.</p></div>
          <div className="card"><span className="n">03</span><h3>Pick your dates</h3><p>Once the price is signed off, choose a start that suits you. We confirm your painter before we lock it in. You&rsquo;ll know who&rsquo;s coming.</p></div>
          <div className="card"><span className="n">04</span><h3>Sign off, then pay</h3><p>Receive regular photo updates in your portal. We will organise a walkthrough with you at the end to sign off your job. Don&rsquo;t pay for any areas you aren&rsquo;t happy with until you are truly satisfied.</p></div>
        </div>
        <div className="phone-row">
          Rather talk to a person first? <b><TelLink where="how">Call {PHONE_DISPLAY}</TelLink></b><span>{HOURS_LINE}</span>
        </div>
      </div>
    </section>
  );
}
