import { requireContractor } from "@/lib/contractor/session";
import { listContractorOffers } from "@/lib/contractor/offers";
import { effectiveState, isLive } from "@/lib/scheduling/offers";
import Placeholder from "../Placeholder";
import OfferCard from "./OfferCard";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const { contractor } = await requireContractor();
  const offers = contractor ? await listContractorOffers(contractor.id) : [];

  const live = offers.filter((o) => isLive(effectiveState(o.offer)));
  const settled = offers.filter((o) => !isLive(effectiveState(o.offer)));

  if (offers.length === 0) {
    return (
      <Placeholder
        title="Pending requests"
        slab="Respond within the countdown — offers expire"
        icon="◔"
        heading="No offers yet"
        body="When Paint Group offers you a job it appears here with the dates, hours allowance, your price and a 24-hour clock to accept, propose a new date, or decline. Until you accept, you'll only see the suburb — never the customer's full address."
        soon="Waiting on your first offer"
      />
    );
  }

  return (
    <div className="wrap">
      <h1>Pending requests</h1>
      <p className="slab">Respond within the countdown — offers expire</p>

      {live.map((o) => (
        <OfferCard key={o.offer.id} offer={o.offer} woRef={o.woRef} doc={o.doc} />
      ))}

      {live.length === 0 && (
        <div className="empty">
          <i aria-hidden>◔</i>
          <b>Nothing waiting on you</b>
          You&rsquo;ve answered everything Paint Group has sent. Past offers are below.
        </div>
      )}

      {settled.length > 0 && (
        <>
          <p className="slab" style={{ marginTop: 18 }}>Earlier offers</p>
          {settled.map((o) => (
            <OfferCard key={o.offer.id} offer={o.offer} woRef={o.woRef} doc={o.doc} />
          ))}
        </>
      )}
    </div>
  );
}
