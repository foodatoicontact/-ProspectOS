-- 051 — A company added from « Reprises de commerces » keeps its official announcement (audit 2026-11-11, B8). Until now a
-- result of the BODACC sales search (src/discovery/providers/bodacc-sales.ts) became a prospect with no website and an
-- empty record (« À documenter »): its announcement, stored with the result, was never shown on the record.
--
-- When such a result is accepted (« Ajouter »), its announcement is saved as ONE signal of the prospect, PENDING_REVIEW —
-- through public.save_signals, the same checks as every signal (membership of the person who adds it, closed types, an
-- official https source, the same event never saved twice). Nothing becomes verified: a person confirms it, as always.
-- Only the announcement's own fields are written (publication date, activity, establishment, town): no person's name
-- (the buyer is a legal person by construction of the provider; the seller is never read).
-- Nothing else is touched: no table, policy, entitlement, billing or evidence object changes; one trigger on
-- discovery_results (after update of status).
--
-- Rollback: drop trigger discovery_results_sale_signal on public.discovery_results;
--   drop function prospectos_private.signal_from_bodacc_sale();
begin;

create or replace function prospectos_private.signal_from_bodacc_sale() returns trigger language plpgsql security definer set search_path='' as $$
declare m jsonb:=new.normalized_payload->'raw_metadata';sale jsonb:=m->'bodacc_sale';day date;what text;excerpt text;
begin
 if new.status<>'accepted' or old.status='accepted' or new.prospect_id is null or sale is null or m->>'source_type'<>'legal_announcement'
    or new.source_url !~ '^https://www\.bodacc\.fr/[^[:space:]]+$' then return new; end if;
 begin day:=(sale->>'published')::date; exception when others then return new; end;
 if day is null then return new; end if;
 what:=concat_ws(', ',nullif(trim(sale->>'activity'),''),case when nullif(trim(sale->>'trade_name'),'') is not null then 'enseigne '||trim(sale->>'trade_name') end,
  nullif(trim(sale->>'city'),''));
 excerpt:=left('Reprise de fonds publiée au BODACC le '||to_char(day,'DD/MM/YYYY')||case when what<>'' then ' : '||what else '' end||'.',500);
 perform public.save_signals(new.prospect_id,null,jsonb_build_array(jsonb_build_object(
  'provider','bodacc','signal_type','acquisition','title',left(coalesce(nullif(new.source_title,''),'Reprise publiée au BODACC'),300),'excerpt',excerpt,
  'source_url',new.source_url,'source_type','legal_announcement','published_at',((day+time '12:00') at time zone 'Europe/Paris')::text,'observed_at',now()::text,
  'matched_terms',jsonb_build_array('reprise'),'content_hash',encode(sha256(convert_to(new.source_url||'|'||day::text,'UTF8')),'hex'),
  'event_key',left('bodacc_sale:'||coalesce(nullif(sale->>'notice_id',''),new.source_url),200),
  'raw_metadata',jsonb_build_object('origin','discovery_bodacc_sale','discovery_result_id',new.id,'category',sale->>'category'))));
 return new;
end $$;
revoke all on function prospectos_private.signal_from_bodacc_sale() from public,anon,authenticated;
drop trigger if exists discovery_results_sale_signal on public.discovery_results;
create trigger discovery_results_sale_signal after update of status on public.discovery_results for each row execute function prospectos_private.signal_from_bodacc_sale();

commit;
