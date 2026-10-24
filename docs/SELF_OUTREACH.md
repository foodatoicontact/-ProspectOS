# Self-Outreach Distribution Engine — V1

ProspectOS uses its own engine to sell ProspectOS: **why this company, why this person, why now, which proof**.
Low volume, high relevance, and a person approves every email. This is not a generic cold-email tool.

```
SIGNAL → QUALIFICATION → PROOF → FIT → TIMING → CONTACT → MESSAGE → HUMAN VALIDATION → SMTP (IONOS)
       → REPLY DETECTION → STOP FOLLOW-UPS → OUTCOME
```

## 1. Audit (phase 0)

| Area | Found in the repository | Use |
|---|---|---|
| Signals | 024 `signals` (PENDING_REVIEW / VERIFIED / REJECTED by a person), Signal-first 030, monitoring 026 | The only source of "why now"; only VERIFIED signals can back an outreach |
| Evidence / FIT | `scoreProspect`, `estimateFit`, NBA v1.3 `FitProfile` | FIT = verified score (what CONTACT reads) |
| Intent / timing / evidence quality | NBA engine (`buildOpportunity`, registry of commercial signal types: SDR, BDR, AE, Head of Sales, first sales, pipeline building, funding, new market…) | Reused unchanged |
| Message safety | `src/outreach/fact-guard.ts`, NBA forbidden-offer and flattery checks | Every generated or edited text goes through them |
| Cron | `app/api/cron/signals` + `cronAuthorized` (CRON_SECRET), server-only admin client | Same pattern for `app/api/cron/self-outreach` |
| Email / reminder infrastructure | **None.** No SMTP, IMAP, reminder or follow-up scheduler exists on any branch (searched `main` and every remote branch). The prompt's "existing reminder infrastructure" does not exist in this repository. | Built here, once, on the existing cron pattern |
| Feature flags | `NEXT_BEST_ACTION_ENABLED`, `DISCOVERY_DYNAMIC_ANALYSIS_ENABLED`… (env, server-side) | `SELF_OUTREACH_ENABLED`, `SELF_OUTREACH_SEND_ENABLED` |
| Audit | `public.events`, append-only `nba_action_events` | `outreach_events` |

## 2. Data model (migration 035)

`outreach_campaigns`, `outreach_contacts`, `outreach_candidates`, `outreach_messages`, `outreach_events`,
`outreach_suppressions` (global), `outreach_inbound`, `outreach_daily_counters`. RLS on every table; clients read their
organization's rows only and write nothing directly; suppressions and counters are not readable by clients.

Candidate lifecycle: `DISCOVERED → QUALIFIED → NEEDS_REVIEW → APPROVED / REJECTED → READY_TO_SEND → SENDING → SENT →
REPLIED / BOUNCED / SUPPRESSED / FAILED`. Every transition writes an `outreach_events` row.

Message send states: `DRAFT → READY (approved) → SENDING (leased) → SENT`, or `CANCELLED`, `FAILED`, `UNCERTAIN`.

## 3. Rules enforced (and where)

| Rule | Where |
|---|---|
| Email never guessed | `outreach_contacts` check: source in a closed list without any "pattern"; a public source needs its URL **and an excerpt that writes the address** (`checkContact` does the same before). `email_verified_at` is set only by a real reply. |
| Decision maker never invented | name + role + `role_source_url` required |
| Signal VERIFIED, evidence VERIFIED and of that company | `create_outreach_candidate` |
| Score ≥ 75 = eligible for **review** only | `NEEDS_REVIEW`; sending needs `review_outreach_message('APPROVE')` by a member |
| Facts sourced, no free trial / beta / test, no flattery, no "j'espère que vous allez bien" | `generateInitial` / `checkHumanEdit` (fact guard), and `outreach_text_refused` in the database at edit and approval |
| No real email when `SELF_OUTREACH_SEND_ENABLED` is not true | `createSmtpTransport` throws; the cron route only builds it behind both flags; API, worker, UI never import it |
| Suppression checked before sending, not only at qualification | at contact creation, candidate creation, approval, claim, and `outreach_send_permitted` right before SMTP (advisory lock on the address) |
| Opt-out / unsubscribe → global suppression | reply proposing UNSUBSCRIBE (sender address), outcome UNSUBSCRIBE, manual |
| Hard bounce → suppression | SMTP 55x on RCPT, or DSN 5.x.x naming one of our recipients |
| Reply → follow-ups stopped atomically | `record_outreach_inbound` |
| No automatic answer | nothing in the code writes to a prospect except the approved message |
| Daily cap (10) atomic | one counter row per (Europe/Paris day, sender) incremented under its row lock at claim; a send that did not happen gives its slot back |
| No double send | `FOR UPDATE SKIP LOCKED` claim, lease token, RFC Message-ID unique per approved message, completion needs the lease; a lost lease becomes `UNCERTAIN` and is **never re-sent** automatically |
| Retry bounded | 3 attempts, only for failures that happened before the message was handed over |
| Authorization error | the batch stops, every claimed message goes back to READY |

