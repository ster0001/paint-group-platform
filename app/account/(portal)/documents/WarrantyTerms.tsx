/**
 * The 2-year workmanship warranty terms, rendered from
 * docs/briefs/paint-group-workmanship-warranty.md (§2). DRAFT-watermarked
 * until Tom marks them legally approved in Settings → Documents. The §8
 * transferability decision is unresolved, so that clause renders as
 * "being finalised" rather than showing options to a customer.
 */
export default function WarrantyTerms({
  approved,
  companyName,
  abn,
  address,
  phone,
  email,
}: {
  approved: boolean;
  companyName: string;
  abn: string;
  address: string;
  phone: string;
  email: string;
}) {
  const contact = [phone, email].filter(Boolean).join(" · ");
  return (
    <div className={approved ? "" : "draftwrap"}>
      <div className="card">
        <h3>{companyName} Workmanship Warranty</h3>

        <h2>1 · Who gives this warranty</h2>
        <p className="sub">
          This warranty is given by {companyName}{abn ? ` (ABN ${abn})` : ""}{address ? ` of ${address}` : ""}.
          {contact ? ` ${contact}.` : ""}
        </p>

        <h2>2 · What this warranty covers</h2>
        <p className="sub">
          We warrant our workmanship — the quality of our preparation and application — for
          a period of two years from the date your project was signed off as complete. If,
          within that period, the paintwork we applied fails because of the way we prepared
          or applied it, we will repair the affected area at no cost to you. Failures of
          workmanship include: peeling, flaking or lifting of the paint film from a properly
          paintable surface; blistering or bubbling caused by application; cracking, crazing
          or wrinkling of the paint film caused by application; visible runs, sags or misses
          present at completion and identified within the warranty period; and premature
          breakdown of the coating where the correct preparation or the specified number of
          coats was not carried out.
        </p>

        <h2>3 · What we will do</h2>
        <p className="sub">
          Where a failure of workmanship is confirmed, we will prepare and repaint the
          affected area, using the same products and colours recorded in your paint
          register, so far as they remain available. If the recorded product or colour has
          been discontinued, we will agree the nearest available match with you before any
          work begins. We supply all labour and materials for warranty work at no charge.
          Our aim is a repair you cannot see — where a touch-up would leave a visible patch,
          we will repaint to the nearest natural break, such as the corner of a wall, so the
          finish remains uniform.
        </p>

        <h2>4 · What this warranty does not cover</h2>
        <p className="sub">
          This warranty covers our workmanship. It does not cover problems that arise from
          causes outside our work, including: ordinary wear and tear, scuffs, marks and
          household damage; damage caused by any person other than us, including other
          trades; movement of the building — settling, shrinkage or expansion — and any
          cracking of the substrate itself, including plaster cracking along joints;
          moisture entering from outside the painted surface (leaks, rising damp, failed
          sealant or grout, or condensation and mould arising from ventilation); timber
          decay, rust or corrosion originating in the substrate, unless treating it was
          included in your scope of works; gradual fading, chalking or sheen change of
          exterior coatings from sun and weather, within the paint manufacturer&rsquo;s
          published expectations; surfaces we identified in your estimate or work order as
          painted at your request against our recommendation, or noted as having a
          pre-existing condition we could not correct within the agreed scope; and paint or
          materials you supplied yourself — although our workmanship in applying them
          remains covered. Where a paint product itself is defective, the paint
          manufacturer&rsquo;s own warranty applies, and we will help you make that claim.
        </p>

        <h2>5 · How to make a claim</h2>
        <p className="sub">
          You can claim at any time within the warranty period, in whichever way suits you:
          through your account — open your project, choose &ldquo;Report an issue&rdquo;,
          and attach a photo or two of what you&rsquo;ve noticed{phone ? `; by telephone on ${phone}` : ""}
          {email ? `; or by email to ${email}` : ""}. Please tell us the property address,
          which room or surface is affected, and when you first noticed the problem.
          Photographs help us respond faster, but they are not required — if you can&rsquo;t
          photograph it, we will simply come and look. We will acknowledge your claim within
          2 business days and, where an inspection is needed, offer you an inspection time
          within 10 business days.
        </p>

        <h2>6 · Cost of claiming</h2>
        <p className="sub">
          Making a claim costs you nothing. We bear the cost of inspecting and carrying out
          warranty work. You bear only your own incidental costs, if any, such as making the
          property available. If an inspection finds the problem is not covered by this
          warranty, we will explain why, and give you an honest price for fixing it if
          you&rsquo;d like us to.
        </p>

        <h2>7 · When this warranty begins and ends</h2>
        <p className="sub">
          The warranty period runs for two years from the date of practical completion —
          the day the project is signed off in your account, or otherwise taken to be
          complete under your quote terms. The completion date and the warranty expiry date
          are shown on your warranty card above.
        </p>

        <h2>8 · Transfer to a new owner</h2>
        <p className="sub">This clause is being finalised — ask us and we&rsquo;ll tell you where it stands.</p>

        <h2>9 · Your rights under the Australian Consumer Law</h2>
        <p className="sub">
          Our services come with guarantees that cannot be excluded under the Australian
          Consumer Law. For major failures with the service, you are entitled: to cancel
          your service contract with us; and to a refund for the unused portion, or to
          compensation for its reduced value. You are also entitled to be compensated for
          any other reasonably foreseeable loss or damage. If the failure does not amount
          to a major failure, you are entitled to have problems with the service rectified
          in a reasonable time and, if this is not done, to cancel your contract and obtain
          a refund for the unused portion of the contract. The benefits given by this
          warranty are in addition to other rights and remedies you have under law, which
          this warranty does not limit or replace. This warranty does not require you to
          pay anything to make a claim, and it operates alongside — never instead of —
          your consumer guarantees.
        </p>
      </div>
    </div>
  );
}
