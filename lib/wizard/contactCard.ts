import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";

/**
 * The wizard's contact → the estimate's Contact card AND the Contacts list
 * (Tom, 7 Sep 2026: "contact information needs to be automatically added
 * from the wizard into the estimate — as well as saved in contacts").
 *
 * The builder's Contact card reads `builder_state.contact` in its own shape
 * (first/last name, address parts); the Contacts page reads the `contacts`
 * table. Both used to be filled only by hand from the builder. One helper
 * builds the card from the wizard's answers; the other finds-or-creates the
 * Contacts row by email so a returning customer never becomes a duplicate.
 */

export type BuilderContact = {
  id?: string;
  first_name: string; last_name: string; company: string;
  email: string; phone: string; address: string; city: string; state: string; postal: string;
};

export type WizardContactInput = {
  name: string; email: string; phone: string;
  address?: { street: string; suburb: string; state: string; postcode: string } | null;
};

export function builderContactFrom(input: WizardContactInput): BuilderContact {
  const parts = input.name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.slice(1).join(" ");
  return {
    first_name: first,
    last_name: last,
    company: "",
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    address: input.address?.street ?? "",
    city: input.address?.suburb ?? "",
    state: input.address?.state ?? "",
    postal: input.address?.postcode ?? "",
  };
}

/** Find-or-create the Contacts row by email; returns the row id (null when nothing usable). Best-effort. */
export async function upsertWizardContact(db: SupabaseClient, c: BuilderContact): Promise<string | null> {
  const email = c.email.trim().toLowerCase();
  if (!email.includes("@") && !c.phone.trim()) return null;
  try {
    const row = {
      first_name: c.first_name || "Unnamed", last_name: c.last_name || null, company: c.company || null,
      email: email || null, phone: c.phone || null, address: c.address || null,
      city: c.city || null, state: c.state || null, postal: c.postal || null,
    };
    if (email) {
      const { data: existing } = await db.from("contacts").select("id, address").ilike("email", email).limit(1).maybeSingle();
      if (existing?.id) {
        // Fill what the wizard knows; never blank a field the office typed.
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) if (v != null && v !== "") patch[k] = v;
        const { error } = await db.from("contacts").update(patch).eq("id", existing.id);
        if (error) reportError(error, { where: "wizard.contacts.update", bestEffort: true });
        return existing.id as string;
      }
    }
    const { data, error } = await db.from("contacts").insert(row).select("id").single();
    if (error) { reportError(error, { where: "wizard.contacts.insert", bestEffort: true }); return null; }
    return (data?.id as string) ?? null;
  } catch (e) {
    reportError(e, { where: "wizard.contacts", bestEffort: true });
    return null;
  }
}
