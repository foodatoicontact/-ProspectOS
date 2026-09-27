-- Read-only snapshot of the PRODUCTION body of public.delete_own_account(), read 2026-09-27
-- (pg_get_functiondef; SECURITY DEFINER, SET search_path TO '', plpgsql, RETURNS jsonb).
declare actor uuid := auth.uid(); blocked jsonb := '[]'::jsonb; m record; other_owners int; other_members int; biz_count int;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 for m in select organization_id, role from public.memberships where user_id=actor loop
  if m.role='owner' then
   select count(*) into other_owners from public.memberships where organization_id=m.organization_id and role='owner' and user_id<>actor;
   if other_owners=0 then
    select count(*) into other_members from public.memberships where organization_id=m.organization_id and user_id<>actor;
    select count(*) into biz_count from public.projects where organization_id=m.organization_id;
    if other_members>0 or biz_count>0 then blocked := blocked || jsonb_build_array(m.organization_id); end if;
   end if;
  end if;
 end loop;
 if jsonb_array_length(blocked)>0 then
  raise exception 'last_owner_blocked' using errcode='P0001', detail=blocked::text;
 end if;
 delete from public.memberships where user_id=actor;
 return jsonb_build_object('memberships_removed', true);
end
