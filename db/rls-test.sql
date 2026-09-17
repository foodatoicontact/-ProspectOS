-- Run AFTER schema.sql in a disposable Supabase project, as postgres.
-- Assertions execute as authenticated/anon, never as postgres. Everything rolls back.
-- With psql: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/rls-test.sql
begin;
insert into auth.users(id,email) values
 ('aaaaaaaa-0000-4000-8000-000000000001','prospectos-rls-a@example.invalid'),
 ('bbbbbbbb-0000-4000-8000-000000000002','prospectos-rls-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-000000000001',true);
select set_config('test.org_a',public.create_organization('RLS A')::text,true);
insert into public.projects(id,organization_id,name,offer) values
 ('aaaaaaaa-1111-4000-8000-000000000001',current_setting('test.org_a')::uuid,'A','Foodatoi');
insert into public.prospects(id,organization_id,project_id,name) values
 ('aaaaaaaa-2222-4000-8000-000000000001',current_setting('test.org_a')::uuid,'aaaaaaaa-1111-4000-8000-000000000001','Prospect A');
insert into public.evidence(id,organization_id,prospect_id,criterion,value,status,source_url,excerpt)
 values('aaaaaaaa-3333-4000-8000-000000000001',current_setting('test.org_a')::uuid,'aaaaaaaa-2222-4000-8000-000000000001','phone_orders',true,'VERIFIED','https://example.org/menu','Commandez par téléphone');
do $$ begin
 if (select verified_by from public.evidence where id='aaaaaaaa-3333-4000-8000-000000000001') <> auth.uid() then raise exception 'FAIL verifier attribution'; end if;
 if (select count(*) from public.events where organization_id=current_setting('test.org_a')::uuid) <> 2 then raise exception 'FAIL audit append'; end if;
end $$;

select set_config('request.jwt.claim.sub','bbbbbbbb-0000-4000-8000-000000000002',true);
select set_config('test.org_b',public.create_organization('RLS B')::text,true);
insert into public.projects(id,organization_id,name) values
 ('bbbbbbbb-1111-4000-8000-000000000002',current_setting('test.org_b')::uuid,'B');
insert into public.prospects(id,organization_id,project_id,name) values
 ('bbbbbbbb-2222-4000-8000-000000000002',current_setting('test.org_b')::uuid,'bbbbbbbb-1111-4000-8000-000000000002','Prospect B');

do $$ declare affected int; blocked boolean; begin
 if exists(select 1 from public.projects where organization_id=current_setting('test.org_a')::uuid) then raise exception 'FAIL cross-tenant read'; end if;
 if exists(select 1 from public.events where organization_id=current_setting('test.org_a')::uuid) then raise exception 'FAIL audit read isolation'; end if;
 if exists(select 1 from public.memberships where user_id <> auth.uid()) then raise exception 'FAIL membership read'; end if;
 update public.prospects set name='Compromised' where id='aaaaaaaa-2222-4000-8000-000000000001';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'FAIL cross-tenant update'; end if;
 delete from public.evidence where id='aaaaaaaa-3333-4000-8000-000000000001';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'FAIL cross-tenant delete'; end if;
 blocked := false;
 begin
  insert into public.projects(organization_id,name) values(current_setting('test.org_a')::uuid,'Intrusion');
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL cross-tenant insert'; end if;
 blocked := false;
 begin
  insert into public.prospects(organization_id,project_id,name) values(current_setting('test.org_b')::uuid,'aaaaaaaa-1111-4000-8000-000000000001','Cross link');
 exception when foreign_key_violation then blocked:=true; end;
 if not blocked then raise exception 'FAIL composite project FK'; end if;
 blocked := false;
 begin
  insert into public.evidence(organization_id,prospect_id,criterion) values(current_setting('test.org_b')::uuid,'aaaaaaaa-2222-4000-8000-000000000001','sector');
 exception when foreign_key_violation then blocked:=true; end;
 if not blocked then raise exception 'FAIL composite evidence FK'; end if;
 blocked := false;
 begin
  insert into public.memberships(organization_id,user_id,role) values(current_setting('test.org_a')::uuid,auth.uid(),'owner');
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL membership escalation'; end if;
 blocked := false;
 begin
  insert into public.events(organization_id,kind) values(current_setting('test.org_b')::uuid,'fake');
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL audit forgery'; end if;
 blocked := false;
 begin
  delete from public.events where organization_id=current_setting('test.org_b')::uuid;
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL audit deletion'; end if;
 blocked := false;
 begin
  update public.prospects set organization_id=current_setting('test.org_a')::uuid where id='bbbbbbbb-2222-4000-8000-000000000002';
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL tenant reassignment'; end if;
 blocked := false;
 begin
  insert into public.outreach(organization_id,prospect_id,content,evidence_ids) values(current_setting('test.org_b')::uuid,'bbbbbbbb-2222-4000-8000-000000000002','Untrusted','["aaaaaaaa-3333-4000-8000-000000000001"]');
 exception when foreign_key_violation then blocked:=true; end;
 if not blocked then raise exception 'FAIL cross-tenant outreach evidence'; end if;
 update public.prospects set status='Contacté' where id='bbbbbbbb-2222-4000-8000-000000000002';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'FAIL own update'; end if;
 blocked := false;
 begin
  insert into public.evidence(organization_id,prospect_id,criterion,value,status) values(current_setting('test.org_b')::uuid,'bbbbbbbb-2222-4000-8000-000000000002','phone_orders',true,'VERIFIED');
 exception when check_violation then blocked:=true; end;
 if not blocked then raise exception 'FAIL proofless verification'; end if;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ declare blocked boolean:=false; begin
 begin perform * from public.prospects; exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL anon data access'; end if;
 blocked:=false;
 begin perform public.create_organization('anon'); exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL anon bootstrap'; end if;
end $$;
reset role;
rollback;
-- Success = no exception, ROLLBACK. No users, organizations or test data persisted.
