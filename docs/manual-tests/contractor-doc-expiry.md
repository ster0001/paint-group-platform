# Manual test — insurance certificates carry their expiry (18 Sep 2026)

Needs `20270169` applied.

1. Sign in as a contractor → Profile → Insurance & licences. Document type **Public liability insurance**. The Expires on label reads "(required)" and a line under it says it can't be saved without one.
2. **Choose file**, pick a PDF → the file name shows beside the button; **Upload** stays greyed out.
3. Enter the expiry → Upload lights up → press it → "Uploaded, expiring <date>"; the row reads "EXPIRES <date>", never "NO EXPIRY".
4. Pick **Licence**, choose a file, no date → Upload is allowed (a licence may have no expiry); the row reads "NO EXPIRY" with a date box and **Save expiry** beside it → set a date → "Expiry saved".
5. Contractors page (staff): the row shows "expires <date>".
