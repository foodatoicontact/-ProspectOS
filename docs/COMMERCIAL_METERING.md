# Commercial metering / plans / entitlements (PR2)

## 1. Technical quota vs commercial quota

Two completely separate systems coexist on purpose, in separate tables, in separate schemas:

| | Technical quota (PR1, migrations 002/005) | Commercial entitlement (PR2, migration 006) |
|---|---|---|
| Purpose | Rate limiter against runaway cost/abuse | Business limit tied to a paid plan |
| Scope | Per hour, sliding window | Per calendar-month billing period |
| Storage | `prospectos_private.discovery_quota_settings` / `discovery_quota_usage` | `public.commercial_plans` / `organization_subscriptions`, `prospectos_private.commercial_usage` |
| Values | `discovery=10/h`, `analysis=20/h`, `ai_offer=10/h` — same for every organization | `discoveries/prospects/ai_operations per month` — varies by plan |
| Changed by this PR? | No — untouched, same defaults, same function bodies for `discovery`/`analysis` | New |

Neither replaces the other. A commercially-metered operation must pass **both**.

## 2. Plan model

`public.commercial_plans`: `code` (`free`/`solo`/`pro`/`business`, primary key), `name`, `active`,
`discoveries_per_period`, `prospects_per_period`, `ai_operations_per_period`, `seats`, and a free-form
`entitlements jsonb` column reserved for **future** limits that don't need enforcement yet (so a new one
ships as a data row, not a migration). The three enforced metrics stay first-class integer columns
because they sit on the hot path of `consume_commercial_entitlement`.

No prices in this table — out of scope for PR2.

## 3. Plan resolution

`prospectos_private.resolve_active_subscription(tenant)`:
- Looks up `organization_subscriptions` for the tenant, `FOR UPDATE`.
- If none exists, **lazily creates a FREE subscription** (`INSERT ... ON CONFLICT(organization_id) DO
  NOTHING`, race-safe for two concurrent first calls).
- **Why lazy, not "create at organization creation time"**: it also self-heals any organization that
  predates this migration, with no backfill script and no window where an org resolves to "no plan".

An organization can have **at most one** subscription row — enforced by
`UNIQUE(organization_id)`, not just application logic.

## 4. Periods

Monthly, calendar-aligned. `current_period_start`/`current_period_end` are real columns, rolled forward
by whole `+ interval '1 month'` steps (handles variable month length/DST correctly) until the window
covers "now" — so an organization untouched for several months lands on the right period in one
resolution, never several. The very first boundary is anchored to **UTC**, explicitly
(`date_trunc('month', now() at time zone 'utc') at time zone 'utc'`), because `date_trunc` on a
`timestamptz` otherwise truncates in the session's timezone, which is not guaranteed constant across
connections/poolers.

**FREE behavior**: identical mechanism, no special-casing — a FREE subscription rolls over exactly like
a paid one, just with FREE's limits.

**Plan change (e.g. FREE→SOLO)**: takes effect immediately for the **limits** used from that moment on,
but does **not** reset the current period or its usage — usage rows are never deleted or rewritten. An
upgrade mid-period raises the ceiling for the remainder of that period; it does not grant a bonus fresh
period. This is a deliberate simplicity choice for V1, not an oversight.

## 5. Consumption

`prospectos_private.consume_commercial_entitlement(tenant, metric, amount)` — the single place that ever
writes `commercial_usage`:
1. Rejects `amount<=0` and unknown `metric` before touching anything.
2. `require_member(tenant)`.
3. Resolves/rolls the subscription.
4. `pg_advisory_xact_lock` keyed `(tenant, metric)` **before** reading current usage — the same proven
   pattern as the technical quota's lock, applied to a second, independent counter family. This is what
   makes "SELECT usage; INSERT usage" safe under concurrency: no other transaction for the same
   `(tenant, metric)` can even start its read until this one commits or rolls back.
5. Computes `remaining = limit - used_this_period`, grants `min(amount, remaining)`, inserts a usage row
   for exactly the granted amount (never the raw requested amount).
6. Returns the granted amount (`0..amount`) — **never raises for a partial grant**; callers decide what
   partial means for their metric.

## 6. Double guard (Discovery, AI operation)

`start_discovery_metered` and `consume_ai_operation` each do the commercial check **and** the existing
technical check inside **one** PL/pgSQL function body, in the same transaction, with no exception
handler/savepoint between them. Consequence: if the technical check raises after the commercial unit was
already inserted, the **whole transaction aborts** and Postgres rolls back both — the commercial insert
never commits. Symmetrically, if the commercial check refuses, the technical function is never even
called. There is no window where one guard's consumption is durably committed while the other's failed —
proven empirically in `tests/commercial-entitlements-db.mjs` (C16-C18). No manual refund/compensation
logic exists or is needed.

