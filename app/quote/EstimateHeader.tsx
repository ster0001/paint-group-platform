"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type CompanyProfile, type Contact, type JobAddress, EMPTY_CONTACT, EMPTY_JOB } from "./company";
import { contactFieldProblems } from "@/lib/validation/contact";
import { useAddressLookup, type AddressSuggestion } from "@/app/components/useAddressLookup";

const contactName = (c: Contact) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || "";

export default function EstimateHeader({
  company,
  contacts,
  contact,
  jobAddress,
  onContact,
  onJobAddress,
  estimateId,
  dateStr,
  readOnly = false,
  docTitle = "Estimate",
}: {
  company: CompanyProfile;
  contacts: Contact[];
  contact: Contact | null;
  jobAddress: JobAddress | null;
  onContact: (c: Contact) => void;
  onJobAddress: (j: JobAddress) => void;
  estimateId: string;
  dateStr: string;
  readOnly?: boolean;
  /** "Invoice" in revision mode (Tom, 25 Aug — the word above the estimator). */
  docTitle?: "Estimate" | "Invoice";
}) {
  const [modal, setModal] = useState<null | "contact" | "job">(null);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      {/* top: company + Estimate */}
      <div className="flex items-start justify-between gap-6">
        <div className="text-sm text-gray-600">
          {company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt={company.name} className="mb-3 h-12 object-contain" />
          ) : (
            <div className="mb-2 text-lg font-bold tracking-tight text-gray-900">{company.name}</div>
          )}
          <div className="font-medium text-gray-900">{company.name}</div>
          <div>{company.addressLine1}</div>
          <div>{company.addressLine2}</div>
          <div>{company.phone}</div>
          <div>ABN: {company.abn}</div>
          <div className="mt-3 font-medium text-gray-900">Banking Details</div>
          <div>Name: {company.bankName}</div>
          <div>BSB: {company.bsb} · ACC: {company.acc}</div>
          <div>Bank: {company.bank}</div>
        </div>

        <div className="text-right">
          <div className="text-3xl font-semibold tracking-tight text-gray-900">{docTitle}</div>
          <div className="mt-4 text-sm text-gray-600">
            <div className="font-medium text-gray-900">{company.estimatorName}</div>
            <div>{company.estimatorTitle}</div>
            <div>{company.estimatorPhone}</div>
            <div>{company.email}</div>
          </div>
        </div>
      </div>

      {/* bottom: contact / job address / id / date */}
      <div className="mt-6 grid grid-cols-2 gap-6 border-t border-gray-100 pt-4 text-sm sm:grid-cols-4">
        <Card label="Contact" onEdit={readOnly ? undefined : () => setModal("contact")}>
          {contact && contactName(contact) ? (
            <div className="text-gray-700">
              <div className="font-medium text-gray-900">{contactName(contact)}</div>
              {contact.address && <div>{contact.address}</div>}
              {(contact.city || contact.state || contact.postal) && (
                <div>{[contact.city, contact.state, contact.postal].filter(Boolean).join(" ")}</div>
              )}
              {contact.email && <div>{contact.email}</div>}
              {contact.phone && <div>{contact.phone}</div>}
            </div>
          ) : readOnly ? (
            <span className="text-gray-400">—</span>
          ) : (
            <button onClick={() => setModal("contact")} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50">
              + Add contact
            </button>
          )}
        </Card>

        <Card label="Job Address" onEdit={readOnly ? undefined : () => setModal("job")}>
          {jobAddress && (jobAddress.address || jobAddress.city) ? (
            <div className="text-gray-700">
              <div>{jobAddress.address}</div>
              <div>{[jobAddress.city, jobAddress.state, jobAddress.postal].filter(Boolean).join(" ")}</div>
            </div>
          ) : readOnly ? (
            <span className="text-gray-400">—</span>
          ) : (
            <button onClick={() => setModal("job")} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50">
              + Add address
            </button>
          )}
        </Card>

        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">{docTitle} ID</div>
          <div className="mt-1 text-gray-700">{estimateId}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">Date</div>
          <div className="mt-1 text-gray-700">{dateStr}</div>
        </div>
      </div>

      {modal === "contact" && (
        <ContactModal
          contacts={contacts}
          initial={contact ?? EMPTY_CONTACT}
          onClose={() => setModal(null)}
          onSave={(c) => { onContact(c); setModal(null); }}
        />
      )}
      {modal === "job" && (
        <JobModal
          initial={jobAddress ?? EMPTY_JOB}
          contact={contact}
          onClose={() => setModal(null)}
          onSave={(j) => { onJobAddress(j); setModal(null); }}
        />
      )}
    </div>
  );
}

function Card({ label, onEdit, children }: { label: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-gray-400">{label}</span>
        {onEdit && (
          <button onClick={onEdit} className="text-xs text-gray-400 hover:text-gray-700" aria-label={`Edit ${label}`}>✎</button>
        )}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close">✕</button>
        </div>
        <div className="mt-4">{children}</div>
        <div className="mt-5 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block text-xs">
      <span className="text-gray-500">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
    </label>
  );
}

