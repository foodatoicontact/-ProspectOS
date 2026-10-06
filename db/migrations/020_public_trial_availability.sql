-- Is a free-trial seat still open? One boolean, for anyone (the landing page and the demo are public).
--
-- The demo banner and the sign-up promise "7 jours gratuitement"; once the beta capacity is reached that
-- promise is false (activate_trial refuses with BETA_CAPACITY_REACHED), so the public pages must switch to the
-- subscription choice. They need to know WHETHER a seat is left, nothing more: this returns a boolean only —
-- never the number of seats, the capacity or any account. Same rule as activate_trial (018: beta_seats_used,
-- REVOKED rows give their seat back), so it flips exactly when the trial closes. Read-only, no lock: a race
-- with the last sign-up is settled by activate_trial itself, which stays the only gate.
--
-- Rollback: drop function if exists public.trial_available();
begin;

create or replace function public.trial_available() returns boolean
language sql stable security definer set search_path='' as $$
 select prospectos_private.beta_seats_used() < (select capacity from prospectos_private.beta_program where singleton)
$$;
revoke all on function public.trial_available() from public;
grant execute on function public.trial_available() to anon, authenticated;

commit;
