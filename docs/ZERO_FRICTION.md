# Zero-Friction — ZF1 « Aujourd'hui » (Today-first)

Flag: `ZERO_FRICTION_TODAY_ENABLED` (server, OFF by default). With it OFF nothing changes.

## What ZF1 does

- **Destination.** For a live account with a project that has prospects, the app opens on **Aujourd'hui** once per
  session (`app/page.tsx`). Every other view (Prospects, Vue d'ensemble, Offre & ICP, Discovery, the detailed NBA view)
  stays in the navigation.
- **No manual recalculation.** `POST /projects/:id/next-best-actions/ensure-fresh {reason}` runs the same computation
  as « Recalculer » only when needed:
  - `open` → only if nothing was ever computed or the newest computation is older than 6 h (freshness decays by day);
  - `data_changed` → once, after the user changed something NBA reads (prospects, evidence, observations, signals
    review, public content, ICP, offer, accepted Discovery result — `changesNbaInputs`).
  Never on a timer, never on render; a recomputation never marks itself dirty (no loop); identical recommendations are
  not rewritten (`save_nba_actions` fingerprint), and a recommendation a person closed (REJECTED / DONE) is not
  re-proposed unchanged (`dropClosedUnchanged`). Without an active entitlement the last recommendations are shown.
  The manual button stays in the detailed view.
- **Cards** (`src/nba/today.ts`, pure, from the stored NBA row — engine, scoring, thresholds unchanged):
  - sections: À contacter (CONTACT) · À vérifier (WATCH with something a person can check) · Conversations à rejoindre
    (ENGAGE) · À surveiller (WATCH with nothing to check). WAIT and DISMISS are counted, never shown as cards;
  - level 1 (readable in ~3 s): who · status · why now (signal type, place worded naturally — « à Toulouse », « dans
    l’Hérault », « en Occitanie », `src/ux/place-phrase.ts`, presentation only) · why this company (one sentence) · what is
    missing (one short, non-causal sentence) · one primary action;
  - level 2 « Voir pourquoi »: favourable elements, the complete missing information, timing, place, the proof with its
    source;
  - level 3 « Détails avancés »: opportunity, FIT and its basis, ICP coverage, INTENT, TIMING, freshness, evidence
    quality, rule, every explanation statement with its source.
- **Primary action**: CONTACT → prepare the message (prospect detail, existing workflow) · ENGAGE → the conversation ·
  WATCH driven by an unreviewed signal → « Vérifier le signal » in the card (source shown; « Le fait est exact » / « faux ou
  hors sujet »; then one recomputation) · WATCH with missing ICP information → « Compléter les informations » (prospect detail, where evidence is added) · WATCH
  otherwise → « Surveillé — aucune action nécessaire ».
- **Summary** (`todaySummary`, real singular/plural): « Aucune entreprise à contacter aujourd'hui. » · « 3 entreprises sont
  à vérifier. » · « Nous surveillons 1 entreprise. » — each company counted once: « surveillé » is only WATCH with nothing
  to check and WAIT, never the cards « à vérifier ». « Aucun signal suffisamment récent aujourd'hui. » when nothing is
  shown — 0 CONTACT is a valid day; no threshold moves.

### What ZF1 does not claim (ZF5)

The engine does not expose which single missing fact would change the action: ZF1 never says « 1 information manque
pour décider ». It writes « Informations supplémentaires nécessaires : » followed by the engine's own missing ICP
criteria (FitProfile.missing) or the unreviewed signal. A causal « unlock » (counterfactual: which verification turns
WATCH into CONTACT) is a ZF5 item.

## Measurement

`POST /zf-events` → `public.events` (`ux.zf_*`, `actor_id` null, closed numeric payload: session id, elapsed ms,
interactions, user id). Written when `ZERO_FRICTION_TODAY_ENABLED` is on and the runtime is not explicitly Production
(`zfWritesAllowed`); each request logs `{component:'zf-events',kind,outcome}` (no personal data).

**ZF1.1 root cause (interactive canary, 17/10).** No `ux.zf_*` was written: the route gated writes with the UX A/B rule
`uxAbEnabledFromEnv`, which needs `VERCEL_ENV=preview`, and this project's Preview functions do not see `VERCEL_ENV`
(`/api/public/ux-config` → `environment:"unknown"`). Every event was skipped while the route answered 202, silently.
Fixed by gating on the ZF flag (set only on this Preview) + never explicit Production, and by logging the outcome.
Also fixed on the same path: the long-lived client session kept the `api` of its first render, i.e. a stale access
token after a refresh (a later event would have answered 401 → logout); it now reads the latest `api`. Kinds: ZF_SESSION_STARTED,
ZF_TODAY_VIEWED, ZF_FIRST_RECOMMENDATION_VISIBLE, ZF_FIRST_MEANINGFUL_ACTION, ZF_ADVANCED_DETAILS_OPENED, each once per
page-load session. `elapsed_ms` runs from the app's opening; `interactions` counts trusted clicks on interactive
elements and form submits only (`ZfSession.observe`: renders, loads, polling and automatic recomputations never count).

- TIME_TO_FIRST_RECOMMENDATION = `elapsed_ms` of ZF_FIRST_RECOMMENDATION_VISIBLE
- INTERACTIONS_TO_FIRST_RECOMMENDATION = its `interactions`
- TIME / INTERACTIONS_TO_FIRST_MEANINGFUL_ACTION = the same fields of ZF_FIRST_MEANINGFUL_ACTION

```sql
select payload->>'session_id' s, kind, (payload->>'elapsed_ms')::int ms, (payload->>'interactions')::int n
from public.events where kind like 'ux.zf_%' order by created_at;
```

## Finding accepted for ZF1: the freshness cliff

A WATCH whose only reason is a fresh signal leaves Today the day that signal's freshness drops below the WATCH threshold
(0.5), with no data change: on the canary, Groupe Bertrand (expansion, half-life 45 days) was WATCH at 45 days and
DISMISS at 46. Engine, half-lives and thresholds are unchanged; history / transition notice / hysteresis to be evaluated
separately.

## Commercial copy: unchanged by ZF1 (decision « option C »)

ProspectOS will stop offering a free trial, but not in ZF1: the Production Stripe payment is not verified end to end
yet. ZF1 therefore merges WITHOUT any commercial change — landing, PricingPage, /tarifs, llms.txt, demo banners and
the demo ICP note are exactly main's (an earlier ZF1 rewrite was reverted before the merge), and the trial backend
(`activate_trial`, 7 days, BETA, `trial_available`, quotas, account UI, CGU/CGV, Supabase emails) is untouched.
The removal is a separate release, **NO_TRIAL_RELEASE**, prerequisite: Production Stripe verified by a real purchase.

## P0 debt: VERCEL_ENV not visible at runtime

`/api/public/ux-config` answers `environment:"unknown"` on the Preview AND on Production: the functions do not see
`VERCEL_ENV`. Every environment guard that reads it is inactive — notably the Stripe locks (`billingConfig`: a TEST key
is not refused on Production, a LIVE key is always refused) and the « never explicit Production » part of
`zfWritesAllowed` (Production stays protected only by the ZF flag being absent). Not fixed here; must be resolved in
its own change BEFORE Stripe LIVE, BEFORE any ZF activation in Production, and before relying on any environment guard.

## Baseline and target

Baseline (Canary 2): ~23 human interventions for 10 prospects, 0 natural CONTACT. Global target: site → understanding
→ zone → confirmation → Aujourd'hui in ≤ 5 meaningful interactions and < 2 minutes (ZF2–ZF4). ZF1's own target: for a
project that already has data, OPEN APP → Aujourd'hui → first useful decision with 0 prior action.
