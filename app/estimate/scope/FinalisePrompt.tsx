"use client";

/**
 * Tom, 14 Sep (tighten batch, item 2): "Finalise my price" before everything is
 * answered prompts them to finish — or to book a time instead. Both editors
 * share the one sheet so the words can never drift between inside and outside.
 */
export default function FinalisePrompt({ open, onAnswer, onBook, onClose }: {
  open: boolean;
  onAnswer: () => void;
  onBook: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="wz-sheetback" role="dialog" aria-modal="true" aria-label="A few questions left" data-testid="finalise-prompt" onClick={onClose}>
      <div className="wz-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Nearly there</h2>
        <p className="wz-sub">Please answer the remaining questions to finalise your price, or book in a time.</p>
        <div className="wz-sheet-row">
          <button type="button" className="wz-btn" onClick={onAnswer} data-testid="prompt-answer">Answer the questions</button>
          <button type="button" className="wz-btn wz-bs2" onClick={onBook} data-testid="prompt-book">Book a time</button>
        </div>
        <button type="button" className="wz-sheet-close" onClick={onClose}>NOT NOW</button>
      </div>
    </div>
  );
}
