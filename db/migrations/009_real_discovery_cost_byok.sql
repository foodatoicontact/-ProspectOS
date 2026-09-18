-- Real Discovery cost metering + BYOK foundation. Additive only — no existing column, policy, grant,
-- trigger, or invariant touched. Discovery's own pipeline (SOURCE -> OBSERVATION -> REVIEW -> EVIDENCE
-- -> SCORE), its quotas, its RLS, and event_immutable are all completely untouched by this migration.
--
-- Scope: this repo has exactly two paid-provider call sites today — BraveProvider.searchCompanies
-- (src/discovery/providers/brave.ts) and analyzeOffer (src/server/ai.ts, Anthropic/OpenAI). Everything
-- below exists to measure the real cost of those two calls, never to invent one.
begin;

-- Append-only cost ledger. One row per real provider call that actually happened — never written for
-- the fixture/test provider (TEST never has a real cost; see src/server/usage.ts). Written exclusively
-- by server-side trusted code through a service-role client (see src/server/admin-client.ts), the same
-- pattern already used by anonymizeAuthUser: no INSERT/UPDATE/DELETE grant to `authenticated` or `anon`
-- exists anywhere below, so no logged-in client — and no RPC surface reachable by one — can ever write
-- or forge a cost record. `api_usage_events_immutable` additionally makes every row immutable at the
-- trigger level (fires for every role, service-role included), exactly like `events`/event_immutable:
-- a future pricing change can never rewrite a past event's frozen estimated_cost_micros/pricing_version.
create table public.api_usage_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 project_id uuid,
 discovery_run_id uuid,
 user_id uuid not null references auth.users(id),
 provider text not null check(provider in ('brave','anthropic','openai')),
 operation text not null check(operation in ('search','offer_analysis')),
 model text,
 billing_source text not null default 'PLATFORM' check(billing_source in ('PLATFORM','BYOK')),
 request_count int not null default 1 check(request_count >= 0),
 input_tokens int check(input_tokens >= 0),
 output_tokens int check(output_tokens >= 0),
 units int check(units >= 0),
 currency text not null default 'USD' check(currency = 'USD'),
 -- Integer micro-dollars ($0.012345 = 12345). Null means "no active pricing configured for this
 -- provider/operation/model at call time" — never a fabricated number (see provider_pricing below).
 estimated_cost_micros bigint check(estimated_cost_micros >= 0),
 pricing_version text,
 created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 foreign key(discovery_run_id,project_id,organization_id) references public.discovery_runs(id,project_id,organization_id)
);
create index api_usage_events_tenant_idx on public.api_usage_events(organization_id,created_at desc);
create index api_usage_events_run_idx on public.api_usage_events(discovery_run_id) where discovery_run_id is not null;
alter table public.api_usage_events enable row level security;
create policy api_usage_events_read on public.api_usage_events for select to authenticated using(prospectos_private.is_member(organization_id));
revoke all on public.api_usage_events from public,anon,authenticated;
grant select on public.api_usage_events to authenticated;
create trigger api_usage_events_immutable before update or delete on public.api_usage_events
 for each row execute function prospectos_private.deny_event_mutation();

-- Internal supplier cost catalog — NOT ProspectOS commercial pricing. Never exposed to PostgREST
-- (prospectos_private, zero client grants): the client never reads a price, only the already-computed
-- estimated_cost_micros on its own organization's usage events. Deliberately shipped EMPTY: this bloc
-- does not invent Brave/Anthropic/OpenAI prices. An operator populates it with real, verified, current
-- prices from each provider's own pricing page (see docs/COST_METERING.md for the exact INSERT
-- procedure) — until a row exists, resolvePricing() returns null and estimated_cost_micros stays null,
-- never a guess. A tariff change never rewrites history: insert a new row with a new `version` and
-- effective_from, optionally close the old one's effective_to — never UPDATE price_per_unit_micros on
-- an existing row.
create table prospectos_private.provider_pricing (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider in ('brave','anthropic','openai')),
 operation text not null check(operation in ('search','offer_analysis')),
 model text,
 unit_type text not null check(unit_type in ('request','input_tokens_1k','output_tokens_1k')),
 price_per_unit_micros bigint not null check(price_per_unit_micros >= 0),
 currency text not null default 'USD' check(currency = 'USD'),
 version text not null check(length(trim(version)) between 1 and 40),
 effective_from timestamptz not null default now(),
 effective_to timestamptz,
 created_at timestamptz not null default now(),
 check(effective_to is null or effective_to > effective_from)
);
create index provider_pricing_lookup_idx on prospectos_private.provider_pricing(provider,operation,unit_type,effective_from desc);
revoke all on prospectos_private.provider_pricing from public,anon,authenticated;

