import type { SupabaseClient } from "@supabase/supabase-js";
import { addressKey, normaliseEmail, type AddressParts } from "./identity";

/**
 * 3a-1 · Find-or-create the account (and property, when a real street address
 * exists) for an estimate save. Runs on the SERVER through the service client
 * or a staff session — never from a browser.
 *
 * CRM v2 P1 (deep dive §4.1, decision 8.2): identity is an email OR a phone.
 * `crm_find_account` (migration 20270120) resolves either — account email,
 * contact email, account phone, contact phone, in that order — so a phone
 * enquiry with no email address is a customer, and a second estimate from
 * the same mobile lands on the same record. An existing record's blank
 * phone or email is filled from what the caller knows; a stored one is
 * never overwritten here (the record page is where a person corrects it).
 *
 * Security rule (documented in the migration): this links the ESTIMATE into
 * the account chain. It never creates account_users rows — an unverified
 * email typed into the wizard must not grant anyone read access to an
 * existing account. Membership is granted only by the 3a-2 magic-link flow,
 * where clicking the emailed link proves possession of the address.
 *
 * Degrades gracefully: until the migrations run, the tables/columns are
 * missing and every caller gets { migrationPending: true } back — the wizard
 * keeps saving estimates exactly as before (inert-but-safe rule).
 */

export type EnsureAccountInput = {
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  /** Decision 8.5: whoever creates the record owns it, unless told otherwise. */
  ownerId?: string | null;
  address?: AddressParts & { state?: string | null };
};

export type EnsureAccountResult = {
  accountId: string | null;
  propertyId: string | null;
  migrationPending?: boolean;
};

const MISSING_SCHEMA = new Set(["42P01", "42703", "42883", "PGRST202"]); // undefined table / column / function

function schemaMissing(error: { code?: string } | null): boolean {
  return !!error?.code && MISSING_SCHEMA.has(error.code);
}

/** Find-or-create the account for an email and/or phone. The single account
 * identity rule — the wizard save, the backfill and the verified magic-link
 * login all resolve a person to an account through here. */
export async function ensureAccount(
  db: SupabaseClient,
  input: Omit<EnsureAccountInput, "address">,
): Promise<{ accountId: string | null; migrationPending?: boolean }> {
  const email = normaliseEmail(input.email);
  const validEmail = email.includes("@") ? email : "";
  const phone = input.phone?.trim() || "";
  if (!validEmail && !phone) return { accountId: null };

  // One lookup, either key. Before 20270120 the RPC does not exist: fall back
  // to the email-only select this file always did.
  let accountId: string | null = null;
  const found = await db.rpc("crm_find_account", { p_email: validEmail || null, p_phone: phone || null });
  if (found.error) {
    if (!schemaMissing(found.error) && found.error.code !== "42501") {
      throw new Error(`account lookup failed: ${found.error.message}`);
    }
    if (validEmail) {
      const byEmail = await db.from("accounts").select("id").eq("email", validEmail).maybeSingle();
      if (byEmail.error) {
        if (schemaMissing(byEmail.error)) return { accountId: null, migrationPending: true };
        throw new Error(`account lookup failed: ${byEmail.error.message}`);
      }
      accountId = (byEmail.data as { id: string } | null)?.id ?? null;
    }
  } else {
    accountId = (found.data as string | null) ?? null;
  }

  if (accountId) {
    await fillBlanks(db, accountId, { email: validEmail || null, phone: phone || null, name: input.name?.trim() || null });
    return { accountId };
  }

  const inserted = await db
    .from("accounts")
    .insert({
      email: validEmail || null,
      name: input.name?.trim() || null,
      phone: phone || null,
      ...(input.ownerId ? { owner_id: input.ownerId } : {}),
    })
    .select("id")
    .single();
  if (inserted.error) {
    // 23505 = a concurrent save created it between our select and insert.
    // The retry select has a DIFFERENT shape from the first one — inside a
    // single request Next memoises byte-identical fetches, and an identical
    // retry would return the pre-insert empty result (the WO-loop lesson).
    if (inserted.error.code === "23505" && validEmail) {
      const again = await db.from("accounts").select("id, created_at").eq("email", validEmail).maybeSingle();
      accountId = (again.data as { id: string } | null)?.id ?? null;
    } else if (inserted.error.code === "23514") {
      // accounts_reachable: a phone that could not be normalised and no email.
      // Not a record we can ever reach — the caller keeps its estimate and
      // nothing links, the same outcome "no email" always had.
      return { accountId: null };
    } else if (schemaMissing(inserted.error)) {
      return { accountId: null, migrationPending: true };
    }
    if (!accountId) throw new Error(`account create failed: ${inserted.error.message}`);
  } else {
    accountId = (inserted.data as { id: string }).id;
  }
  return { accountId };
}

