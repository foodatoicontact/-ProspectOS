-- One-off cleanup: release the Stripe TEST billing link left on one Production account by the TEST payment of
-- 2026-10-03, now that Production runs Stripe LIVE (release gate B2/B3). The TEST customer does not exist in LIVE, so
-- the Customer Portal and Checkout fail for that account (BILLING_PROVIDER_ERROR), and its TEST subscription can never
-- be synchronized again (TEST events are refused by a LIVE deployment).
--
-- Scope: exactly one account and exactly these Stripe TEST identifiers, nothing else.
--   user         e1c92fcc-e6ee-4129-ad82-dbe02c509239
--   customer     cus_VNDxtnO2ieMnfv
--   subscription sub_1UMTb0K2DvPVYtXoDXb65GMW
--   price        price_1UKOiSK2DvPVYtXoQTSy3db6
--
-- Behaviour:
--   - none of these rows exists (any other database, or this one once cleaned) → no-op;
--   - the complete expected state is there → delete that one billing_accounts row and move that one PAID/ACTIVE
--     entitlement to EXPIRED (017's rule for a subscription that ended: paid actions stop, every business row is kept;
--     no trial or other right is granted back);
--   - anything else (a partial or different state) → raise: the whole migration rolls back.
-- No function, trigger, policy or audit object is created or changed; public.events and stripe_webhook_events are not
-- touched; no Stripe event is written. Stripe itself is not changed (the TEST sandbox keeps its own records).
--
-- Rollback: none needed for a no-op. After a cleanup, the previous row is described above (TEST identifiers, plan PAID,
-- status active, period 2026-10-03 → 2026-11-03, cancel_at_period_end) and remains readable in the Stripe TEST sandbox.
do $$
declare
 v_user constant uuid := 'e1c92fcc-e6ee-4129-ad82-dbe02c509239';
 v_customer constant text := 'cus_VNDxtnO2ieMnfv';
 v_subscription constant text := 'sub_1UMTb0K2DvPVYtXoDXb65GMW';
 v_price constant text := 'price_1UKOiSK2DvPVYtXoQTSy3db6';
 v_rows int; v_exact int; v_ent public.account_entitlements; v_has_ent boolean; n int;
begin
 -- Same lock as apply_stripe_subscription_state: no webhook for this customer can interleave.
 perform pg_advisory_xact_lock(hashtextextended('billing-customer:'||v_customer,0));
 select count(*) into v_rows from prospectos_private.billing_accounts
  where user_id=v_user or stripe_customer_id=v_customer or stripe_subscription_id=v_subscription;
 select * into v_ent from public.account_entitlements where user_id=v_user for update;
 v_has_ent := found;
 if v_rows=0 then
  if v_has_ent and v_ent.plan='PAID' and v_ent.status='ACTIVE' then
   raise exception 'release_legacy_test_billing: PAID/ACTIVE entitlement without its billing row' using errcode='P0001';
  end if;
  return; -- nothing of this account or these identifiers: no-op
 end if;
 select count(*) into v_exact from prospectos_private.billing_accounts
  where user_id=v_user and stripe_customer_id=v_customer and stripe_subscription_id=v_subscription
   and stripe_price_id=v_price and plan='PAID' and subscription_status='active' and seats is null;
 if v_rows<>1 or v_exact<>1 or not v_has_ent or v_ent.plan<>'PAID' or v_ent.status<>'ACTIVE' then
  raise exception 'release_legacy_test_billing: state differs from the expected legacy TEST link' using errcode='P0001';
 end if;
 delete from prospectos_private.billing_accounts
  where user_id=v_user and stripe_customer_id=v_customer and stripe_subscription_id=v_subscription and stripe_price_id=v_price;
 get diagnostics n = row_count;
 if n<>1 then raise exception 'release_legacy_test_billing: % billing rows deleted, expected 1',n using errcode='P0001'; end if;
 update public.account_entitlements set status='EXPIRED',updated_at=now()
  where user_id=v_user and plan='PAID' and status='ACTIVE';
 get diagnostics n = row_count;
 if n<>1 then raise exception 'release_legacy_test_billing: % entitlements expired, expected 1',n using errcode='P0001'; end if;
end $$;
