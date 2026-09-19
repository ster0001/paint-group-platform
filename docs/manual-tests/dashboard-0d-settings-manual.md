# Manual test — Home dashboard v2 · session 0d (Settings and roles)

Run `20270179000000_dashboard_settings_roles.sql` (start with `set lock_timeout = '15s';`) and
read the select at its end: expect `role_type_expect_1 = 1`, `roles_column_expect_1 = 1`,
`new_tables_expect_2 = 2`, `policies_expect_2 = 2`, `functions_expect_3 = 3`,
`guard_covers_roles = true`, `threshold_settings_expect_4 = 4`, `staff_with_roles_expect_0 = 0`.
`master_users` is how many master logins exist (yours).

1. **Staff logins** (as the master user): every row has a **Dashboard roles** line. Tick Sales on
   an office login, Save. Tick Project coordinator too — both stay ticked.
2. **Dashboard folder** (Company bucket, after Staff logins): visible to you. Set January's target
   to 120,000; the row reads Jan · $120,000. Save 130,000 for the same month: one row, updated.
3. Save a marketing spend row: Paid Google, 2,500. It lists with its channel.
4. Change silent-contractor days to 4, Save; reload — it reads 4. Put it back to 3.
5. **As a non-owner login** with only Sales ticked: Settings shows Staff logins (read-only) and NO
   Dashboard folder. Their view of `/settings#dashboard` shows nothing.
6. A person cannot promote themselves: only the master user's ticks stick.
