/**
 * The workmanship warranty, in ONE place.
 *
 * Tom approved these terms on 19 Sep 2026 ("i am happy to proceed so remove
 * watermark") with one change to the draft in
 * `docs/briefs/paint-group-workmanship-warranty.md`: clause 8 takes Option A —
 * the warranty is personal to the customer and does NOT transfer to a new
 * owner. Same ruling: two years, active for everybody, no per-estimate switch.
 *
 * Every surface that shows the warranty renders FROM HERE — the customer's
 * estimate (`/e/[token]`), the portal terms and the certificate. Never retype
 * a clause into a component: `lib/warranty/terms.contract.test.ts` is the
 * no-fork proof.
 */

/** The warranty term, in years. One number, used everywhere it is stated. */
export const WARRANTY_YEARS = 2;

/** Bumped whenever a clause changes, so a session report can say which text a customer was shown. */
export const WARRANTY_TERMS_VERSION = "2026-09-19";

export type WarrantyParty = {
  companyName: string;
  abn?: string;
  address?: string;
  phone?: string;
  email?: string;
};

export type WarrantyClause = { n: number; heading: string; body: string };

/** The promise in two sentences — the trust card, the estimate, the certificate. */
export function warrantyPromise(): string {
  return (
    "Every job we complete is covered by our workmanship warranty for two full years from the day " +
    "you sign off. If our workmanship lets you down in that time — paint peeling, flaking, blistering " +
    "or cracking because of how it was applied — we come back and put it right, at no cost to you. " +
    "That includes the labour and the materials."
  );
}

/** What the warranty does not reach, in one line, so the promise is honest where it is made. */
export function warrantyLimit(): string {
  return (
    "It doesn’t cover ordinary wear and tear, damage caused by others, or problems that come from the " +
    "building itself rather than our work — the full terms explain the difference in plain language."
  );
}

/** The Australian Consumer Law statement, which every surface that states the warranty must carry. */
export const ACL_LINE =
  "This warranty is in addition to your rights under the Australian Consumer Law, which no business can take away.";

/**
 * Tom, 19 Sep 2026 (second pass): "please have workmanship warranty as an
 * attachment with this information, rather than written directly on the
 * estimate." The printed quote records the FACT of the warranty and points at
 * the attachment, exactly the way the SWMS block points at its PDF — the terms
 * themselves are the attachment, not part of the quote.
 */
export function warrantyAttachmentLine(): string {
  return (
    "Every job we complete carries our workmanship warranty for two years from the day you sign off, " +
    "covering our preparation and application. It is personal to the customer named on this estimate " +
    "and does not transfer. The full terms are attached to your online estimate — open it and choose " +
    "“Warranty terms” beside the public liability card. " + ACL_LINE
  );
}

/**
 * The nine clauses, in order. Written to satisfy the mandatory content for a
 * warranty against defects (Competition and Consumer Regulations 2010, reg 90):
 * who gives it, what is covered, what we will do, the claim procedure, who
 * bears the expense, the period, and the prescribed consumer-guarantees text.
 */
