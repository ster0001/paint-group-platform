"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  COLOUR_INTENTS, DEFAULT_PAINT_SYSTEMS, PAINT_SYSTEMS_KEY, SYSTEM_GROUPS,
  type ColourIntent, type PaintSystems, type SystemGroup,
} from "@/lib/pricing/systems";

/**
 * Settings → Estimates → Paint systems (estimator journey v2 §4.2, ⚑2).
 *
 * The coats and preparation the engine derives for each surface group, in
 * Tom's hands rather than in a constant. Before this screen the whole job
 * carried ONE coat count chosen by the customer from a "1 / 2 / 3 coats"
 * card; the customer now answers colour intent and condition, and this table
 * decides what that means per surface.
 *
 * The one rule this screen cannot override is the coverage rule (allowances
 * spec §7.6): a single coat over a colour change does not cover, so a "1" in
 * any new/bold cell is refused at save AND again at derivation time. The
 * warning below says so before the save button does.
 */

const GROUP_LABEL: Record<SystemGroup, string> = {
  walls: "Walls",
  ceilings: "Ceilings and cornices",
  trims: "Skirtings and architraves",
  doors: "Doors",
  windows: "Windows",
};

const INTENT_LABEL: Record<ColourIntent, string> = {
  same: "Same colours again",
  new: "New colours",
  bold: "Much lighter, or bold",
};

/** The cells the coverage rule governs — a colour change on that surface. */
const mustCover = (intent: ColourIntent) => intent !== "same";

