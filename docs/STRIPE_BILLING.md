# Stripe Billing — ProspectOS

Status: implemented in TEST mode on `feature/stripe-billing`. Not merged, not deployed to Production,
migration 017 not applied to Production.

## Offers

| Commercial plan | DB `account_entitlements.plan` | Price | Quotas per period (Discovery / prospect analyses / AI offer analyses) | How it starts |
|---|---|---|---|---|
| TRIAL | `BETA` (historical name) | free, 7 days, no card | 20 / 50 / 5 | `activate_trial()` (ProspectOS, never Stripe) |
| BETA — ProspectOS Bêta | `PAID` | 49 € HT / month | 100 / 250 / 25 | Stripe Checkout → webhook |
| PRO — ProspectOS Pro B2B | `PRO` | 99 € HT / month | 300 / 750 / 75 | Stripe Checkout → webhook |
| ENTERPRISE / White Label | `ENTERPRISE` | quote only | per customer (`enterprise_limits`) | operator SQL `grant_enterprise_access` |
| INTERNAL | `INTERNAL` | — | unlimited | operator SQL (unchanged) |

Existing rows keep their values: no production row is rewritten. `src/domain/plans.ts` holds the mapping.

## Flow

1. Signed-in user → `POST /api/v1/billing/checkout {"plan":"BETA"|"PRO"}` (any other key → 400;
   `ENTERPRISE` → 400 `ENTERPRISE_QUOTE_ONLY`).
2. The server picks the price id from its env, re-reads the price from Stripe and refuses unless it is
   exactly 4900 / 9900 cents, EUR, monthly, active, same mode (TEST/LIVE) as the key.
3. One Stripe customer per user (`Idempotency-Key: prospectos-customer-<user>` + `link_stripe_customer`).
4. Hosted Stripe Checkout (subscription mode, billing address required, VAT number collection on).
5. `success_url` only shows a notice. Access is granted by the webhook, never by the redirect.
6. `POST /api/v1/billing/stripe/webhook` (unauthenticated route, Stripe signature required):
   the event only names a subscription; the server re-reads it from Stripe (`expand=latest_invoice`) and
   calls `apply_stripe_subscription_state` (service_role only), which records the event id in the same
   transaction (replay and concurrent delivery = no effect).
7. `POST /api/v1/billing/portal` → Stripe Customer Portal for the caller's own linked customer.

Access policy (in SQL, `017_stripe_billing.sql`):

- `active` + latest invoice `paid` → plan of the price, `starts_at/expires_at` = Stripe period (quota
  window follows the subscription anniversary). Never moved backwards; a replay changes nothing.
- `past_due` / `incomplete` → nothing extended; access runs to the end of the period already paid; the
  account page shows a payment warning.
- `cancel_at_period_end` → access until `current_period_end`.
- `canceled` / `unpaid` / `incomplete_expired` → entitlement `EXPIRED`: paid actions refused, all business
  data kept and readable.
- unknown price, unknown customer, old subscription → recorded, no access change, logged server-side.
- INTERNAL and ENTERPRISE entitlements are never changed by Stripe.
- Account deletion is refused while a subscription would keep billing (cancel first).

Grandfathering: the BETA price keeps mapping to BETA for as long as a subscription uses it.
`BILLING_BETA_CHECKOUT_OPEN=false` hides/refuses the 49 € offer for new customers only. Never delete or
archive the BETA price while subscriptions use it; never migrate BETA → PRO automatically.

## Environment variables (server-only)

| Variable | Preview (TEST) | Production (future LIVE) |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` | `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` of the TEST endpoint | `whsec_…` of the LIVE endpoint |
| `STRIPE_PRICE_BETA` / `STRIPE_PRICE_PRO` | TEST price ids | LIVE price ids |
| `BILLING_ENABLED` | `true` | `true` when opening sales |
| `BILLING_ALLOW_LIVE` | unset | `true` |
| `STRIPE_AUTOMATIC_TAX` | unset | `true` once Stripe Tax is configured |
| `BILLING_BETA_CHECKOUT_OPEN` | unset | `false` when the 49 € offer closes |
| `STRIPE_PORTAL_CONFIGURATION`, `APP_BASE_URL` | optional | optional |

Hard locks in `src/server/billing/config.ts`: a TEST key is refused when `VERCEL_ENV=production`; a LIVE key
is refused outside Production and without `BILLING_ALLOW_LIVE=true`. No `NEXT_PUBLIC_` Stripe variable is
needed (hosted Checkout).

## Manual steps in Stripe TEST (sandbox "ProspectOS Test")

The cloud session that built this could not reach `api.stripe.com` (network policy), so these were not
run. Dashboard in TEST mode, or with the Stripe CLI logged into the sandbox:

1. Products / prices (EUR, monthly, recurring):
   ```
   stripe products create --name "ProspectOS Bêta"
   stripe prices create --product <prod_beta> --currency eur --unit-amount 4900 -d "recurring[interval]=month" --tax-behavior exclusive
   stripe products create --name "ProspectOS Pro B2B"
   stripe prices create --product <prod_pro> --currency eur --unit-amount 9900 -d "recurring[interval]=month" --tax-behavior exclusive
   ```
   No product for Enterprise.
2. Webhook endpoint: `https://<preview-url>/api/v1/billing/stripe/webhook`, events
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Copy its signing secret into
   the Vercel **Preview** env `STRIPE_WEBHOOK_SECRET` (never Production). Vercel Deployment Protection must
   let Stripe reach the Preview URL (protection bypass for automation, or a dedicated preview domain).
3. Vercel **Preview** env: `STRIPE_SECRET_KEY` (test), `STRIPE_PRICE_BETA`, `STRIPE_PRICE_PRO`,
   `BILLING_ENABLED=true`. Nothing in Production.
4. Customer Portal (Settings → Billing → Customer portal, TEST): invoices on, update payment method on,
   cancel on (at period end), plan switching BETA ↔ PRO optional. Business information: company name,
   terms/privacy links.
5. Apply `017_stripe_billing.sql` to a **non-production** Supabase project (or branch) used by Preview.
6. Sandbox run: `4242 4242 4242 4242` (success), `4000 0000 0000 0341` (attaches then fails on renewal),
   `4000 0000 0000 9995` (declined); `stripe trigger` / "Resend" on the endpoint for replay; Test clocks to
   advance to renewal / period end; Portal cancellation.

## Tax / B2B

- Checkout collects: name / company (via `customer_update[name]`), email, billing address (required),
  VAT number (`tax_id_collection`).
- `automatic_tax` is off unless `STRIPE_AUTOMATIC_TAX=true`. No fiscal computation in ProspectOS.
- Stripe Tax configuration of the account could not be read from this session.

## Blockers before LIVE

- Stripe Tax: origin address, French VAT registration, EU OSS decision, `tax_behavior=exclusive` on LIVE
  prices, then `STRIPE_AUTOMATIC_TAX=true` — or an explicit accountant-validated decision without it.
- Invoice settings: legal mentions (SIREN/SIRET, VAT number, address), invoice numbering prefix.
- CGV: prices HT, renewal, cancellation, BETA grandfathering, data kept after cancellation.
- LIVE products/prices, LIVE webhook endpoint + secret, LIVE portal configuration.
- Migration 017 applied to Production **before** the code that calls it is deployed.
- The full sandbox run above (not executed from this session).