export function warrantyClauses(party: WarrantyParty): WarrantyClause[] {
  const who = [
    `This warranty is given by ${party.companyName}`,
    party.abn ? ` (ABN ${party.abn})` : "",
    party.address ? ` of ${party.address}` : "",
    ".",
  ].join("");
  const contact = [party.phone, party.email].filter(Boolean).join(" · ");

  return [
    {
      n: 1,
      heading: "Who gives this warranty",
      body: `${who}${contact ? ` You can reach us on ${contact}.` : ""}`,
    },
    {
      n: 2,
      heading: "What this warranty covers",
      body:
        "We warrant our workmanship — the quality of our preparation and application — for a period of " +
        "two years from the date your project was signed off as complete. If, within that period, the " +
        "paintwork we applied fails because of the way we prepared or applied it, we will repair the " +
        "affected area at no cost to you. Failures of workmanship include: peeling, flaking or lifting of " +
        "the paint film from a properly paintable surface; blistering or bubbling caused by application; " +
        "cracking, crazing or wrinkling of the paint film caused by application; visible runs, sags or " +
        "misses present at completion and identified within the warranty period; and premature breakdown " +
        "of the coating where the correct preparation or the specified number of coats was not carried out.",
    },
    {
      n: 3,
      heading: "What we will do",
      body:
        "Where a failure of workmanship is confirmed, we will prepare and repaint the affected area, using " +
        "the same products and colours recorded in your paint register, so far as they remain available. If " +
        "the recorded product or colour has been discontinued, we will agree the nearest available match " +
        "with you before any work begins. We supply all labour and materials for warranty work at no " +
        "charge. Our aim is a repair you cannot see — where a touch-up would leave a visible patch, we will " +
        "repaint to the nearest natural break, such as the corner of a wall, so the finish remains uniform.",
    },
    {
      n: 4,
      heading: "What this warranty does not cover",
      body:
        "This warranty covers our workmanship. It does not cover problems that arise from causes outside " +
        "our work, including: ordinary wear and tear, scuffs, marks and household damage; damage caused by " +
        "any person other than us, including other trades; movement of the building — settling, shrinkage " +
        "or expansion — and any cracking of the substrate itself, including plaster cracking along joints; " +
        "moisture entering from outside the painted surface (leaks, rising damp, failed sealant or grout, " +
        "or condensation and mould arising from ventilation); timber decay, rust or corrosion originating " +
        "in the substrate, unless treating it was included in your scope of works; gradual fading, chalking " +
        "or sheen change of exterior coatings from sun and weather, within the paint manufacturer’s " +
        "published expectations; surfaces we identified in your estimate or work order as painted at your " +
        "request against our recommendation, or noted as having a pre-existing condition we could not " +
        "correct within the agreed scope; and paint or materials you supplied yourself — although our " +
        "workmanship in applying them remains covered. Where a paint product itself is defective, the paint " +
        "manufacturer’s own warranty applies, and we will help you make that claim.",
    },
    {
      n: 5,
      heading: "How to make a claim",
      body:
        "You can claim at any time within the warranty period, in whichever way suits you: through your " +
        "account — open your project, choose “Report an issue”, and attach a photo or two of what you’ve " +
        `noticed${party.phone ? `; by telephone on ${party.phone}` : ""}` +
        `${party.email ? `; or by email to ${party.email}` : ""}. Please tell us the property address, ` +
        "which room or surface is affected, and when you first noticed the problem. Photographs help us " +
        "respond faster, but they are not required — if you can’t photograph it, we will simply come and " +
        "look. We will acknowledge your claim within 2 business days and, where an inspection is needed, " +
        "offer you an inspection time within 10 business days.",
    },
    {
      n: 6,
      heading: "Cost of claiming",
      body:
        "Making a claim costs you nothing. We bear the cost of inspecting and carrying out warranty work. " +
        "You bear only your own incidental costs, if any, such as making the property available. If an " +
        "inspection finds the problem is not covered by this warranty, we will explain why, and give you an " +
        "honest price for fixing it if you’d like us to.",
    },
    {
      n: 7,
      heading: "When this warranty begins and ends",
      body:
        "The warranty period runs for two years from the date of practical completion — the day the project " +
        "is signed off in your account, or otherwise taken to be complete under your quote terms. The " +
        "completion date and the warranty expiry date are shown on your warranty card in your account.",
    },
    {
      // Tom, 19 Sep 2026: "Remove the ability to transfer a warranty."
      // Option A of the brief's §8 — personal to the customer, no transfer.
      n: 8,
      heading: "Transfer to a new owner",
      body:
        "This warranty is personal to the customer named on the estimate and does not transfer. If you sell " +
        "the property, the warranty does not pass to the new owner, and it cannot be assigned to anyone " +
        "else. Nothing in this clause affects rights a person has under the Australian Consumer Law.",
    },
    {
      n: 9,
      heading: "Your rights under the Australian Consumer Law",
      body:
        "Our services come with guarantees that cannot be excluded under the Australian Consumer Law. For " +
        "major failures with the service, you are entitled: to cancel your service contract with us; and to " +
        "a refund for the unused portion, or to compensation for its reduced value. You are also entitled " +
        "to be compensated for any other reasonably foreseeable loss or damage. If the failure does not " +
        "amount to a major failure, you are entitled to have problems with the service rectified in a " +
        "reasonable time and, if this is not done, to cancel your contract and obtain a refund for the " +
        "unused portion of the contract. The benefits given by this warranty are in addition to other " +
        "rights and remedies you have under law, which this warranty does not limit or replace. This " +
        "warranty does not require you to pay anything to make a claim, and it operates alongside — never " +
        "instead of — your consumer guarantees.",
    },
  ];
}
