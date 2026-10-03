-- One-time data repair for accounts deleted BEFORE migration 018: their entitlement row is still ACTIVE, so it
-- still holds a beta seat. Run ONLY after migration 018, and ONLY on explicit GO, in the Supabase SQL editor.
-- Nothing is deleted: the entitlement row is kept and marked REVOKED (the canonical "closed account" state of 018).
--
-- A legacy deleted account is identified by signals that only the server can write, all required together:
--  - email is exactly 'deleted+<its own id>@deleted.invalid' (set by anonymizeAuthUser with the service role);
--  - banned_until is ~100 years ahead (ban set by the same service-role call; a user cannot ban themselves);
--  - it has no membership left (removed by delete_own_account).
-- user_metadata.deleted is deliberately not used: a signed-in user can write their own user_metadata.

-- STEP 1 — dry run (read-only). Expected: exactly the deleted accounts shown in the beta funnel (2 at audit time).
select au.id, au.email, au.banned_until, ae.plan, ae.status, ae.expires_at
from auth.users au
join public.account_entitlements ae on ae.user_id=au.id
where au.email = 'deleted+'||au.id::text||'@deleted.invalid'
  and au.banned_until > now()+interval '50 years'
  and not exists(select 1 from public.memberships m where m.user_id=au.id)
  and ae.plan='BETA' and ae.status<>'REVOKED';

-- STEP 2 — repair (same filter). Set expected_rows to the count returned by STEP 1: if the update touches any
-- other number of rows, the whole block raises and nothing is changed.
do $$
declare expected_rows int := 2; touched int;
begin
 update public.account_entitlements ae set status='REVOKED', updated_at=now()
 from auth.users au
 where au.id=ae.user_id
   and au.email = 'deleted+'||au.id::text||'@deleted.invalid'
   and au.banned_until > now()+interval '50 years'
   and not exists(select 1 from public.memberships m where m.user_id=au.id)
   and ae.plan='BETA' and ae.status<>'REVOKED';
 get diagnostics touched = row_count;
 if touched<>expected_rows then
  raise exception 'Repair aborted: % rows matched, % expected — nothing changed', touched, expected_rows;
 end if;
end $$;

-- STEP 3 — verify (read-only).
select prospectos_private.beta_seats_used() as beta_seats_used,
       (select capacity from prospectos_private.beta_program where singleton) as capacity;

-- Rollback of this repair (if ever needed): set status back to 'ACTIVE' for the user ids listed by STEP 1.