-- The ONLY way to read pricing at all (prospectos_private is never exposed to PostgREST, by design —
-- same reason consume_discovery_quota needs a public-schema wrapper). Pure computation, no side effect,
-- no user data touched: takes the real measured quantities (request count / token counts, already
-- converted to the unit the catalog prices — see src/server/pricing.ts) and returns either a computed
-- {estimated_cost_micros, pricing_version} or null the moment ANY involved quantity has no active
-- pricing row — never a partial or fabricated total. Not granted to `authenticated`/`anon` (mirrors the
-- rest of the cost-metering surface: only server-side trusted code, via the service-role client, ever
-- calls this) — service_role keeps EXECUTE by default here exactly as it already does on
-- grant_beta_access, since only public/anon/authenticated are revoked below.
create function public.resolve_provider_cost(p_provider text,p_operation text,p_model text,p_quantities jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q jsonb; total bigint:=0; versions text[]:=array[]::text[]; found_price bigint; found_version text; any_priced boolean:=false;
begin
 if p_provider not in ('brave','anthropic','openai') or p_operation not in ('search','offer_analysis') then raise exception 'Invalid provider/operation' using errcode='22023'; end if;
 if jsonb_typeof(p_quantities)<>'array' then raise exception 'Invalid quantities' using errcode='22023'; end if;
 for q in select value from jsonb_array_elements(p_quantities) loop
  if (q->>'quantity')::numeric <= 0 then continue; end if;
  select price_per_unit_micros,version into found_price,found_version from prospectos_private.provider_pricing
   where provider=p_provider and operation=p_operation and unit_type=(q->>'unit_type')
     and (model=p_model or model is null) and effective_from<=now() and (effective_to is null or effective_to>now())
   order by effective_from desc limit 1;
  if not found then return null; end if;
  total := total + round(found_price * (q->>'quantity')::numeric);
  versions := array_append(versions, found_version); any_priced := true;
 end loop;
 if not any_priced then return null; end if;
 return jsonb_build_object('estimated_cost_micros',total,'pricing_version',(select string_agg(distinct v,'+' order by v) from unnest(versions) v));
end $$;
revoke all on function public.resolve_provider_cost(text,text,text,jsonb) from public,anon,authenticated;

-- BYOK foundation. The raw table is reachable by NO client role at all (RLS enabled, zero policies,
-- zero grants) — not even a self-scoped SELECT: encrypted_secret/iv/auth_tag never leave server-side
-- code. The only surface a logged-in user reaches is the three SECURITY DEFINER functions below, each
-- of which returns only {provider, key_last4, created_at/updated_at} — never a secret, never ciphertext
-- (satisfies "never store in clear" and "never return after saving" directly at the schema level, not
-- just by convention). Encryption/decryption itself happens exclusively in src/server/crypto.ts
-- (AES-256-GCM, server-only master key) — this table only ever stores already-encrypted bytes.
create table public.provider_credentials (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 provider text not null check(provider in ('brave','anthropic','openai')),
 credential_type text not null default 'api_key' check(credential_type in ('api_key')),
 encrypted_secret bytea not null,
 iv bytea not null check(length(iv) = 12),
 auth_tag bytea not null check(length(auth_tag) = 16),
 key_last4 text not null check(key_last4 ~ '^[A-Za-z0-9]{4}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,provider)
);
alter table public.provider_credentials enable row level security;
revoke all on public.provider_credentials from public,anon,authenticated;

-- Requires the acting user to be an OWNER of the organization (not just a member): a BYOK credential
-- changes which API key bills the whole organization's usage of that provider, which is an
-- organization-level decision, mirroring the existing owner-only bar on transfer_organization_ownership.
create function prospectos_private.require_owner(tenant uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.memberships where organization_id=tenant and user_id=auth.uid() and role='owner') then
  raise exception 'Organization owner required' using errcode='42501';
 end if;
end $$;
revoke all on function prospectos_private.require_owner(uuid) from public,anon,authenticated;

create function public.save_provider_credential(p_organization_id uuid,p_provider text,p_encrypted_secret bytea,p_iv bytea,p_auth_tag bytea,p_key_last4 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare row public.provider_credentials;
begin
 perform prospectos_private.require_owner(p_organization_id);
 if p_provider not in ('brave','anthropic','openai') then raise exception 'Invalid provider' using errcode='22023'; end if;
 insert into public.provider_credentials(organization_id,provider,encrypted_secret,iv,auth_tag,key_last4,updated_at)
 values(p_organization_id,p_provider,p_encrypted_secret,p_iv,p_auth_tag,p_key_last4,now())
 on conflict(organization_id,provider) do update set encrypted_secret=excluded.encrypted_secret,iv=excluded.iv,auth_tag=excluded.auth_tag,key_last4=excluded.key_last4,updated_at=now()
 returning * into row;
 return jsonb_build_object('provider',row.provider,'key_last4',row.key_last4,'created_at',row.created_at,'updated_at',row.updated_at);
end $$;
revoke all on function public.save_provider_credential(uuid,text,bytea,bytea,bytea,text) from public,anon;
grant execute on function public.save_provider_credential(uuid,text,bytea,bytea,bytea,text) to authenticated;

create function public.list_provider_credentials(p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant_ok boolean;
begin
 select exists(select 1 from public.memberships where organization_id=p_organization_id and user_id=auth.uid()) into tenant_ok;
 if not tenant_ok then raise exception 'Authenticated tenant member required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('provider',provider,'key_last4',key_last4,'created_at',created_at,'updated_at',updated_at) order by provider)
  from public.provider_credentials where organization_id=p_organization_id),'[]'::jsonb);
end $$;
revoke all on function public.list_provider_credentials(uuid) from public,anon;
grant execute on function public.list_provider_credentials(uuid) to authenticated;

create function public.delete_provider_credential(p_organization_id uuid,p_provider text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform prospectos_private.require_owner(p_organization_id);
 delete from public.provider_credentials where organization_id=p_organization_id and provider=p_provider;
end $$;
revoke all on function public.delete_provider_credential(uuid,text) from public,anon;
grant execute on function public.delete_provider_credential(uuid,text) to authenticated;

commit;
