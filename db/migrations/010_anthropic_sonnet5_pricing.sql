-- BLOC 4A.4.1 — Anthropic claude-sonnet-5 pricing + resolve_provider_cost model-priority hardening.
-- NOT a schema migration: no table, column, or constraint is added/changed. Only (1) a function
-- redefinition (same signature, same privileges — CREATE OR REPLACE preserves grants/ownership) and
-- (2) two idempotent data rows in the existing prospectos_private.provider_pricing catalog (migration
-- 009). Discovery, Evidence, scoreProspect, RLS, BYOK, Account/RGPD: completely untouched.
begin;

-- Hardening (4A.4 Phase 0 audit finding): `(model=p_model or model is null) order by effective_from
-- desc` did not guarantee an exact-model tariff outranked a generic (model IS NULL) fallback — whichever
-- row happened to have the more recent effective_from won, model-specificity notwithstanding. Only the
-- ORDER BY changes: `(model is null)` is itself a plain boolean (never NULL, since IS NULL always
-- evaluates to true/false) — false (exact match) sorts before true (generic) in ascending order, so an
-- exact-model row is now ALWAYS preferred over a generic one, regardless of dates. effective_from desc
-- remains the only tie-breaker, but now strictly WITHIN each tier (exact-vs-exact, or generic-vs-generic)
-- — never across tiers. Each unit_type/component in p_quantities is still resolved independently in its
-- own loop iteration (unchanged): a single call can legitimately resolve one component (e.g. input) to
-- an exact-model row and another (e.g. output) to a generic fallback — that per-component independence
-- was already this function's design in migration 009, not a new abstraction. Brave is unaffected: it
-- has never had a generic-vs-exact collision (its only seeded row has model=null and no competing
-- model-specific row exists), so this ordering change cannot alter its resolved price. Fail-closed
-- multi-component behavior (`if not found then return null`, discarding any already-accumulated total)
-- is untouched.
create or replace function public.resolve_provider_cost(p_provider text,p_operation text,p_model text,p_quantities jsonb) returns jsonb
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
   order by (model is null),effective_from desc limit 1;
  if not found then return null; end if;
  total := total + round(found_price * (q->>'quantity')::numeric);
  versions := array_append(versions, found_version); any_priced := true;
 end loop;
 if not any_priced then return null; end if;
 return jsonb_build_object('estimated_cost_micros',total,'pricing_version',(select string_agg(distinct v,'+' order by v) from unnest(versions) v));
end $$;

-- Verified operator-confirmed tariff for claude-sonnet-5 (BLOC 4A.4.1, 2026-09-18): $2/1,000,000 input
-- tokens = 2000 micros/1,000 tokens; $10/1,000,000 output tokens = 10000 micros/1,000 tokens. operation
-- is 'offer_analysis' — the only Anthropic call site (analyzeOffer). Two separate rows, same
-- provider/operation/model, differing only by unit_type — no UNIQUE constraint exists on this table
-- (only a lookup index), so this is not a collision; resolve_provider_cost already resolves each
-- unit_type independently per call (see above) and sums them. `where not exists` guards, exactly like
-- the Brave seed in migration 009, so reapplying this migration never duplicates either row.
insert into prospectos_private.provider_pricing(provider,operation,model,unit_type,price_per_unit_micros,currency,version,effective_from)
select 'anthropic','offer_analysis','claude-sonnet-5','input_tokens_1k',2000,'USD','anthropic-sonnet-5-2026-09-18','2026-09-18 00:00:00+00'
where not exists (
 select 1 from prospectos_private.provider_pricing
 where provider='anthropic' and operation='offer_analysis' and model='claude-sonnet-5' and unit_type='input_tokens_1k' and version='anthropic-sonnet-5-2026-09-18'
);
insert into prospectos_private.provider_pricing(provider,operation,model,unit_type,price_per_unit_micros,currency,version,effective_from)
select 'anthropic','offer_analysis','claude-sonnet-5','output_tokens_1k',10000,'USD','anthropic-sonnet-5-2026-09-18','2026-09-18 00:00:00+00'
where not exists (
 select 1 from prospectos_private.provider_pricing
 where provider='anthropic' and operation='offer_analysis' and model='claude-sonnet-5' and unit_type='output_tokens_1k' and version='anthropic-sonnet-5-2026-09-18'
);

commit;
