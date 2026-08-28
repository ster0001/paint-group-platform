# F0 · Company profile moves out of source — manual steps

**Audit finding:** A6-01. `app/quote/company.ts` carried Paint Group's real ABN,
address, bank name, BSB, account number and the director's personal mobile, as a
committed constant. Two CLAUDE.md rules broken: *"bank/payment details …
displayed masked"* and *"no secrets, keys, or real customer data in the repo, in
seed scripts, or in test fixtures."*

`DEFAULT_COMPANY` is now empty strings — a shape, not a record. Every reader
already spreads settings over it:

```ts
{ ...DEFAULT_COMPANY, ...(settings.company_profile ?? {}) }
```

so **behaviour is identical once `settings.company_profile` is fully populated —
and blank letterheads if it is not.**

---

## ⚠️ Order matters

**1. Check production FIRST — before deploying this branch.**

```sql
select key, jsonb_pretty(value) from public.settings
 where key in ('company_profile', 'invoicing_bank', 'invoicing_entity');
```

Confirm `company_profile` has a non-empty value for **every** key below. Any key
missing there now renders blank after this branch ships, because the constant no
longer fills the gap:

```
name · addressLine1 · addressLine2 · phone · abn · logoUrl · logoUrlLight
estimatorName · estimatorTitle · estimatorPhone · email
bankName · bsb · acc · bank
```

**2. If anything is missing, fill it in through the UI, not by hand.**

Settings → Company profile, and Settings → Invoicing (which writes
`company_profile` *and* `invoicing_bank` in one save — the banking is
single-sourced). Using the screens keeps the two rows aligned, which a manual
`upsert` does not.

If you would rather paste SQL, use this shape — **fill the values in yourself and
do not commit the result**, or the finding simply moves file:

```sql
update public.settings
   set value = value || jsonb_build_object(
         'bsb',  '<BSB>',
         'acc',  '<account number>',
         'bankName', '<account name>',
         'bank', '<bank>'
       )
 where key = 'company_profile';
```

**3. Then deploy, and verify on a real document.**

- Open any sent estimate at `/e/<token>` — letterhead shows name, address, ABN,
  phone, email.
- Open any invoice at `/i/<token>` — bank block shows account name, BSB, account.
- Both must match what they showed before this branch. Anything blank means step 1
  was incomplete; fill it in Settings and refresh — no redeploy needed.

---

## Also changed

A real personal mobile was in use as a **test fixture** in three places
(`lib/messaging/config.ts`, `lib/messaging/config.test.ts`,
`lib/validation/contact.test.ts`). Replaced with **0491 570 006**, inside the
range ACMA reserves for fictional use (0491 570 006 – 0491 570 156), so no real
number sits in a fixture. No behaviour change — it is still a valid AU mobile.

`docs/SESSION-HANDOFF.md` had the BSB and account in prose. Redacted.

## Still open after this

Removing the values from HEAD does **not** remove them from git history. For a
*receiving* account printed on every invoice you send, that is a low-consequence
disclosure and rewriting history is not proportionate — but it is your call, and
worth knowing before any external code review (§8.8).

CLAUDE.md also asks that bank details be **encrypted at rest and displayed
masked**. This fix only gets them out of the repo. Encryption and masking are
unbuilt and belong with F2 — recorded, not silently absorbed into this fix.
