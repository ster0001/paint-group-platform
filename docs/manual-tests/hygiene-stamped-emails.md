# Manual test — hygiene reaches the stamped journey addresses (11 Oct 2026)

Test project only. Run from a checkout with `.env.test.local` loaded (`set -a; source .env.test.local; set +a`).

1. `node scripts/c1/hygiene.mjs count` — the line reads `anonymous users N · e2e logins M`. M now includes the `e2e-return-…`, `e2e-scroll-…`, `ui.refresh.brief.…` style users, not just `pg.e2e.*`.
2. Actions → **hygiene** → Run workflow (or `node scripts/c1/hygiene.mjs sweep`). The summary line shows users deleted; a second `count` shows M falling.
3. In the Supabase dashboard (C1) → Authentication → Users, search `pg.demo` — all five demo logins (agency, facilities, insurer, finance, volume) are still there, and so are the `pg.*@gmail.com` logins.
4. After the next CI e2e run on main, `count` again — M does not climb by the 15–35 a day it used to.