function ContactModal({ contacts, initial, onClose, onSave }: { contacts: Contact[]; initial: Contact; onClose: () => void; onSave: (c: Contact) => void }) {
  const [c, setC] = useState<Contact>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (patch: Partial<Contact>) => setC((x) => ({ ...x, ...patch }));

  /** Tom (24 Aug): half-entered mobiles/emails never save — they're what
   * makes a text or an invoice email silently go nowhere later. */
  function refuseBadFields(): boolean {
    const problem = contactFieldProblems(c);
    if (problem) { setMsg(problem); return true; }
    return false;
  }

  async function saveToContacts() {
    if (refuseBadFields()) return;
    setSaving(true); setMsg("");
    try {
      const supabase = createClient();
      const row = {
        first_name: c.first_name || "Unnamed", last_name: c.last_name || null, company: c.company || null,
        email: c.email || null, phone: c.phone || null, address: c.address || null,
        city: c.city || null, state: c.state || null, postal: c.postal || null,
      };
      if (c.id) {
        const { error } = await supabase.from("contacts").update(row).eq("id", c.id);
        if (error) throw error;
        onSave(c);
      } else {
        const { data, error } = await supabase.from("contacts").insert(row).select("id").single();
        if (error) throw error;
        onSave({ ...c, id: data.id });
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save to Contacts");
    } finally { setSaving(false); }
  }

  return (
    <Modal
      title="Edit Contact"
      onClose={onClose}
      footer={
        <>
          {msg && <span className="mr-auto text-xs text-red-600">{msg}</span>}
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={() => { if (!refuseBadFields()) onSave(c); }} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Use on estimate</button>
          <button onClick={saveToContacts} disabled={saving} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save to Contacts"}
          </button>
        </>
      }
    >
      {contacts.length > 0 && (
        <label className="mb-4 block text-xs">
          <span className="text-gray-500">Pick an existing contact</span>
          <select
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            value={c.id ?? ""}
            onChange={(e) => {
              const found = contacts.find((x) => x.id === e.target.value);
              if (found) setC(found);
            }}
          >
            <option value="">— new contact —</option>
            {contacts.map((x) => (
              <option key={x.id} value={x.id}>{contactName(x)}{x.city ? ` · ${x.city}` : ""}</option>
            ))}
          </select>
        </label>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" value={c.first_name} onChange={(v) => set({ first_name: v })} />
        <Field label="Last name" value={c.last_name} onChange={(v) => set({ last_name: v })} />
        <Field label="Company" value={c.company} onChange={(v) => set({ company: v })} />
        <Field label="Phone" value={c.phone} onChange={(v) => set({ phone: v })} />
        <Field label="Email" value={c.email} onChange={(v) => set({ email: v })} type="email" />
        <div />
        <Field label="Address" value={c.address} onChange={(v) => set({ address: v })} />
        <Field label="City" value={c.city} onChange={(v) => set({ city: v })} />
        <Field label="State" value={c.state} onChange={(v) => set({ state: v })} />
        <Field label="Postcode" value={c.postal} onChange={(v) => set({ postal: v })} />
      </div>
    </Modal>
  );
}

function JobModal({ initial, contact, onClose, onSave }: { initial: JobAddress; contact: Contact | null; onClose: () => void; onSave: (j: JobAddress) => void }) {
  const [j, setJ] = useState<JobAddress>(initial);
  const set = (patch: Partial<JobAddress>) => setJ((x) => ({ ...x, ...patch }));
  // The same address lookup as the wizard (one brain, two skins) — pick a
  // suggestion and every field fills; keep typing and it's a plain input.
  const { suggestions, open, setOpen, lookup, resolve } = useAddressLookup();

  async function pick(s: AddressSuggestion) {
    const resolved = await resolve(s);
    if (resolved) {
      setJ({
        address: resolved.address.street,
        city: resolved.address.suburb,
        state: resolved.address.state,
        postal: resolved.address.postcode,
      });
    } else {
      set({ address: `${s.main}, ${s.secondary}` });
    }
  }
  return (
    <Modal
      title="Edit Job Address"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={() => onSave(j)} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">Confirm</button>
        </>
      }
    >
      {contact && contact.address && (
        <button
          onClick={() => setJ({ address: contact.address, city: contact.city, state: contact.state, postal: contact.postal })}
          className="mb-3 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
        >
          Use contact address
        </button>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="relative col-span-2">
          <label className="block text-xs">
            <span className="text-gray-500">Address</span>
            <input
              value={j.address}
              autoComplete="off"
              placeholder="Start typing the street address…"
              data-testid="job-address-input"
              onChange={(e) => { set({ address: e.target.value }); lookup(e.target.value); }}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onFocus={() => { if (suggestions.length) setOpen(true); }}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          {open && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
              {suggestions.map((s) => (
                <button
                  key={s.placeId}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                  onMouseDown={(e) => { e.preventDefault(); void pick(s); }}
                >
                  <b>{s.main}</b>
                  {s.secondary && <span className="text-gray-500"> {s.secondary}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <Field label="City" value={j.city} onChange={(v) => set({ city: v })} />
        <Field label="State" value={j.state} onChange={(v) => set({ state: v })} />
        <Field label="Postcode" value={j.postal} onChange={(v) => set({ postal: v })} />
      </div>
    </Modal>
  );
}
