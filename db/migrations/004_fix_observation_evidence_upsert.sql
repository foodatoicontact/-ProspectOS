-- Fixes a persistence bug proven in save_discovery_observations (unchanged since migration 002):
-- `insert ... on conflict(prospect_id,source_url,observation_type,content_hash) do update set
-- prospect_id=excluded.prospect_id` only ever refreshes prospect_id. Re-analyzing a page whose text
-- is unchanged (same content_hash) therefore always hits this conflict branch, and the returned row
-- keeps its OLD criterion/value/evidence_id forever — even once the extraction logic legitimately
-- starts producing a real criterion+value for that observation_type (e.g. PHONE_RAW -> contactability,
-- shipped by a later release). A brand-new evidence row was still being inserted beforehand (based on
-- the NEW payload) and, since the conflict-hit observation kept its OLD (null) evidence_id, that new
-- evidence became a permanent orphan: correct data, NOT_VERIFIED, but never linked to any
-- prospect_observations row and so never reachable from "Analyse des sources publiques".
--
-- This migration only replaces public.save_discovery_observations. No table, RLS policy, or grant
-- change: same signature, so the existing `grant execute ... to authenticated` from migration 002
-- carries over automatically across `create or replace function`.
--
-- Absolute invariant preserved: a review_status of VERIFIED or CONTRADICTED means a human already
-- acted on that observation. An automatic re-analysis must never touch that observation or its linked
-- evidence again — not its criterion/value, not its status, and (via the untouched evidence_guard
-- trigger) never its verified_by. Such a row is returned completely unchanged.
--
-- For a NOT_VERIFIED (or not-yet-human-reviewed) observation, the fix resolves evidence BEFORE writing
-- the observation, in this order:
--  1. Look up any existing observation for this exact (prospect_id, source_url, observation_type,
--     content_hash) dedup key, locked FOR UPDATE.
--  2. If it is already VERIFIED/CONTRADICTED, stop here and return it untouched — nothing else runs.
--  3. Otherwise, resolve the evidence side first:
--     - no criterion in the new payload: any evidence the slot used to have is deleted (it was never
--       human-reviewed, so nothing valuable is lost) and the slot goes evidence-less, exactly like a
--       fresh criterion-less observation would.
--     - a criterion, and an existing NOT_VERIFIED/INFERRED_UNCONFIRMED evidence row already linked:
--       that SAME row is updated in place (criterion/value/status/source_url/excerpt/observed_at) —
--       never a second evidence row for the same observation slot.
--     - a criterion, and no evidence row yet: a new one is inserted, exactly as before.
--  4. Only then is the observation row written (UPDATE if it existed, INSERT otherwise) with the
--     evidence_id resolved in step 3 — so evidence_id is never dangling and never orphaned.
begin;

