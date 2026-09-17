import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who a customer-facing send about an ESTIMATE goes to — one answer.
 *
 * Tom, 17 Sep 2026: the variation signing link for 1/41 Devoy Street never
 * arrived. The variation sender read the contact from `builder_state.contact`
 * ONLY, while invoices, updates, reminders and the appointment email read the
 * sent snapshot (`sent_snapshot.contactEmail`) with the builder contact as a
 * fallback. A job whose builder contact was never filled in — imported and
 * office-entered jobs — had an email everywhere except where the variation
 * looked, and the auto-email's failure was a console line nobody saw.
 *
 * Order: builder contact → sent snapshot → the linked account. First name:
 * builder contact → accepted name's first word → "there".
 */
export type CustomerContact = {
  firstName: string;
  email: string | null;
  phone: string | null;
};

type BuilderContact = { first_name?: unknown; email?: unknown; phone?: unknown };
type SentSnapshot = { contactEmail?: unknown; contactName?: unknown; contactPhone?: unknown };
type AccountRow = { email?: unknown; phone?: unknown } | null;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function resolveCustomerContact(input: {
  builderState: unknown;
  sentSnapshot: unknown;
  acceptedName: string | null;
  account: AccountRow;
}): CustomerContact {
  const contact = ((input.builderState as { contact?: BuilderContact } | null)?.contact ?? {}) as BuilderContact;
  const snap = (input.sentSnapshot ?? {}) as SentSnapshot;
  const account = input.account ?? {};

  const email = str(contact.email) || str(snap.contactEmail) || str(account.email) || null;
  const phone = str(contact.phone) || str(snap.contactPhone) || str(account.phone) || null;
  const firstName =
    str(contact.first_name)
    || (str(input.acceptedName) || str(snap.contactName)).split(/\s+/)[0]
    || "there";

  return { firstName, email, phone };
}

export type LoadedCustomerContact =
  | { ok: true; contact: CustomerContact; accountId: string | null }
  | { ok: false; message: string };

/** The estimate's contact, resolved the one way. A rejected read is reported, never an empty contact. */
export async function loadCustomerContact(db: SupabaseClient, estimateId: string): Promise<LoadedCustomerContact> {
  const { data, error } = await db
    .from("estimates")
    .select("builder_state, sent_snapshot, accepted_name, account_id, accounts(email, phone)")
    .eq("id", estimateId)
    .maybeSingle();
  if (error) return { ok: false, message: `Couldn't read the estimate's contact: ${error.message}` };
  if (!data) return { ok: false, message: "That estimate no longer exists." };
  const row = data as unknown as {
    builder_state: unknown; sent_snapshot: unknown; accepted_name: string | null; account_id: string | null;
    accounts: { email: string | null; phone: string | null } | null;
  };
  return {
    ok: true,
    accountId: row.account_id,
    contact: resolveCustomerContact({
      builderState: row.builder_state,
      sentSnapshot: row.sent_snapshot,
      acceptedName: row.accepted_name,
      account: row.accounts,
    }),
  };
}