Order: commercial is checked first. This is a deliberate but **not load-bearing** choice — it only
decides which error a caller sees when both would refuse (a monthly-entitlement message takes priority
over an hourly-rate one); it doesn't affect correctness.

`start_discovery` and `consume_ai_offer_quota` (the pre-existing technical RPCs) remain fully defined,
unchanged, and are still called internally by the new orchestrators — this works because a `SECURITY
DEFINER` function's internal calls run under its **owner's** privileges, not the original caller's.
Their direct `EXECUTE` grant to `authenticated` is revoked so a client can no longer call the technical
RPC straight from PostgREST and skip the commercial guard entirely.

## 7. Mapping of operations to commercial metrics

Audited before assuming anything:

| Endpoint | Real cost | Metric | Notes |
|---|---|---|---|
| `POST /api/v1/projects/:id/discovery` (`start_discovery_metered`) | Discovery run | **DISCOVERY** | 1 per call |
| Discovery run's own persisted candidates (`find_prospects`) | DB rows created | **PROSPECT** | see §8 |
| `POST /api/v1/analyze-company` (`analyzeOffer`, real Anthropic/OpenAI call) | LLM tokens | **AI_OPERATION** | the *only* endpoint in this codebase making a real LLM call |
| `POST /api/v1/prospects/:id/analyze` (`CompanyAnalysisService.analyze_company`, `consume_analysis_quota`) | HTML fetch + deterministic regex/rule extraction (cheerio) | **not metered** | **no LLM call at all** — deliberately excluded from AI_OPERATION; still technically rate-limited (unchanged) |
| `outreach` message generation (`generateOutreach`) | none | **not metered** | fully deterministic template, no external call |

The trap this section exists to avoid: a function literally named "analyze" (`CompanyAnalysisService.
analyze_company`) does **not** call an LLM — assuming it did would have wrongly doubled the AI_OPERATION
surface.

## 8. Prospect limit behavior

A Discovery run can return more candidates than a plan allows. Strategy: **cap, never reject the whole
batch, never create a temporary overshoot.** `DiscoveryService.find_prospects` computes the real
candidate list first (post-dedup), then calls `consume_prospect_entitlement(project_id,
candidates.length)`, which returns how many are actually grantable this period; only that many are ever
persisted (`candidates.slice(0, granted)`). If 0 candidates were found, no RPC call happens at all. The
response carries `prospects_capped` (0 when nothing was capped) so the cap is observable, without any UI
change in this PR.

## 9. Provider/technical failure behavior

Unchanged from PR1's guard philosophy, now extended: a paid provider call only ever happens **after** a
successful atomic consumption (commercial + technical where applicable). A provider failure **after**
that consumption does **not** refund it — the unit stays spent. Simpler and safer than refunding (no
second DB round trip with its own race window, and no cheaper retry-driven drain for an attacker).

## 10. Future Stripe compatibility

`organization_subscriptions` carries nullable `external_provider` / `external_customer_id` /
`external_subscription_id` — placeholders only, no Stripe code, no webhook, no secret anywhere in this
PR. The intended future integration: `Stripe Checkout → signed webhook → UPDATE
organization_subscriptions (plan_code/status/period/external_*) → ProspectOS resolves the new
entitlements automatically` on the next call, with **zero runtime dependency on Stripe** — Stripe only
ever writes state here, it is never consulted at authorization time.

## 11. Known limitations (V1, by design)

- **No idempotency key** on `start_discovery_metered` or `consume_ai_operation`: a client retry after a
  network timeout on an already-successful call is indistinguishable from a new request and **is**
  counted again. Pre-existing behavior for the technical quotas too (not a regression). Documented and
  tested (`tests/commercial-entitlements-db.mjs`, C20) rather than silently assumed away.
- **Seats are reported, not enforced**: the usage API returns seats used/limit/remaining, but nothing in
  this PR blocks adding a member beyond the seat limit — the codebase currently has no self-service
  membership-invitation flow at all (`db/schema.sql`'s own comment: "Membership mutations/invitations
  intentionally absent in V0"), so enforcement would be premature.
- **True concurrent-connection races are not empirically reproduced** in the PGlite test suite (single
  connection). The atomicity itself comes from `pg_advisory_xact_lock`, the same mechanism already relied
  on (and accepted) for the technical quotas; only the *boundary* correctness (last-credit case) is
  proven directly.
- **No frontend** in this PR — `GET /api/v1/billing/usage` is the complete deliverable; a plan/usage
  widget is deferred to a later PR to keep this one's scope proportionate, per the task's own explicit
  allowance.
- **No pricing, no Stripe, no billing UI, no monthly-plan purchase flow** — this PR is the authorization
  engine only.
