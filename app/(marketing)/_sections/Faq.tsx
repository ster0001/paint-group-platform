import FaqList from "../_components/FaqList";

/** §4.12 — the questions people ask before they type their address. */
export default function Faq() {
  return (
    <section className="sec light warm" id="faq">
      <div className="wrap">
        <h2>Questions people ask before they type their address.</h2>
        <FaqList />
      </div>
    </section>
  );
}