create or replace function public.save_discovery_observations(p_prospect_id uuid,p_observations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 tenant uuid; project uuid; item jsonb; obs public.prospect_observations; existing public.prospect_observations;
 existing_found boolean; evid uuid; old_evid uuid; target_evidence_status text;
 result jsonb:='[]'; criteria text[]; st text; crit text; val boolean;
begin
 select organization_id,project_id into tenant,project from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant); perform pg_advisory_xact_lock(hashtextextended(p_prospect_id::text,0));
 if jsonb_typeof(p_observations)<>'array' or jsonb_array_length(p_observations)>40 then raise exception 'Invalid observations' using errcode='22023'; end if;
 select array_agg(x->>'key') into criteria from public.icps i cross join jsonb_array_elements(i.criteria) x where i.project_id=project;
 criteria := coalesce(criteria, array[]::text[]);
 for item in select value from jsonb_array_elements(p_observations) loop
  -- Validation is byte-for-byte identical to migrations 002/003: this fix only changes what happens
  -- to persistence once a payload is already known to be valid.
  if item <> (select jsonb_object_agg(key,value) from jsonb_each(item) where key=any(array['criterion','observation_type','claim','value','status','source_url','source_title','source_excerpt','source_type','confidence','collected_at','expires_at','content_hash'])) then raise exception 'Unknown observation field' using errcode='22023'; end if;
  st:=item->>'status'; crit:=item->>'criterion'; val:=case when item->'value'='null'::jsonb then null else (item->>'value')::boolean end;
  if st not in ('OBSERVED','UNKNOWN','INFERRED','CONTRADICTED') or length(trim(coalesce(item->>'observation_type',''))) not between 1 and 60 or length(coalesce(item->>'claim',''))>1000 or
     coalesce((item->>'confidence')::double precision,-1) not between 0 and 1 or item->>'source_type' not in ('official_website','search_result','public_directory','test_fixture') or
     coalesce(item->>'source_url','') !~ '^https?://[^[:space:]]+$' or length(coalesce(item->>'source_url',''))>2048 or length(coalesce(item->>'source_title',''))>300 or length(coalesce(item->>'source_excerpt',''))>500 or
     length(coalesce(item->>'content_hash','')) not between 1 and 100 then raise exception 'Invalid observation' using errcode='22023'; end if;
  if st='UNKNOWN' then if val is not null then raise exception 'UNKNOWN requires null value' using errcode='22023'; end if;
  else
   if length(trim(coalesce(item->>'source_excerpt','')))=0 then raise exception 'Evidence fields required' using errcode='22023'; end if;
   if crit is null then
    if val is not null then raise exception 'Context observation requires null value' using errcode='22023'; end if;
   else
    if not (crit=any(criteria)) or val is null then raise exception 'Evidence fields required' using errcode='22023'; end if;
   end if;
  end if;

  select * into existing from public.prospect_observations
   where prospect_id=p_prospect_id and source_url=item->>'source_url' and observation_type=item->>'observation_type' and content_hash=item->>'content_hash'
   for update;
  existing_found := found;

  if existing_found and existing.review_status in ('VERIFIED','CONTRADICTED') then
   -- A human already reviewed this exact observation. Freeze it completely: no field on the
   -- observation or its evidence changes, and evidence_guard's verified_by is never re-touched.
   obs := existing;
  elsif existing_found then
   old_evid := existing.evidence_id; evid := old_evid;
   -- Same structural guard as the validation above: UNKNOWN (or criterion-less) observations never
   -- carry evidence at all, exactly as an original insert never gave them one.
   if st='UNKNOWN' or crit is null then
    evid := null;
   else
    target_evidence_status := case when st='INFERRED' then 'INFERRED_UNCONFIRMED' else 'NOT_VERIFIED' end;
    if old_evid is not null then
     update public.evidence set criterion=crit,value=val,status=target_evidence_status,source_url=item->>'source_url',excerpt=item->>'source_excerpt',observed_at=(item->>'collected_at')::timestamptz
      where id=old_evid;
     evid := old_evid;
    else
     insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt,observed_at)
     values(tenant,p_prospect_id,crit,val,target_evidence_status,item->>'source_url',item->>'source_excerpt',(item->>'collected_at')::timestamptz) returning id into evid;
    end if;
   end if;
   update public.prospect_observations set
    criterion=crit,claim=item->>'claim',value=val,status=st,source_title=item->>'source_title',
    source_excerpt=item->>'source_excerpt',source_type=item->>'source_type',confidence=(item->>'confidence')::double precision,
    collected_at=(item->>'collected_at')::timestamptz,expires_at=(item->>'expires_at')::timestamptz,evidence_id=evid
   where id=existing.id returning * into obs;
   -- Only delete the old evidence AFTER the observation no longer references it, so the composite FK
   -- (evidence_id,prospect_id,organization_id) -> evidence never dangles even for an instant.
   if evid is null and old_evid is not null then delete from public.evidence where id=old_evid; end if;
  else
   evid := null;
   if st<>'UNKNOWN' and crit is not null then
    insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt,observed_at)
    values(tenant,p_prospect_id,crit,val,case when st='INFERRED' then 'INFERRED_UNCONFIRMED' else 'NOT_VERIFIED' end,item->>'source_url',item->>'source_excerpt',(item->>'collected_at')::timestamptz) returning id into evid;
   end if;
   insert into public.prospect_observations(organization_id,prospect_id,criterion,observation_type,claim,value,status,source_url,source_title,source_excerpt,source_type,confidence,collected_at,expires_at,content_hash,evidence_id)
   values(tenant,p_prospect_id,crit,item->>'observation_type',item->>'claim',val,st,item->>'source_url',item->>'source_title',item->>'source_excerpt',item->>'source_type',(item->>'confidence')::double precision,(item->>'collected_at')::timestamptz,(item->>'expires_at')::timestamptz,item->>'content_hash',evid)
   returning * into obs;
  end if;

  result:=result||jsonb_build_array(to_jsonb(obs)); evid:=null; old_evid:=null; existing_found:=false;
 end loop;
 return result;
end $$;

commit;
