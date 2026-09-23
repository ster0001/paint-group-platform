"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFinishLevel } from "../../actions";
import FinishChip from "@/app/components/FinishChip";
import {
  CORRECTABLE_FINISH_MODIFIERS, FINISH_LEVELS, finishFromModifier,
} from "@/lib/workorder/finish";

/**
 * The level of finish on a job sheet that is already out (Tom, 23 Sep 2026).
 *
 * A job sold at Level 2 and priced at Level 3 went out telling the painter
 * PG-3 — full prep, filled, sanded, sealed, caulked — and nothing could change
 * it: the snapshot is written only from the frozen accepted estimate, and the
 * revision builder writes the working scope, which no reader of the job sheet
 * has ever looked at. This is the door.
 *
 * It changes the DOCUMENT, not the money. The multiplier is priced and signed
 * as a variation in the revision builder, which is what keeps the ledger's
 * "accepted + Σ signed variations" arithmetic exact — so the card says so
 * rather than letting anyone assume the price followed.
 */
export default function FinishLevelCard({
  workOrderId, finishCode, levelOfFinish, overriddenAreas,
}: {
  workOrderId: string;
  /** The job's current contractor standard, off the snapshot. */
  finishCode: string | null;
  /** The rate-card label frozen on the sheet, e.g. "Level 3 — Good. Full prep…". */
  levelOfFinish: string;
  /** Areas carrying a standard of their own — they do not follow the job. */
  overriddenAreas: string[];
}) {
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current = savedCode ?? finishCode;
  const level = current ? FINISH_LEVELS[current as keyof typeof FINISH_LEVELS] : null;

  function save() {
    if (!choice) { setMessage("Pick the level this job is actually being done to."); return; }
    setMessage(null);
    startTransition(async () => {
      const result = await setFinishLevel({ workOrderId, modifierCode: choice });
      setMessage(result.message ?? null);
      if (result.ok) {
        setSavedCode(finishFromModifier(choice));
        setChoice("");
        router.refresh();
      }
    });
  }

  return (
    <div className="card" style={{ marginTop: 8 }} data-testid="finish-level-card">
      <h3>Level of finish</h3>
      <p className="note" data-testid="finish-level-current">
        This job sheet holds the painter to{" "}
        {current ? <FinishChip code={current} /> : <b>no stated level</b>}
        {level ? ` · ${level.name} — ${level.summary}` : ""}
        {levelOfFinish ? ` (priced as ${levelOfFinish})` : ""}
      </p>
      <p className="note">
        Changing it here rewrites the sheet the painter reads and every area that
        follows the job.{" "}
        {overriddenAreas.length > 0 && (
          <>
            {overriddenAreas.length} area{overriddenAreas.length === 1 ? "" : "s"} ({overriddenAreas.join(", ")})
            {overriddenAreas.length === 1 ? " carries" : " carry"} a level of their own and will keep it.{" "}
          </>
        )}
        <b>It does not change the price.</b> The level multiplier is priced and
        signed in the revision builder — correct the sheet here, and send the
        variation there.
      </p>
      <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          data-testid="finish-level-select"
          aria-label="Level of finish"
        >
          <option value="">— pick a level —</option>
          {CORRECTABLE_FINISH_MODIFIERS.map((code) => {
            const pg = finishFromModifier(code);
            const l = pg ? FINISH_LEVELS[pg] : null;
            return (
              <option key={code} value={code}>
                Level {code.split("-")[1]} · {pg}{l ? ` — ${l.name}` : ""}
              </option>
            );
          })}
        </select>
        <button
          className="btn primary"
          onClick={save}
          disabled={pending || !choice}
          data-testid="finish-level-save"
        >
          {pending ? "Saving…" : "Save to the job sheet"}
        </button>
        {message && <span className="note" data-testid="finish-level-msg">{message}</span>}
      </div>
    </div>
  );
}