/** An existing record learns a phone or an email it did not have. Never
 *  overwrites — a stored value is the office's to change on the record. */
async function fillBlanks(db: SupabaseClient, accountId: string, known: { email: string | null; phone: string | null; name: string | null }) {
  const current = await db.from("accounts").select("email, phone, name").eq("id", accountId).maybeSingle();
  const row = current.data as { email: string | null; phone: string | null; name: string | null } | null;
  if (!row) return;
  const patch: Record<string, string> = {};
  if (!row.email && known.email) patch.email = known.email;
  if (!row.phone && known.phone) patch.phone = known.phone;
  if (!row.name && known.name) patch.name = known.name;
  if (Object.keys(patch).length === 0) return;
  // A unique-email collision here means the email belongs to ANOTHER account
  // — a duplicate for the finder to surface, not something to fail a save on.
  await db.from("accounts").update(patch).eq("id", accountId);
}

export async function ensureAccountAndProperty(
  db: SupabaseClient,
  input: EnsureAccountInput,
): Promise<EnsureAccountResult> {
  const ensured = await ensureAccount(db, input);
  if (!ensured.accountId) {
    return { accountId: null, propertyId: null, migrationPending: ensured.migrationPending };
  }
  const accountId = ensured.accountId;

  const { propertyId, migrationPending } = await ensureProperty(db, accountId, input.address ?? {});
  return { accountId, propertyId, migrationPending };
}

/** Find-or-create a property under an account — the one address-dedupe rule,
 * shared by the wizard save and the portal's add-address flow (3a-6). */
export async function ensureProperty(
  db: SupabaseClient,
  accountId: string,
  address: AddressParts & { state?: string | null },
): Promise<{ propertyId: string | null; migrationPending?: boolean }> {
  // Only a real street address earns a property.
  const key = addressKey(address);
  if (!key) return { propertyId: null };

  const foundProp = await db
    .from("properties")
    .select("id")
    .eq("account_id", accountId)
    .eq("address_norm", key)
    .maybeSingle();
  if (foundProp.error) {
    if (schemaMissing(foundProp.error)) return { propertyId: null, migrationPending: true };
    throw new Error(`property lookup failed: ${foundProp.error.message}`);
  }
  let propertyId = (foundProp.data as { id: string } | null)?.id ?? null;

  if (!propertyId) {
    const inserted = await db
      .from("properties")
      .insert({
        account_id: accountId,
        address: address.street?.trim() || null,
        suburb: address.suburb?.trim() || null,
        state: address.state?.trim() || null,
        postcode: address.postcode?.trim() || null,
        address_norm: key,
      })
      .select("id")
      .single();
    if (inserted.error) {
      if (inserted.error.code === "23505") {
        // Different select shape on the retry — same fetch-memo trap as above.
        const again = await db
          .from("properties")
          .select("id, created_at")
          .eq("account_id", accountId)
          .eq("address_norm", key)
          .maybeSingle();
        propertyId = (again.data as { id: string } | null)?.id ?? null;
      }
      if (!propertyId) throw new Error(`property create failed: ${inserted.error.message}`);
    } else {
      propertyId = (inserted.data as { id: string }).id;
    }
  }
  return { propertyId };
}
