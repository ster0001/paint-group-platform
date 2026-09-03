"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_MESSAGING, MESSAGING_KEY, automationOn, type MessagingSettings as Msg } from "@/lib/messaging/config";
import {
  AUDIENCE_LABEL, AUTOMATIONS, CHANNEL_LABEL,
  type Audience, type Automation, type TemplateField,
} from "@/lib/automations/registry";

/**
 * Settings → Automations (Tom, 3 Sep 2026): every message the platform sends
 * to customers and painters, in one place — what fires it, an on/off switch
 * for the automatic ones, and the wording where it is a template.
 *
 * Two rows are saved: `messaging` (switches + templates, written whole) and
 * the `variationRelease` key on `wo_loop` (the "approved variations go
 * straight to the painter" switch the sign RPC reads). New automations are
 * added in lib/automations/registry.ts; the screen is data-driven off it.
 */
export default function AutomationsSettings({
  initial, initialVariationRelease,
}: {
  initial: Partial<Msg> | null;
  /** wo_loop.variationRelease — 'auto' | 'pc'. */
  initialVariationRelease: "auto" | "pc";
}) {
  const [form, setForm] = useState<Msg>({ ...DEFAULT_MESSAGING, ...(initial ?? {}) });
  const [variationRelease, setVariationRelease] = useState<"auto" | "pc">(initialVariationRelease);
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Audience>("all");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof Msg>(key: K, value: Msg[K]) => { setForm((f) => ({ ...f, [key]: value })); setDirty(true); };
  const toggle = (key: string, on: boolean) => {
    setForm((f) => {
      const cur = Array.isArray(f.disabled) ? f.disabled : [];
      const next = on ? cur.filter((k) => k !== key) : [...new Set([...cur, key])];
      return { ...f, disabled: next };
    });
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    setMsg("");
    const supabase = createClient();
    const results = await Promise.all([
      supabase.from("settings").upsert({ key: MESSAGING_KEY, value: form }, { onConflict: "key" }),
      (async () => {
        // Merge, never replace — wo_loop carries a dozen other keys.
        const { data } = await supabase.from("settings").select("value").eq("key", "wo_loop").maybeSingle();
        const value = { ...(((data?.value as Record<string, unknown>) ?? {})), variationRelease };
        return supabase.from("settings").upsert({ key: "wo_loop", value }, { onConflict: "key" });
      })(),
    ]);
    setSaving(false);
    const err = results.find((r) => r.error)?.error;
    setMsg(err ? err.message : "Saved ✓");
    if (!err) setDirty(false);
  }

  const groups = useMemo(() => {
    const order: Audience[] = ["customer", "painter", "office"];
    return order
      .filter((a) => filter === "all" || filter === a)
      .map((a) => ({ audience: a, rows: AUTOMATIONS.filter((x) => x.audience === a) }))
      .filter((g) => g.rows.length > 0);
  }, [filter]);

  const offCount = AUTOMATIONS.filter((a) => a.kind === "automatic" && !a.special && !automationOn(form, a.key)).length
    + (variationRelease === "pc" ? 1 : 0);

  return (
    <div className="space-y-4" data-testid="automations">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-600">
          Every message the platform sends, in one list. <strong>Automatic</strong> ones fire on their own and can be switched off here;
          <strong> manual</strong> ones go when you press Send; <strong>planned</strong> ones are recorded but nothing is sent yet.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "customer", "painter", "office"] as const).map((a) => (
          <button
            key={a} type="button" onClick={() => setFilter(a)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === a ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"}`}
          >
            {a === "all" ? "Everything" : AUDIENCE_LABEL[a]}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-500" data-testid="automations-off-count">
          {offCount === 0 ? "All automations on" : `${offCount} switched off`}
        </span>
      </div>

      {groups.map((g) => (
        <section key={g.audience}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">{AUDIENCE_LABEL[g.audience]}</h3>
          <div className="overflow-hidden rounded-lg border border-gray-200 divide-y divide-gray-100">
            {g.rows.map((a) => (
              <AutomationRow
                key={a.key}
                a={a}
                on={a.special === "variation_release" ? variationRelease === "auto" : automationOn(form, a.key)}
                onToggle={(on) => {
                  if (a.special === "variation_release") { setVariationRelease(on ? "auto" : "pc"); setDirty(true); }
                  else toggle(a.key, on);
                }}
                editing={editing === a.key}
                onEdit={() => setEditing((e) => (e === a.key ? null : a.key))}
                form={form}
                set={set}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="sticky bottom-0 -mx-5 flex items-center gap-3 border-t border-gray-200 bg-white/95 px-5 py-3 backdrop-blur">
        <button
          onClick={save} disabled={saving}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          data-testid="automations-save"
        >
          {saving ? "Saving…" : "Save automations"}
        </button>
        {dirty && !msg && <span className="text-xs text-amber-600">Unsaved changes</span>}
        {msg && <span className={`text-sm ${msg.startsWith("Saved") ? "text-green-600" : "text-red-600"}`} data-testid="automations-msg">{msg}</span>}
      </div>
    </div>
  );
}

function AutomationRow({
  a, on, onToggle, editing, onEdit, form, set,
}: {
  a: Automation;
  on: boolean;
  onToggle: (on: boolean) => void;
  editing: boolean;
  onEdit: () => void;
  form: Msg;
  set: <K extends keyof Msg>(key: K, value: Msg[K]) => void;
}) {
  const switchable = a.kind === "automatic";
  const hasTemplates = (a.templates?.length ?? 0) > 0;
  return (
    <div className={`px-4 py-3 ${a.kind === "planned" ? "bg-gray-50/60" : ""}`} data-testid={`automation-${a.key}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">{a.name}</span>
            {a.channels.map((c) => (
              <span key={c} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{CHANNEL_LABEL[c]}</span>
            ))}
            <span className={`rounded px-1.5 py-0.5 text-[11px] ${a.kind === "automatic" ? "bg-emerald-50 text-emerald-700" : a.kind === "manual" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"}`}>
              {a.kind === "automatic" ? "Automatic" : a.kind === "manual" ? "You press send" : "Not sending yet"}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-600">{a.trigger}</p>
          {(a.guard || a.note || a.wording) && (
            <p className="mt-1 text-[11px] text-gray-400">
              {[a.guard, a.wording, a.note].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {a.href && (
            <a href={a.href} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-gray-400">Open</a>
          )}
          {hasTemplates && (
            <button type="button" onClick={onEdit} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:border-gray-400" data-testid={`edit-${a.key}`}>
              {editing ? "Close" : "Edit wording"}
            </button>
          )}
          {switchable && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox" role="switch" checked={on} onChange={(e) => onToggle(e.target.checked)}
                aria-label={`${a.name} on`} data-testid={`switch-${a.key}`}
                className="h-4 w-4 accent-emerald-600"
              />
              <span className={on ? "text-emerald-700" : "text-gray-400"}>{on ? "On" : "Off"}</span>
            </label>
          )}
        </div>
      </div>

      {editing && hasTemplates && (
        <div className="mt-3 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
          {a.templates!.map((t) => <TemplateInput key={String(t.field)} t={t} form={form} set={set} />)}
        </div>
      )}
    </div>
  );
}

function TemplateInput({ t, form, set }: { t: TemplateField; form: Msg; set: <K extends keyof Msg>(key: K, value: Msg[K]) => void }) {
  const value = form[t.field];
  const cls = "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed";
  const sms = t.kind === "sms";
  return (
    <label className="block text-xs text-gray-700">
      <span className="font-medium">{t.label}</span>
      {t.kind === "number" ? (
        <input
          type="number" min={0} max={30} value={Number(value) || 0}
          onChange={(e) => set(t.field, Math.max(0, Math.min(30, parseInt(e.target.value || "0", 10) || 0)) as Msg[typeof t.field])}
          className={`${cls} w-28`} data-testid={`tpl-${String(t.field)}`}
        />
      ) : t.kind === "subject" ? (
        <input value={String(value ?? "")} onChange={(e) => set(t.field, e.target.value as Msg[typeof t.field])} className={cls} data-testid={`tpl-${String(t.field)}`} />
      ) : (
        <textarea rows={sms ? 3 : 8} value={String(value ?? "")} onChange={(e) => set(t.field, e.target.value as Msg[typeof t.field])} className={cls} data-testid={`tpl-${String(t.field)}`} />
      )}
      {t.placeholders && (
        <span className="mt-1 block text-[11px] text-gray-400">Placeholders: {t.placeholders.join(" · ")}</span>
      )}
      {sms && typeof value === "string" && !value.includes("{{link}}") && (
        <span className="mt-1 block text-[11px] text-amber-600">Include {"{{link}}"} so the message carries the link.</span>
      )}
    </label>
  );
}
