---
name: prospectos
description: House rules for working on ProspectOS (this repository) — evidence-first data model, frozen files and guard tests, migration numbering and review lists, the full validation suite, staging-then-production delivery, safe database writes, and public-data prospecting rules. Use it before changing code, migrations, tests or data of ProspectOS, before deploying, and whenever researching or saving prospects.
---

# ProspectOS — house rules

ProspectOS is an evidence-first B2B prospecting engine (Next.js on Vercel, Supabase Postgres). The product promise is
"found ≠ observed ≠ inferred ≠ verified": every fact has a source and an exact excerpt, and nothing counts until a
person confirms it. These rules come from real incidents on this codebase; follow them unless the user says otherwise.
Talk to the user in French.

## 1. Evidence-first (never break it)

- Nothing becomes `VERIFIED` automatically. Analyses, registers and imports save **proposals**: observations
  (`save_discovery_observations`) whose evidence is `NOT_VERIFIED` / `INFERRED_UNCONFIRMED`. A human confirms.
- Every fact keeps `source_url` + an excerpt quoted from that source. Never paraphrase a quote, never invent an email,
  a name, a domain or a SIREN. An unidentified company is a question to the person (candidates), not a guess.
- `scoreProspect` (src/domain/core.ts) counts VERIFIED evidence only; it is protected by an invariant test — display
  helpers go next to it (e.g. `unreviewedContrary`), never inside it.
- An outreach message may only be approved/copied while every cited source is still VERIFIED (migrations 029, 036).

## 2. Frozen files and guard tests — read before editing

Many tests pin files byte-for-byte or pin the list of migrations. Before touching a file, `grep -rn "<file name>" tests/`.
- `app/page.tsx` before ` if(v2){` and the legacy shell are frozen (flag-OFF parity). Production runs the **v2 UI**
  (`UI_V2_ENABLED`): change `src/ui/v2/**` instead; the v2 branch of page.tsx may change.
- `src/i18n/fr.ts`, `en.ts`, legal/SEO/pricing files are hash-frozen (tests/web-v2-site.test.ts). New UI copy goes in a
  local FR/EN dictionary inside the component (see `src/components/PublicRecordsControl.tsx`, `src/ui/v2/prospects/model.ts`).
- `src/discovery/api.ts` is pinned (entitlement line, no request body in analyze, diff-vs-base guard). A new server
  action gets **its own module** wired in `app/api/v1/[...path]/route.ts` (pattern: `src/discovery/public-records-api.ts`).
- When a guard fails, decide whether it caught a real problem or needs an explicit, documented update in the same
  style — never weaken or delete a guard to get green.

## 3. Migrations

- Number: check **every** source before choosing NNN — `db/migrations/` on main, other branches
  (`git ls-tree origin/<branch> db/migrations/`), and the staging/production history (Supabase `list_migrations`).
  A parallel branch already used 035 once.
- Format: `begin; … commit;`, idempotent (`create or replace`, `drop … if exists`), a header comment explaining why and
  the rollback. Security-definer/invoker and `search_path=''` like the existing functions.
- Register a new migration in every review-list test (it fails at SETUP otherwise):
  `tests/user-declared-evidence-db.mjs`, `tests/icp-evidence-mapping.test.ts`, `tests/stripe-billing-db.mjs`,
  `tests/deleted-beta-capacity-db.mjs`, `tests/legacy-test-billing-cleanup-db.mjs` — with an assertion of what it does
  NOT touch (evidence writes, billing, policies…). `grep -rln "0NN_" tests/` with the previous number finds them all.
- Write a PGlite DB test (pattern: `tests/outreach-evidence-provenance-db.mjs`), prove it **fails without** the
  migration, add it to `package.json` `test:all` (and `.github/workflows/ci.yml` when relevant).

## 4. Validation before any push

Run all of it, not a subset (a skipped suite already turned CI red once):
```bash
npm run typecheck
npm test                                    # compare failures with main: none may be new
node -e 'console.log(require("./package.json").scripts["test:all"])'   # then run EVERY test:* DB suite it lists
rm -rf .next && npx next build
```
- Tests run with `node --experimental-strip-types`: no TypeScript parameter properties, no enums; test imports use `.ts`.
- A stale `.next/` from another branch breaks typecheck: delete it.
- Re-read the diff adversarially; check what a parallel branch (`feat/self-outreach`) will conflict with
  (`git merge` it into a throwaway worktree).

## 5. Delivery: staging, then production

1. Branch from up-to-date `main`; PR into `main` (merge commits, never rewrite someone else's branch).
2. Migration on **staging** first (`ggilyurgopsjrpnvxovl`): the GitHub workflow `staging-migrations.yml`, or — when the
   runner refuses (a staging migration absent from the branch) — Supabase `apply_migration` with the file's exact
   statements and the name `NNN_name`. Verify on real data in a rolled-back transaction.
3. Before production (`vptqxhlxwiljfbkybqej`), **measure the impact** (e.g. how many live rows a new guard blocks),
   apply, then verify the function/trigger/grants.
4. Merge when CI is green; confirm the Vercel production deployment of the merge commit is READY.
5. Never apply a one-off data migration (e.g. billing) without reading the live state first: if it differs, stop and
   report.

## 6. Writing to the database

- Through the API whenever possible. If SQL is needed, act **as the owning user** so RLS and audit apply:
  `set local role authenticated; select set_config('request.jwt.claims','{"sub":"<user uuid>","role":"authenticated"}',true);`
  (the audit trigger refuses writes without a tenant member — that refusal is a feature).
- Confirm the target account/project with the user before writing (production vs staging, whose organization). Never
  write into a customer's account without their consent.

## 7. Prospecting and public data

- Allowed sources: API Recherche d'entreprises (Sirene/RNE), DECP on data.gouv.fr (`tabular-api`, exact SIRET filter),
  CCI directories, the company's own site, BODACC. Fixed hosts, bounded size/time, redirects refused.
- Never scrape LinkedIn, Facebook, Instagram, X, TikTok, nor search-engine result pages, and never work around a bot
  check. Use official APIs, user-pasted content, or ask.
- GDPR: no executives or address for a non-diffusible company; never a date of birth; amounts of public contracts are
  never quoted as revenue (whole contract, often shared).
- Verify a website's identity on the page itself (name + city or SIREN) before using it; homonym domains are common.
- Deliver fewer verified results rather than padding a list; say what was checked and what was rejected, and why.

## 8. Testing the running app

Use the `webapp-testing` skill (`.claude/skills/webapp-testing`) for browser checks, with these adjustments (verified in
the cloud container):
- The **Node** Playwright is preinstalled: write the automation as **CommonJS** (`check.cjs`, `require('playwright')`,
  `chromium.launch()`); an ES module `import 'playwright'` does not resolve. The Python Playwright is not installed —
  do not install another Playwright.
- Test the **production build**: `next dev` opens the port but never answers in the container. Run
  `rm -rf .next && npx next build`, then
  `python3 .claude/skills/webapp-testing/scripts/with_server.py --server "npx next start -p 3000" --port 3000 --timeout 90 -- node check.cjs`.
- Wait with `waitUntil:'load'` (or a selector), not `networkidle`.
- Logged-in screens need a session: test public pages and the demo mode here; anything behind login is checked by the
  user on the Vercel preview.
