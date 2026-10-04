---
feature: contacts
role: staff
title: Contacts — every customer in one list, and how a contact gets onto an estimate
summary: The Contacts list holds every CRM customer and every person ever used on an estimate; the estimate's Contact card has a search bar at the top to find them, and whatever you put on an estimate is saved to the list by itself.
sources: app/(app)/contacts/page.tsx, app/quote/EstimateHeader.tsx, app/quote/actions.ts, lib/contacts/match.ts, supabase/migrations/20270210000000_contacts_from_crm_accounts.sql
---

## What this is for
The office's address book. Since 4 Oct 2026 it is complete on its own: every customer in the CRM is in it (the wizard, Quick add, the imported history and the builder all create CRM customers, and each one is mirrored here the moment it exists), and every contact you use on an estimate is saved here as part of using it. There is no longer a "save to contacts" step to remember.

## Before you start
Nothing. Open **Contacts** from the sidebar, or open an estimate and press **+ Add contact** / the pencil on the Contact card.

## Steps
1. On an estimate, press **+ Add contact** (or the pencil beside **Contact**).
2. Type in the **Find an existing contact** box at the top of the window — a name, a company, an email, a mobile (with or without spaces) or a suburb. Up to eight matches appear under the box.
3. Press a match. The form fills with that person; a line under the box says you are editing them from Contacts, so any change you make saves back to the list.
4. No match? The box says so. Fill in the form — first name, mobile, email, address — and the person is added to Contacts when you press **Use on estimate**.
5. Press **Use on estimate**. The contact is saved to Contacts and placed on the estimate in one go. If a field is half-typed (a short mobile, an email with no domain) or nothing at all is typed, the window stays open and says why.
6. **Start a new contact** (under the search box, once a contact is picked) clears the form if you picked the wrong person.

## What the colours and labels mean
- **Editing … from Contacts** — the form holds a row from the list; changes save back to it.
- **No contact matches …** — nothing in the list fits; fill in the form and it becomes a new contact.
- **Enter at least a name, a mobile or an email** — the form is empty; a contact needs one way to be found.

## If something goes wrong
- *A customer from the CRM is not in the search.* Match on the exact spelling in the CRM; the search is a plain "contains". If the customer was added to the CRM before 4 Oct 2026 and is still missing, the backfill has not been run on this environment — tell Tom.
- *Two entries for one person.* The CRM's duplicate finder (CRM → customer → merge) is the fix; the Contacts row of the dropped duplicate is kept, with its link to the dropped account cleared.
- *The contact window says the save failed.* The estimate did not get the contact. Try again; if it keeps failing, the error text is what to send to Tom.

## Related
- [Online estimates from the office side](../estimator/staff.md) — the Contact card's other fields (landline, secondary contact).
- [Your first hour in the CRM](../crm/staff.md) — the customer record the contact mirrors.