export default function PaintSystemsSettings({ initial }: { initial: PaintSystems }) {
  const [form, setForm] = useState<PaintSystems>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  const setCell = (group: SystemGroup, intent: ColourIntent, patch: Partial<PaintSystems[SystemGroup][ColourIntent]>) => {
    setForm((f) => ({ ...f, [group]: { ...f[group], [intent]: { ...f[group][intent], ...patch } } }));
    setDirty(true);
  };
  const setTop = <K extends keyof PaintSystems>(k: K, v: PaintSystems[K]) => {
    setForm((f) => ({ ...f, [k]: v })); setDirty(true);
  };
  const setFlag = (i: number, patch: Partial<PaintSystems["surfaceFlags"][number]>) => {
    setForm((f) => ({ ...f, surfaceFlags: f.surfaceFlags.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
    setDirty(true);
  };

  /** Cells that would not cover. Named, so the message can point at them. */
  const offending = SYSTEM_GROUPS.flatMap((g) =>
    COLOUR_INTENTS.filter((i) => mustCover(i) && form[g][i].coats < 2)
      .map((i) => `${GROUP_LABEL[g]} · ${INTENT_LABEL[i]}`),
  );
  // Ceilings are the exception the derivation makes on the customer's behalf
  // (white over white is not a colour change), so the screen does not police
  // that row the way it polices the others.
  const blocking = offending.filter((s) => !s.startsWith(GROUP_LABEL.ceilings));

  async function save() {
    if (blocking.length > 0) return;
    setSaving(true); setMsg("");
    const supabase = createClient();
    const { error } = await supabase.from("settings").upsert({ key: PAINT_SYSTEMS_KEY, value: form }, { onConflict: "key" });
    setSaving(false);
    setMsg(error ? error.message : "Saved ✓");
    if (!error) setDirty(false);
  }

  function reset() {
    setForm(DEFAULT_PAINT_SYSTEMS); setDirty(true); setMsg("");
  }

  return (
    <div className="space-y-5" data-testid="paint-systems">
      <p className="text-xs text-gray-500">
        The customer never picks coats. They tell us the colour intent and the condition; this table turns that into a
        paint system per surface, and the estimate shows it back to them in these words. Change a number here and every
        estimate built afterwards follows it — no deploy.
      </p>

      {SYSTEM_GROUPS.map((group) => (
        <div key={group} className="space-y-2 rounded-md border border-gray-200 bg-white p-3" data-testid={`systems-${group}`}>
          <div className="text-sm font-medium text-gray-900">{GROUP_LABEL[group]}</div>
          <div className="grid gap-2 md:grid-cols-3">
            {COLOUR_INTENTS.map((intent) => {
              const cell = form[group][intent];
              const bad = mustCover(intent) && cell.coats < 2 && group !== "ceilings";
              return (
                <div key={intent} className={`space-y-2 rounded border p-2 ${bad ? "border-red-400 bg-red-50" : "border-gray-200 bg-gray-50"}`}>
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{INTENT_LABEL[intent]}</div>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-gray-700">Coats</span>
                    <input
                      type="number" min={1} max={4} value={cell.coats}
                      onChange={(e) => setCell(group, intent, { coats: Number(e.target.value) })}
                      className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
                      data-testid={`coats-${group}-${intent}`}
                      aria-label={`${GROUP_LABEL[group]}, ${INTENT_LABEL[intent]}, coats`}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox" checked={cell.undercoat} className="h-3.5 w-3.5 accent-gray-800"
                      onChange={(e) => setCell(group, intent, { undercoat: e.target.checked })}
                      data-testid={`undercoat-${group}-${intent}`}
                    />
                    One of those is an undercoat
                  </label>
                  <textarea
                    value={cell.sentence} rows={3} maxLength={400}
                    onChange={(e) => setCell(group, intent, { sentence: e.target.value })}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                    aria-label={`${GROUP_LABEL[group]}, ${INTENT_LABEL[intent]}, what the customer reads`}
                    data-testid={`sentence-${group}-${intent}`}
                  />
                  {bad && <p className="text-xs text-red-700">One coat will not cover a colour change.</p>}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">The three judgement calls</div>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span className="text-gray-700">
            Ceilings when they&rsquo;re marked or already coloured
            <span className="block text-xs text-gray-500">The customer&rsquo;s two-coat tap on the paint-systems screen.</span>
          </span>
          <input
            type="number" min={1} max={4} value={form.ceilingsMarkedCoats}
            onChange={(e) => setTop("ceilingsMarkedCoats", Number(e.target.value))}
            className="w-16 shrink-0 rounded border border-gray-300 px-2 py-1 text-sm" data-testid="ceilings-marked-coats"
          />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span className="text-gray-700">
            Same-colour trims on a job in good condition
            <span className="block text-xs text-gray-500">Two coats is the default; this is the exception when nothing needs work.</span>
          </span>
          <input
            type="number" min={1} max={4} value={form.trimsGoodConditionCoats}
            onChange={(e) => setTop("trimsGoodConditionCoats", Number(e.target.value))}
            className="w-16 shrink-0 rounded border border-gray-300 px-2 py-1 text-sm" data-testid="trims-good-coats"
          />
        </label>
        <label className="flex items-start justify-between gap-4 text-sm">
          <span className="text-gray-700">
            A bonding primer when the existing trims are an oil-based gloss
            <span className="block text-xs text-gray-500">
              Adds a coat. &ldquo;Not sure&rdquo; is the customer&rsquo;s default — it prices as no and asks the estimator to check.
            </span>
          </span>
          <input
            type="checkbox" checked={form.glossBondingPrimer} className="mt-1 h-4 w-4 shrink-0 accent-emerald-600"
            onChange={(e) => setTop("glossBondingPrimer", e.target.checked)} data-testid="gloss-bonding-primer"
          />
        </label>
      </div>

      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Preparation hours by condition</div>
        <p className="text-xs text-gray-500">
          Hours per unit (m², lineal metre or item) added to every derived surface. <b>All three are zero</b> until you set
          them: prep already reaches the tree from the defect photos and the prep stepper, and a number here on day one
          would reprice every job at once. Set them against ACTUALS — the hours the work order really took, times the charge-out rate, plus materials. Not against the proving window, and never against an old PaintScout quote.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {(["good", "wear", "work"] as const).map((band) => (
            <label key={band} className="text-sm">
              <span className="block text-xs capitalize text-gray-700">{band === "work" ? "Needs work" : band === "wear" ? "Some wear" : "Good"}</span>
              <input
                type="number" min={0} max={2} step={0.005} value={form.prepHrPerUnit[band]}
                onChange={(e) => setTop("prepHrPerUnit", { ...form.prepHrPerUnit, [band]: Number(e.target.value) })}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm" data-testid={`prep-${band}`}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3" data-testid="surface-flags">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
          &ldquo;Anything different about these?&rdquo; — per-surface flags
        </div>
        <p className="text-xs text-gray-500">
          One group often needs more than the rest — stained doors on an otherwise two-coat job, new plaster on
          one wall. The customer taps what&rsquo;s THERE and we work out the coats; they never pick a number.
          Each flag sets a floor (or a ceiling) on the coats for the groups it applies to, and its note goes to
          the painter on the work order. The coverage rule still wins: a flag can never take a surface that&rsquo;s
          changing colour down to one coat.
        </p>
        {form.surfaceFlags.map((flag, i) => (
          <div key={flag.key} className="grid gap-2 rounded border border-gray-200 bg-white p-2 md:grid-cols-[1fr_auto_auto]">
            <div>
              <input
                value={flag.label} maxLength={80}
                onChange={(e) => setFlag(i, { label: e.target.value })}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                aria-label={`${flag.key} label`} data-testid={`flag-label-${flag.key}`}
              />
              <p className="mt-1 text-xs text-gray-500">
                {flag.groups.join(" · ")} — {flag.crewNote || "no note for the painter"}
              </p>
            </div>
            <label className="flex items-center gap-1 text-xs text-gray-700">
              at least
              <input
                type="number" min={1} max={4} value={flag.minCoats ?? ""}
                placeholder={flag.key === "marked" ? String(form.ceilingsMarkedCoats) : "—"}
                onChange={(e) => setFlag(i, { minCoats: e.target.value === "" ? undefined : Number(e.target.value) })}
                className="w-14 rounded border border-gray-300 px-2 py-1 text-sm"
                data-testid={`flag-min-${flag.key}`}
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-700">
              at most
              <input
                type="number" min={1} max={4} value={flag.maxCoats ?? ""} placeholder="—"
                onChange={(e) => setFlag(i, { maxCoats: e.target.value === "" ? undefined : Number(e.target.value) })}
                className="w-14 rounded border border-gray-300 px-2 py-1 text-sm"
                data-testid={`flag-max-${flag.key}`}
              />
            </label>
          </div>
        ))}
      </div>

      {blocking.length > 0 && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800" data-testid="paint-systems-blocked">
          Fix before saving — one coat will not cover a colour change: {blocking.join(", ")}.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving || !dirty || blocking.length > 0}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-40" data-testid="paint-systems-save">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={reset}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700" data-testid="paint-systems-reset">
          Back to the recommended table
        </button>
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
      </div>
    </div>
  );
}
