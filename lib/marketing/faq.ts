/**
 * The eight FAQ entries (brief §4.12) — verbatim from the prototype; they
 * have been through the pricing/sign-off rulings, so change them there
 * first. One source array feeds both the <details> list and the FAQPage
 * JSON-LD.
 */
export const FAQS: ReadonlyArray<{ q: string; a: string }> = [
  { q: "What happens after I type my address?",
    a: "You answer a few questions about the property — what's being painted, roughly how big, the condition. Photos help but aren't required. A price range appears on screen. Save it and it's yours to come back to; nobody rings you unless you ask." },
  { q: "Is the price on screen my final price?",
    a: "It's a real range, and it gets tighter as you answer. The final price is always signed off with you by one of our people — a phone call for apartments, units and smaller jobs, a site visit for larger ones. Once it's signed off, that's the number on your invoice; anything extra found on site is priced and approved by you first." },
  { q: "Who does the painting?",
    a: "Our own trusted network — painters who are quality-checked, fully insured and used to working in people's homes and businesses. You'll see who's coming in your portal before the start date is locked in." },
  { q: "How soon can you start?",
    a: "Once your price is signed off, we'll give you the earliest start we can hold for a job that size — smaller interiors are usually quicker than whole-house or exterior work, which depends on the weather. You pick a date that suits from what's available." },
  { q: "Do I need to be home?",
    a: "Not while the painting happens — we'll agree access with you and send photo updates every day. The final walkthrough is done with you there, so we'll book it for a time that works." },
  { q: "What if you find something extra?",
    a: "It's raised as a variation with photos and a price. Nothing extra starts, and nothing extra lands on the invoice, until you've tapped Approve." },
  { q: "When do I pay?",
    a: "A deposit when your price is signed off, and the balance after you've walked the job with us and approved it — not before." },
  { q: "What does the warranty cover?",
    a: "Our workmanship, for two years from sign-off. If the finish fails because of how it was applied, we come back and fix it. The warranty and our $20M public liability certificate sit in your portal." },
];

export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question", name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
