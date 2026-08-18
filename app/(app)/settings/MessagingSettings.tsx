"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_MESSAGING, MESSAGING_KEY, TEMPLATE_PLACEHOLDERS, type MessagingSettings as Msg } from "@/lib/messaging/config";

/**
 * The wording used when an estimate is emailed/texted to a customer, plus the
 * master switch for text messaging. The send dialog pre-fills from these, so
 * staff can still tweak the words per estimate before it goes out.
 */
export default function MessagingSettings({ initial }: { initial: Partial<Msg> | null }) {
  const [form, setForm] = useState<Msg>({ ...DEFAULT_MESSAGING, ...(initial ?? {}) });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const set = <K extends keyof Msg>(key: K, value: Msg[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setSaving(true);
    setMsg("");
    const supabase = createClient();
    const { error } = await supabase.from("settings").upsert({ key: MESSAGING_KEY, value: form }, { onConflict: "key" });
    setSaving(false);
    setMsg(error ? error.message : "Saved ✓");
  }

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-gray-500">
        These templates pre-fill the send dialog — you can still edit the words on each estimate before sending.
        Placeholders are swapped for the real details automatically: {TEMPLATE_PLACEHOLDERS.join(" · ")}
      </p>

      <div>
        <label className="text-sm font-medium text-gray-700">Email subject</label>
        <input
          value={form.emailSubject}
          onChange={(e) => set("emailSubject", e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700">Email introduction</label>
        <textarea
          rows={7}
          value={form.emailIntro}
          onChange={(e) => set("emailIntro", e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-relaxed"
        />
        <p className="mt-1 text-xs text-gray-400">The &ldquo;Open your estimate&rdquo; button and your sign-off are added below this automatically.</p>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          checked={form.smsEnabled}
          onChange={(e) => set("smsEnabled", e.target.checked)}
        />
        Text messaging on — tick &ldquo;Also text them the link&rdquo; by default when sending
      </label>

      <div>
        <label className="text-sm font-medium text-gray-700">Text message</label>
        <textarea
          rows={3}
          value={form.smsTemplate}
          onChange={(e) => set("smsTemplate", e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-relaxed"
        />
        {!form.smsTemplate.includes("{{link}}") && (
          <p className="mt-1 text-xs text-amber-600">Include {"{{link}}"} so the customer actually receives the estimate link.</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className={`text-sm ${msg.startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}
