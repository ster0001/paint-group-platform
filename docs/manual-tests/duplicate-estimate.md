# Manual test — Duplicate an estimate from the list (16 Sep 2026)

No migration. Deploys with the code.

## 1. Duplicate a sent estimate that has photos

1. Estimates → **All** tab. Pick a row that came through the wizard with
   photos (its status line says "N photos"), or any sent estimate.
2. Press **Duplicate** on the right of the row (next to Delete). It reads
   "Copying…" for a moment.

Expect: the builder opens on a NEW estimate. The number in the header is
different from the original's (it is the first 8 characters of the new id).
The address field reads the old address with " (copy)" on the end. Every
room, surface, material, colour, inclusion and discount is there. There is
no photo sign-off and no plan or photo on the Pack tab.

## 2. It is already saved

1. Without pressing Save, go back to Estimates → **All**.

Expect: a new **draft** row at the top, titled "<original title> (copy)",
with "<address> (copy), <suburb>" under it. Open it: everything from step 1
is still there.

## 3. The original is untouched

1. Open the original estimate.

Expect: still sent (or whatever it was), same number, same customer link,
photos still on the Pack tab.

## 4. Edit and send the copy

1. On the copy, change the address to the new house and the contact if it is
   a different customer. Press Save, then Send.

Expect: it sends like any other estimate, with its own link (the customer's
link on the original still works and still shows the original).

## 5. A copy of a copy

Press Duplicate on the copy. Expect a row named "… (copy 2)".

## 6. Accepted estimates can be duplicated

Press Duplicate on an accepted estimate. Expect a new draft copy — accepted
estimates still cannot be deleted (no Delete link), but they can be copied.