## 4. Scoring

`OUTREACH = 0.35 FIT + 0.30 TIMING + 0.15 INTENT + 0.20 EVIDENCE QUALITY` (0–100), each line explained
(`src/self-outreach/score.ts`). Gates (never eligible): signal not VERIFIED, signal outside the ICP's zone, KNOWN_LOW FIT.
`OUTREACH_SCORE_THRESHOLD` (default 75) puts a candidate in the review queue — nothing more.

## 5. Matching replies (conservative)

`In-Reply-To` / `References` = one of our RFC Message-IDs → REPLIED (auto-submitted → NEEDS_REVIEW). Sender alone matching
exactly one sent outreach → NEEDS_REVIEW (a person confirms), follow-ups stopped. Several → AMBIGUOUS, all NEEDS_REVIEW.
The proposed outcome (POSITIVE / NEUTRAL / OBJECTION / NOT_INTERESTED / UNSUBSCRIBE / BOUNCE / UNKNOWN) is rule-based,
read on the reply's own text (the quoted original is removed), stored with its basis; a person sets the outcome.

## 6. Follow-ups

The cron job drafts a follow-up when it is due (campaign delay, no reply, not suppressed); the draft waits for a person's
approval like any message, and is re-checked at claim and right before sending. Reply, suppression, bounce or ambiguity
cancel it.

## 7. Environment (server only — never `NEXT_PUBLIC_`)

`SELF_OUTREACH_ENABLED=false`, `SELF_OUTREACH_SEND_ENABLED=false`, `SELF_OUTREACH_ORG_IDS` (ProspectOS's organization),
`OUTREACH_SCORE_THRESHOLD=75`, `MAX_NEW_OUTREACH_PER_DAY=10`, `OUTREACH_SMTP_HOST`, `OUTREACH_SMTP_PORT` (465 implicit TLS,
otherwise STARTTLS required), `OUTREACH_SMTP_USER`, `OUTREACH_SMTP_PASSWORD`, `OUTREACH_FROM_EMAIL`, `OUTREACH_FROM_NAME`,
`OUTREACH_IMAP_HOST`, `OUTREACH_IMAP_PORT` (993), `OUTREACH_IMAP_USER`, `OUTREACH_IMAP_PASSWORD`, `CRON_SECRET` (existing).

## 8. Activation (each step needs an explicit GO)

1. Apply migration 035 to staging (workflow "Staging migrations").
2. Preview: `SELF_OUTREACH_ENABLED=true`, `SELF_OUTREACH_ORG_IDS`, send flag OFF → review workflow without sending. The same
   organization must also be listed in the database by an operator, from the Supabase SQL editor of that project (it
   runs as the `postgres` owner). No API role can do it: the table has no grant to `anon`, `authenticated` or
   `service_role` (the migration header's "SQL, service role" is inaccurate — the file stays as applied, its MD5 is
   recorded by the staging runner). Add (idempotent, refuses an unknown organization):
   `insert into prospectos_private.self_outreach_organizations(organization_id,note) select id,'ProspectOS' from public.organizations where id='<uuid>' on conflict (organization_id) do nothing returning organization_id;`
   Check: `select organization_id,note,added_at from prospectos_private.self_outreach_organizations;`
   Remove: `delete from prospectos_private.self_outreach_organizations where organization_id='<uuid>' returning organization_id;`
   Both lists must agree: the Next.js routes check `SELF_OUTREACH_ORG_IDS`; the SQL functions, read policies and the
   send / follow-up path check the database list (a member calling Supabase directly skips the routes). Removing a row
   stops new writes, reads, claims, follow-ups and pending sends at once; replies, bounces and unsubscribes are still
   recorded and still feed the global suppression list.
3. Canary 0 → 3 (one email to an address we control, then 1, 3, at most 10 real prospects a day), with the SMTP/IMAP
   credentials added by the owner, `SELF_OUTREACH_SEND_ENABLED=true` on that environment only, and the cron schedule
   (`/api/cron/self-outreach`) added to `vercel.json`. Checked at each step: duplicate_send = 0, unexpected_send = 0,
   suppression violations = 0, reply_stop failures = 0, credential exposure = 0.

Dry run: `npm run test:self-outreach-dry-run`.
