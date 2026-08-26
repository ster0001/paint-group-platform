import type { SupabaseClient } from "@supabase/supabase-js";
import { addressKey, normaliseEmail, type AddressParts } from "./identity";

/**
 * 3a-1 · Find-or-create the account (and property, when a real street address
 * exists) for an estimate save. Runs on the SERVER through the service client
 * or a staff session — never from a browser.
 *
 * Security rule (documented in the migration): this links the ESTIMATE into
 * the account chain. It never creates account_users rows — an unverified
 * email typed into the wizard must not grant anyone read access to an
 * existing account. Membership is granted only by the 3a-2 magic-link flow,
 * where clicking the emailed link proves possession of the address.
 *
 * Degrades gracefully: until migration 20261128 runs, the tables/columns are
 * missing and every caller gets { migrationPending: true } back — the wizard
 * keeps saving estimates exactly as before (inert-but-safe rule).
 */

export type EnsureAccountInput = {
  email: string;
  name?: string | null;
  phone?: string | null;
  address?: AddressParts & { state?: string | null };
};

export type EnsureAccountResult = {
  accountId: string | null;
  propertyId: string | null;
  migrationPending?: boolean;
};

const MISSING_SCHEMA = new Set(["42P01", "42703"]); // undefined table / column

function schemaMissing(error: { code?: string } | null): boolean {
  return !!error?.code && MISSING_SCHEMA.has(error.code);
}

export async function ensureAccountAndProperty(
  db: SupabaseClient,
  input: EnsureAccountInput,
): Promise<EnsureAccountResult> {
  const email = normaliseEmail(input.email);
  if (!email || !email.includes("@")) return { accountId: null, propertyId: null };

  // ---- account: find by normalised email, create when new ------------------
  const found = await db.from("accounts").select("id").eq("email", email).maybeSingle();
  if (found.error) {
    if (schemaMissing(found.error)) return { accountId: null, propertyId: null, migrationPending: true };
    throw new Error(`account lookup failed: ${found.error.message}`);
  }
  let accountId = (found.data as { id: string } | null)?.id ?? null;

  if (!accountId) {
    const inserted = await db
      .from("accounts")
      .insert({
        email,
        name: input.name?.trim() || null,
        phone: input.phone?.trim() || null,
      })
      .select("id")
      .single();
    if (inserted.error) {
      // 23505 = a concurrent save created it between our select and insert.
      // The retry select has a DIFFERENT shape from the first one — inside a
      // single request Next memoises byte-identical fetches, and an identical
      // retry would return the pre-insert empty result (the WO-loop lesson).
      if (inserted.error.code === "23505") {
        const again = await db.from("accounts").select("id, created_at").eq("email", email).maybeSingle();
        accountId = (again.data as { id: string } | null)?.id ?? null;
      } else if (schemaMissing(inserted.error)) {
        return { accountId: null, propertyId: null, migrationPending: true };
      }
      if (!accountId) throw new Error(`account create failed: ${inserted.error.message}`);
    } else {
      accountId = (inserted.data as { id: string }).id;
    }
  }

  // ---- property: only a real street address earns one ----------------------
  const key = addressKey(input.address ?? {});
  if (!key) return { accountId, propertyId: null };

  const foundProp = await db
    .from("properties")
    .select("id")
    .eq("account_id", accountId)
    .eq("address_norm", key)
    .maybeSingle();
  if (foundProp.error) {
    if (schemaMissing(foundProp.error)) return { accountId, propertyId: null, migrationPending: true };
    throw new Error(`property lookup failed: ${foundProp.error.message}`);
  }
  let propertyId = (foundProp.data as { id: string } | null)?.id ?? null;

  if (!propertyId) {
    const inserted = await db
      .from("properties")
      .insert({
        account_id: accountId,
        address: input.address?.street?.trim() || null,
        suburb: input.address?.suburb?.trim() || null,
        state: input.address?.state?.trim() || null,
        postcode: input.address?.postcode?.trim() || null,
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

  return { accountId, propertyId };
}
