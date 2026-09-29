# Manual test — product photos (and every Settings upload) blocked by "violates policy"

Paste `supabase/migrations/20270206000000_bucket_read_for_uploaders.sql` and read the row back:
`uploader_read_policies 7 · anon_can_list 0 · public_can_list 0`. The last line writes the
`_prod_migrations` row.

Then, signed in as staff:

1. Settings → Products → Edit any product → **Upload photo** → pick a JPG/PNG. Expect "Photo uploaded — Save to keep." (was: "new row violates row-level security policy").
2. Settings → Company details → Upload logo. Same.
3. Settings → Presentations → any media upload. Same.
4. An estimate → Job settings → Attach SWMS (PDF). Same.
5. As a contractor: Portal → Profile → logo upload. Same.

Nothing else changes: anonymous visitors still cannot list a bucket (Security Advisor stays at 0 errors).
