"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_MESSAGING, MESSAGING_KEY, automationOn, renderTemplate, type MessagingSettings as Msg } from "@/lib/messaging/config";
import {
  AUDIENCE_LABEL, AUTOMATIONS, CHANNEL_LABEL,
  type Audience, type Automation, type TemplateField,
} from "@/lib/automations/registry";
import {
  CHANNEL_CHOICE_LABEL, MODE_LABEL, SAMPLE_VARS, channelChoicesFor, normaliseChannel, parseQuietHours, smsLength, unfilledPlaceholders,
  type AutomationControl, type ChannelChoice, type QuietHours, type SendMode,
} from "@/lib/automations/controls";
import StaffAlertsMatrix from "./StaffAlertsMatrix";
import { sendTestAutomation } from "./automationActions";

/**
 * Settings → Automations (Tom, 3 Sep 2026; Session 1 of the messaging brief,
 * 16 Sep): every message the platform sends to customers, contractors and
 * staff, in one place. Per row: on/off, the CHANNEL (Text / Email / Both,
 * among what it supports), the MODE (send automatically / office approves
 * first), timing numbers where the registry declares them, and the wording —
 * with a token picker, a live preview filled with an example job, a text-
 * message part counter, "Send test to me" and "Reset to default wording".
 * Above the list: sending hours (D1) and the daily limit per customer (D2).
 *
 * Two rows are saved: `messaging` (switches, controls, quiet hours, cap and
 * templates, written whole) and the `variationRelease` key on `wo_loop`.
 * New automations are added in lib/automations/registry.ts; the screen is
 * data-driven off it.
 */
