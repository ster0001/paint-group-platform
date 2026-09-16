import type { ReadFailure } from "@/lib/invoicing/loadFailure";

/**
 * The one place the read-failure banner is drawn.
 *
 * Three screens need it now — the dashboard, a job's money view and the invoice
 * document — and a money screen that tells you its figures are wrong must say so
 * the same way every time, or the quiet version gets trusted. Presentational
 * only, so it renders in a server page and inside the client shells alike.
 */
export default function ReadFailureNotice({ failure }: { failure: ReadFailure }) {
  return (
    <div className="banner bad" data-testid="invoices-load-error">
      <div className="i">▲</div>
      <p><b>{failure.headline}</b><br />{failure.detail}</p>
    </div>
  );
}
