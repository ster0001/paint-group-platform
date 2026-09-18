# Manual test · emailing a contractor invitation (18 Sep 2026)

Branch `feat/contractor-invite`. Migration `20270168000000_contractor_invite_emailed.sql` (two columns; read-back expects
`emailed_at_ok true · emailed_count_ok true · rls_on true · policies ≥ 1`). Automated: `e2e/contractor-invite-email.spec.ts`.

1. Contractors → **+ Invite a contractor** → email, name, company, tier → leave **Email them the link now** ticked → **Create & email invite**. Green line: "Invitation emailed to …". The painter receives "You're invited to join Paint Group" with the /join link, the expiry day and the office phone; Reply-To is the company email.
2. **Waiting to join** shows the row with "emailed 18/9". **Email again** → "(×2)". **Copy link** still works.
3. Untick the box → **Create invite link** → the row says "not emailed yet" (amber) → **Email the link** sends it.
4. Revoke an invite → it leaves the list; the link says it was cancelled.
5. (Server without RESEND_API_KEY) the same click says "Email isn't configured on this server — copy the link instead" and the row stays "not emailed yet".
