-- =============================================================================
-- Fix: the column-level REVOKE in 20260824000000 had no effect.
--
-- In PostgreSQL, a column-level privilege is only consulted when the role does
-- NOT already hold the table-level privilege. Supabase grants table-wide UPDATE
-- on public.* to `authenticated`, so
--     revoke update (offerable, ...) on public.contractors from authenticated;
-- was silently a no-op — the table-level grant still covered every column.
--
-- Verified against the live database: a signed-in contractor could still run
--     update contractors set offerable = true where id = <their own>
-- and have it succeed. That let a contractor mark themselves available for work
-- without any insurance certificate on file.
--
-- The correct shape is revoke-the-table-then-grant-the-columns-you-want.
--
-- Withheld from everyone signed in (contractor AND staff):
--   offerable            — computed by contractor_recompute_offerable()
--   bank_account_enc     — written only by contractor_set_bank()
--   bank_account_last4   — ditto
--   id, profile_id       — identity, never edited in place
--   created_at, updated_at — timestamps (updated_at is set by its own trigger,
--                            which does not need the caller to hold the column)
--
-- Everything else stays writable, so the portal's company-details form and any
-- future staff admin screen are unaffected. SECURITY DEFINER functions run as
-- the owner and are not touched by any of this.
-- =============================================================================

do $$
declare v_cols text;
begin
  -- Build the allow-list from the live table so a column added later is
  -- writable by default, and only the sensitive ones above stay withheld.
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'contractors'
     and column_name not in (
       'id', 'profile_id', 'created_at', 'updated_at',
       'offerable', 'bank_account_enc', 'bank_account_last4'
     );

  if v_cols is null then
    raise exception 'public.contractors not found — run the Phase A migration first';
  end if;

  -- The table-level grant must go first, or the column grants are ignored.
  execute 'revoke update on public.contractors from authenticated';
  execute format('grant update (%s) on public.contractors to authenticated', v_cols);

  raise notice 'contractors: UPDATE now limited to columns: %', v_cols;
end $$;

-- ---- Verification -----------------------------------------------------------
-- Signed in as a contractor, this must now FAIL with a permission error:
--   update public.contractors set offerable = true where profile_id = auth.uid();
-- while this must still succeed:
--   update public.contractors set address = '1 Test St' where profile_id = auth.uid();
--
-- Or list the effective grants:
--   select column_name, privilege_type from information_schema.column_privileges
--    where table_name = 'contractors' and grantee = 'authenticated' and privilege_type = 'UPDATE'
--    order by column_name;
