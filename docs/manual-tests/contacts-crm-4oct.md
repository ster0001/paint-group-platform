# Manual test — contact search bar, CRM customers in Contacts, always saved (4 Oct 2026)

Branch `feat/estimate-contact-search-crm-import`. Automated: `e2e/estimate-contact-search.spec.ts`
(3/3 on C1), `lib/contacts/match.test.ts`, `lib/testing/hygiene.test.ts`.

## Migration to paste

`supabase/migrations/20270210000000_contacts_from_crm_accounts.sql` — paste the whole file. It prints
TWO result rows: first `backfilled` (how many CRM customers were added to Contacts — on the test
project it was 1,089), then the read-back row. Expect `new_cols 3`, `trigger_on 1`,
`accounts_without_contact 0`, `fn_grants 0`, `rls_on true`. The last line writes the `_prod_migrations`
row. Safe to paste before or after the deploy: the trigger and backfill need no app change, and the
new modal works without the column (it only inserts the columns it always did).

Then the Security Advisor: still 0 errors (two new SECURITY DEFINER functions, both with
`search_path` pinned and no grants).

## Walk, as staff

1. **Contacts** in the sidebar: the list is now long — every CRM customer is in it. Spot-check one
   wizard customer and one imported one by name; the row carries their email, mobile and the
   address of their latest property.
2. Open any estimate → pencil beside **Contact** (or **+ Add contact** on a new one). A **Find an
   existing contact** box sits at the top of the window, above First name.
3. Type part of a surname → up to eight matches under the box → press one → the form fills, and a
   line says "Editing … from Contacts — changes save back to the list". **Start a new contact**
   clears it.
4. Type a mobile without spaces ("0412345") → the same person is found. Type nonsense → "No
   contact matches …".
5. Fill a brand-new person (name + a full mobile) and press **Use on estimate** (the only dark
   button; "Save to Contacts" is gone). The window closes, the card shows them — and they are
   already on the **Contacts** page before you save the estimate.
6. Press **Use on estimate** with nothing typed → "Enter at least a name, a mobile or an email."
   With a half mobile → the usual "doesn't look like a full Australian mobile".
7. CRM → **Quick add** a customer with a new mobile → they appear on Contacts straight away
   (the trigger). Add the same person again from the wizard with the same email → still one
   Contacts row.
