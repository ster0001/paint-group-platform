import Link from "next/link";
import type { DeskCheckOutcome } from "@/lib/wizard/desk-check";

/**
 * The three outcomes §5 names — "fixes the price and sends it, asks a question
 * in-thread, or books a visit".
 *
 * Each is a LINK to the flow that already owns it, never a new one: prices are
 * changed in the builder, questions are asked in the thread the customer is
 * already in, visits are booked in the visit flow. A fourth place to change
 * money would be a fourth place for it to go wrong.
 *
 * The recommendation is highlighted and nothing more. An estimator can always
 * pick another — a recommendation that could not be overridden would be
 * self-serve wearing a person's name.
 */
export default function Outcomes({
  estimateId, accountId, recommended, eligible,
}: {
  estimateId: string;
  accountId: string | null;
  recommended: DeskCheckOutcome;
  eligible: boolean;
}) {
  const options: Array<{ key: DeskCheckOutcome; label: string; detail: string; href: string; disabled?: boolean }> = [
    {
      key: "fix",
      label: "Fix the price and send it",
      detail: eligible
        ? "Opens the builder. Check the numbers, then send — the customer gets it as a fixed price."
        : "This job is outside what we fix remotely, so send it only if you're overriding that.",
      href: `/quote?id=${estimateId}`,
    },
    {
      key: "ask",
      label: "Ask them a question",
      detail: "Opens their thread. Anything unclear is worth one message rather than a guess.",
      href: accountId ? `/crm/customers/${accountId}` : `/crm/today`,
    },
    {
      key: "visit",
      label: "Book a visit instead",
      detail: "Some jobs need eyes on them. Booking one is not a failure of this screen.",
      href: accountId ? `/crm/customers/${accountId}` : `/schedule`,
    },
  ];

  return (
    <section className="space-y-2" data-testid="desk-check-outcomes">
      <h2 className="text-sm font-medium text-gray-900">What now?</h2>
      {options.map((o) => (
        <Link
          key={o.key}
          href={o.href}
          data-testid={`outcome-${o.key}`}
          data-recommended={o.key === recommended ? "1" : undefined}
          className={`block rounded-md border p-3 transition ${
            o.key === recommended
              ? "border-gray-900 bg-gray-900 text-white"
              : "border-gray-200 bg-white hover:border-gray-400"
          }`}
        >
          <div className="text-sm font-medium">
            {o.label}
            {o.key === recommended && <span className="ml-2 text-xs font-normal opacity-70">suggested</span>}
          </div>
          <p className={`mt-0.5 text-xs ${o.key === recommended ? "opacity-80" : "text-gray-500"}`}>{o.detail}</p>
        </Link>
      ))}
    </section>
  );
}