export default function AutomationsSettings({
  initial, initialVariationRelease,
}: {
  initial: Partial<Msg> | null;
  /** wo_loop.variationRelease — 'auto' | 'pc'. */
  initialVariationRelease: "auto" | "pc";
}) {
  const [form, setForm] = useState<Msg>({ ...DEFAULT_MESSAGING, ...(initial ?? {}), quietHours: parseQuietHours(initial?.quietHours) });
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
  const setControl = (key: string, patch: Partial<AutomationControl>) => {
    setForm((f) => {
      const controls = { ...(f.controls ?? {}) };
      const cur = controls[key] ?? {};
      controls[key] = { ...cur, ...patch, timing: { ...(cur.timing ?? {}), ...(patch.timing ?? {}) } };
      return { ...f, controls };
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
  const approveCount = AUTOMATIONS.filter((a) => a.approvable && (form.controls?.[a.key]?.mode ?? a.defaultMode) === "approve").length;

  return (
    <div className="space-y-4" data-testid="automations">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-600">
          Every message the platform sends, in one list. <strong>Automatic</strong> ones fire on their own — switch them off, pick Text / Email / Both,
          and choose whether the office approves each one first; <strong>manual</strong> ones go when you press Send; <strong>planned</strong> ones are recorded but nothing is sent yet.
        </p>
      </div>

      <SendingRules form={form} set={set} />

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
          {approveCount > 0 ? ` · ${approveCount} approved first` : ""}
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
                control={form.controls?.[a.key] ?? {}}
                setControl={(patch) => setControl(a.key, patch)}
              />
            ))}
          </div>
          {g.audience === "office" && <StaffAlertsMatrix />}
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

// ---- sending hours + daily limit (D1, D2) -----------------------------------

const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hourLabel = (h: number) => (h === 0 ? "midnight" : h === 12 ? "12 noon" : h === 24 ? "midnight" : h < 12 ? `${h} am` : `${h - 12} pm`);

function SendingRules({ form, set }: { form: Msg; set: <K extends keyof Msg>(key: K, value: Msg[K]) => void }) {
  const q = form.quietHours;
  const setDay = (day: keyof QuietHours, w: QuietHours[keyof QuietHours]) => set("quietHours", { ...q, [day]: w });
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3" data-testid="sending-rules">
      <div className="flex flex-wrap items-start gap-6">
        <div>
          <p className="text-xs font-semibold text-gray-800">Sending hours <span className="font-normal text-gray-500">(Melbourne time)</span></p>
          <p className="mt-0.5 text-[11px] text-gray-500">Automatic customer and painter messages due outside these hours wait for the next opening. Job offers, receipts, sign-in links and calendar invites go at any hour.</p>
          <div className="mt-2 space-y-1.5">
            {([["weekday", "Mon–Fri"], ["saturday", "Saturday"], ["sunday", "Sunday"]] as const).map(([day, label]) => {
              const w = q[day];
              return (
                <div key={day} className="flex items-center gap-2 text-xs text-gray-700">
                  <label className="flex w-24 items-center gap-1.5">
                    <input type="checkbox" checked={w !== null} onChange={(e) => setDay(day, e.target.checked ? (day === "weekday" ? [8, 19] : [9, 17]) : null)} className="h-3.5 w-3.5 accent-emerald-600" data-testid={`quiet-${day}-on`} />
                    {label}
                  </label>
                  {w ? (
                    <>
                      <select value={w[0]} onChange={(e) => setDay(day, [Number(e.target.value), Math.max(Number(e.target.value) + 1, w[1])])} className="rounded border border-gray-300 bg-white px-1.5 py-0.5" data-testid={`quiet-${day}-open`}>
                        {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                      </select>
                      <span>to</span>
                      <select value={w[1]} onChange={(e) => setDay(day, [Math.min(w[0], Number(e.target.value) - 1), Number(e.target.value)])} className="rounded border border-gray-300 bg-white px-1.5 py-0.5" data-testid={`quiet-${day}-close`}>
                        {HOURS.slice(1).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                      </select>
                    </>
                  ) : <span className="text-gray-400">no automatic messages</span>}
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-800">Daily limit per customer</p>
          <p className="mt-0.5 text-[11px] text-gray-500">Automatic job messages to one customer in a day. Extra ones wait for tomorrow. Payment and sign-off messages don&apos;t count.</p>
          <input
            type="number" min={0} max={20} value={form.dailyCap}
            onChange={(e) => set("dailyCap", Math.max(0, Math.min(20, parseInt(e.target.value || "0", 10) || 0)))}
            className="mt-2 w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm" data-testid="daily-cap"
          />
        </div>
      </div>
    </div>
  );
}

// ---- one automation ------------------------------------------------------------

function AutomationRow({
  a, on, onToggle, editing, onEdit, form, set, control, setControl,
}: {
  a: Automation;
  on: boolean;
  onToggle: (on: boolean) => void;
  editing: boolean;
  onEdit: () => void;
  form: Msg;
  set: <K extends keyof Msg>(key: K, value: Msg[K]) => void;
  control: AutomationControl;
  setControl: (patch: Partial<AutomationControl>) => void;
}) {
  const switchable = a.kind === "automatic";
  const hasTemplates = (a.templates?.length ?? 0) > 0;
  const choices = channelChoicesFor(a.channels);
  const showChannel = switchable && !a.special && choices.length > 1;
  const channel = normaliseChannel(control.channel, a.channels, a.defaultChannel ?? choices[0] ?? "email");
  const mode: SendMode = a.approvable ? (control.mode === "approve" || control.mode === "auto" ? control.mode : a.defaultMode ?? "auto") : "auto";
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
            {a.approvable && mode === "approve" && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700" data-testid={`mode-badge-${a.key}`}>Office approves first</span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-600">{a.trigger}</p>
          {(a.guard || a.note || a.wording) && (
            <p className="mt-1 text-[11px] text-gray-400">
              {[a.guard, a.wording, a.note].filter(Boolean).join(" · ")}
            </p>
          )}
          {(showChannel || a.approvable || (a.timing?.length ?? 0) > 0) && switchable && !a.special && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-700">
              {showChannel && (
                <label className="flex items-center gap-1.5">
                  <span className="text-gray-500">Send by</span>
                  <select value={channel} onChange={(e) => setControl({ channel: e.target.value as ChannelChoice })} className="rounded border border-gray-300 bg-white px-1.5 py-0.5" data-testid={`channel-${a.key}`} aria-label={`${a.name} channel`}>
                    {choices.map((c) => <option key={c} value={c}>{CHANNEL_CHOICE_LABEL[c]}</option>)}
                  </select>
                </label>
              )}
              {a.approvable && (
                <label className="flex items-center gap-1.5">
                  <span className="text-gray-500">Mode</span>
                  <select value={mode} onChange={(e) => setControl({ mode: e.target.value as SendMode })} className="rounded border border-gray-300 bg-white px-1.5 py-0.5" data-testid={`mode-${a.key}`} aria-label={`${a.name} mode`}>
                    {(["auto", "approve"] as const).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                  </select>
                </label>
              )}
              {a.timing?.map((t) => (
                <label key={t.id} className="flex items-center gap-1.5">
                  <span className="text-gray-500">{t.label}</span>
                  <input
                    type="number" min={t.min ?? 0} max={t.max ?? 365}
                    value={control.timing?.[t.id] ?? t.default}
                    onChange={(e) => setControl({ timing: { [t.id]: Math.max(t.min ?? 0, Math.min(t.max ?? 365, parseInt(e.target.value || "0", 10) || 0)) } })}
                    className="w-16 rounded border border-gray-300 bg-white px-1.5 py-0.5" data-testid={`timing-${a.key}-${t.id}`}
                  />
                  <span className="text-gray-500">{t.unit}</span>
                </label>
              ))}
            </div>
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

      {editing && hasTemplates && <WordingEditor a={a} form={form} set={set} />}
    </div>
  );
}

// ---- the wording editor ------------------------------------------------------

function WordingEditor({ a, form, set }: { a: Automation; form: Msg; set: <K extends keyof Msg>(key: K, value: Msg[K]) => void }) {
  const [testSaid, setTestSaid] = useState<string>("");
  const [testing, startTest] = useTransition();
  const templates = a.templates ?? [];
  const emailFields = templates.filter((t) => t.kind === "subject" || t.kind === "body");
  const smsField = templates.find((t) => t.kind === "sms");
  const preview = (t: TemplateField | undefined) => (t ? renderTemplate(String(form[t.field] ?? ""), SAMPLE_VARS) : "");
  const subjectT = emailFields.find((t) => t.kind === "subject");
  const bodyT = emailFields.find((t) => t.kind === "body");
  const isDefault = templates.every((t) => form[t.field] === DEFAULT_MESSAGING[t.field]);
  const fieldsNow = Object.fromEntries(templates.map((t) => [t.field, form[t.field]])) as Record<string, string | number | boolean>;

  const reset = () => { for (const t of templates) set(t.field, DEFAULT_MESSAGING[t.field]); };
  const test = (channel: "email" | "sms") => startTest(async () => {
    setTestSaid("Sending…");
    const r = await sendTestAutomation({ key: a.key, channel, fields: fieldsNow });
    setTestSaid(r.message);
  });

  return (
    <div className="mt-3 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 md:grid-cols-2" data-testid={`editor-${a.key}`}>
      <div className="space-y-3">
        {templates.map((t) => <TemplateInput key={String(t.field)} t={t} form={form} set={set} />)}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {emailFields.length > 0 && (
            <button type="button" disabled={testing} onClick={() => test("email")} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:border-gray-500 disabled:opacity-50" data-testid={`test-email-${a.key}`}>
              Send test email to me
            </button>
          )}
          {smsField && (
            <button type="button" disabled={testing} onClick={() => test("sms")} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:border-gray-500 disabled:opacity-50" data-testid={`test-sms-${a.key}`}>
              Send test text to me
            </button>
          )}
          <button type="button" disabled={isDefault} onClick={reset} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:border-gray-500 disabled:opacity-40" data-testid={`reset-${a.key}`}>
            Reset to default wording
          </button>
          {testSaid && <span className="text-[11px] text-gray-600" data-testid={`test-said-${a.key}`}>{testSaid}</span>}
        </div>
        <p className="text-[11px] text-gray-400">Tests go to your own login email and the mobile on your staff profile, with the example job filled in. Save to keep the wording.</p>
      </div>
      <div className="space-y-2" data-testid={`preview-${a.key}`}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Preview · example job</p>
        {(subjectT || bodyT) && (
          <div className="rounded-md border border-gray-200 bg-white p-3 text-sm">
            {subjectT && <p className="font-semibold text-gray-900" data-testid={`preview-subject-${a.key}`}>{preview(subjectT)}</p>}
            {bodyT && <p className="mt-2 whitespace-pre-wrap text-gray-700" data-testid={`preview-body-${a.key}`}>{preview(bodyT)}</p>}
          </div>
        )}
        {smsField && (
          <div className="rounded-md border border-gray-200 bg-white p-3 text-sm">
            <p className="text-[11px] text-gray-500">Text message</p>
            <p className="mt-1 whitespace-pre-wrap text-gray-800" data-testid={`preview-sms-${a.key}`}>{preview(smsField)}</p>
          </div>
        )}
        {templates.some((t) => unfilledPlaceholders(String(form[t.field] ?? "")).length > 0) && (
          <p className="text-[11px] text-amber-600" data-testid={`preview-unfilled-${a.key}`}>
            Not a known placeholder here: {[...new Set(templates.flatMap((t) => unfilledPlaceholders(String(form[t.field] ?? ""))))].map((p) => `{{${p}}}`).join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

function TemplateInput({ t, form, set }: { t: TemplateField; form: Msg; set: <K extends keyof Msg>(key: K, value: Msg[K]) => void }) {
  const value = form[t.field];
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const cls = "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed";
  const sms = t.kind === "sms";
  const text = typeof value === "string" ? value : "";
  const insert = (token: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    set(t.field, next as Msg[typeof t.field]);
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(start + token.length, start + token.length); } });
  };
  const parts = sms ? smsLength(text) : null;
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
        <input ref={(el) => { ref.current = el; }} value={text} onChange={(e) => set(t.field, e.target.value as Msg[typeof t.field])} className={cls} data-testid={`tpl-${String(t.field)}`} />
      ) : (
        <textarea ref={(el) => { ref.current = el; }} rows={sms ? 3 : 8} value={text} onChange={(e) => set(t.field, e.target.value as Msg[typeof t.field])} className={cls} data-testid={`tpl-${String(t.field)}`} />
      )}
      {t.placeholders && t.kind !== "number" && (
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-gray-400">Insert:</span>
          {t.placeholders.map((p) => (
            <button key={p} type="button" onClick={() => insert(p)} className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-gray-600 hover:border-gray-400" data-testid={`token-${String(t.field)}-${p.replace(/[{}]/g, "")}`}>
              {p}
            </button>
          ))}
        </span>
      )}
      {parts && (
        <span className={`mt-1 block text-[11px] ${parts.parts > 1 ? "text-amber-600" : "text-gray-400"}`} data-testid={`sms-parts-${String(t.field)}`}>
          {parts.chars} characters · {parts.parts === 0 ? "nothing to send" : `${parts.parts} text message${parts.parts === 1 ? "" : "s"}`}{parts.encoding === "Unicode" ? " · a special character (like an em dash) makes this Unicode, 70 per part" : ""}
        </span>
      )}
      {sms && text && !text.includes("{{link}}") && t.placeholders?.includes("{{link}}") && (
        <span className="mt-1 block text-[11px] text-amber-600">Include {"{{link}}"} so the message carries the link.</span>
      )}
    </label>
  );
}
