// PostgreSQL integration coverage for BLOC 3 (outreach draft lifecycle + commercial pipeline).
// Loads schema.sql + migration 006 only: this feature has no dependency on the discovery
// migrations (002-005), and keeping the two suites decoupled mirrors tests/rls-runner.mjs already
// running schema.sql alone.
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const migrationOutreach = await readFile(new URL('../db/migrations/006_outreach_pipeline.sql', import.meta.url), 'utf8');
const migrationHardening = await readFile(new URL('../db/migrations/007_outreach_pipeline_hardening.sql', import.meta.url), 'utf8');

async function sql(text, params = []) { return db.query(text, params); }
async function as(user, text, params = []) {
  await sql('reset role');
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await sql(`set role ${user === undefined ? 'anon' : 'authenticated'}`);
  try { return await sql(text, params); } finally { await sql('reset role'); }
}
async function rejects(operation, pattern) {
  await assert.rejects(operation, error => pattern.test(String(error?.message)));
}

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await db.exec(schema);
  await db.exec(migrationOutreach);
  await db.exec(migrationHardening);
  // Idempotence: re-applying both migrations must not fail and must not change the effective rules.
  await db.exec(migrationOutreach);
  await db.exec(migrationHardening);
  const guardTriggerCount = (await sql(`select count(*)::int n from pg_trigger where tgrelid='public.outreach'::regclass and tgname='outreach_guard'`)).rows[0].n;
  assert.equal(guardTriggerCount,1,'re-applying migration 007 does not duplicate the outreach_guard trigger');
  const draftIndexCount = (await sql(`select count(*)::int n from pg_indexes where tablename='outreach' and indexname='outreach_one_draft_per_prospect'`)).rows[0].n;
  assert.equal(draftIndexCount,1,'re-applying migration 007 does not duplicate the partial unique index');

  const A = '00000000-0000-4000-8000-000000000001';
  const B = '00000000-0000-4000-8000-000000000002';
  const OA = '10000000-0000-4000-8000-000000000001';
  const OB = '10000000-0000-4000-8000-000000000002';
  const PA = '20000000-0000-4000-8000-000000000001';
  const PB = '20000000-0000-4000-8000-000000000002';
  const prospectA = '40000000-0000-4000-8000-000000000001';
  const prospectB = '40000000-0000-4000-8000-000000000002';
  await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'b@test')`, [A, B]);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'A',$2),($3,'B',$4)`, [OA,A,OB,B]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')`, [OA,A,OB,B]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'A project'),($3,$4,'B project')`, [PA,OA,PB,OB]);
  await as(A, `insert into public.prospects(id,organization_id,project_id,name,status) values ($1,$2,$3,'Prospect A','À contacter')`, [prospectA,OA,PA]);
  await as(B, `insert into public.prospects(id,organization_id,project_id,name) values ($1,$2,$3,'Prospect B')`, [prospectB,OB,PB]);
  const evidenceId = '50000000-0000-4000-8000-000000000001';
  await as(A, `insert into public.evidence(id,organization_id,prospect_id,criterion,value,status,source_url,excerpt)
    values ($1,$2,$3,'phone_orders',true,'VERIFIED','https://example.org/menu','Commandez par téléphone')`, [evidenceId,OA,prospectA]);

  // --- 1/2/3/4/5: message generation itself (VERIFIED vs NOT_VERIFIED vs expired vs CONTRADICTED,
  // no hallucination) is exhaustively covered in tests/core.test.ts (generateOutreach is a pure
  // function of criteria+evidence — no DB round-trip needed to prove it). This file covers what only
  // the database/RLS layer can prove: the draft's own persisted lifecycle, its audit trail, and
  // multi-tenant isolation.

  // --- Traceability (C): a generated draft records prospect/organization/content/evidence_ids/date/
  // provider, and starts life as DRAFT. ---
  const draftId = (await as(A, `insert into public.outreach(organization_id,prospect_id,content,evidence_ids,provider)
    values ($1,$2,'Bonjour, ...', $3::jsonb, 'rule_based_v1') returning id`, [OA,prospectA,JSON.stringify([evidenceId])])).rows[0].id;
  let draft = (await sql(`select * from public.outreach where id=$1`,[draftId])).rows[0];
  assert.equal(draft.status,'DRAFT','a freshly generated draft defaults to DRAFT');
  assert.equal(draft.organization_id,OA);
  assert.equal(draft.prospect_id,prospectA);
  assert.deepEqual(draft.evidence_ids,[evidenceId]);
  assert.ok(draft.created_at,'generation date is recorded');

  // --- F/7: message generation is itself an auditable, historized event — no new logging path, the
  // existing append-only events trigger now also covers outreach. ---
  let outreachEvents = (await sql(`select kind,payload from public.events where organization_id=$1 and prospect_id=$2 and kind like 'outreach.%' order by created_at`,[OA,prospectA])).rows;
  assert.deepEqual(outreachEvents.map(e=>e.kind),['outreach.insert']);
  assert.equal(outreachEvents[0].payload.status,'DRAFT');

  // --- 9/D: manual edit of the draft is possible and persisted (traceable content). ---
  await as(A, `update public.outreach set content=$1 where id=$2`, ['Bonjour, message modifié à la main.', draftId]);
  draft = (await sql(`select * from public.outreach where id=$1`,[draftId])).rows[0];
  assert.equal(draft.content,'Bonjour, message modifié à la main.');
  assert.equal(draft.status,'DRAFT','editing content alone does not change the lifecycle status');

  // --- 10/D: "Copier" marks the draft USED — but a copy is never proof of an actual send, and it
  // NEVER touches the prospect's own business status on its own. ---
  const prospectBeforeCopy = (await sql(`select status from public.prospects where id=$1`,[prospectA])).rows[0].status;
  await as(A, `update public.outreach set status='USED' where id=$1`, [draftId]);
  draft = (await sql(`select * from public.outreach where id=$1`,[draftId])).rows[0];
  assert.equal(draft.status,'USED');
  const prospectAfterCopy = (await sql(`select status from public.prospects where id=$1`,[prospectA])).rows[0].status;
  assert.equal(prospectAfterCopy,prospectBeforeCopy,'marking a draft USED never changes the prospect status — copy is not contacted');

  outreachEvents = (await sql(`select kind,payload from public.events where organization_id=$1 and prospect_id=$2 and kind like 'outreach.%' order by created_at`,[OA,prospectA])).rows;
  assert.deepEqual(outreachEvents.map(e=>e.kind),['outreach.insert','outreach.update','outreach.update'],'generation, edit, and copy-to-USED are each independently historized');
  assert.equal(outreachEvents[1].payload.status,'DRAFT','the content-edit event still shows the pre-copy status');
  assert.equal(outreachEvents[2].payload.status,'USED');

  // --- 11/12: "Contacté" requires its own explicit, separate human action — and it is independently
  // historized by the exact same generic trigger already covering every other prospect status change.
  await as(A, `update public.prospects set status='Contacté' where id=$1`, [prospectA]);
  const prospectEvents = (await sql(`select kind,payload from public.events where organization_id=$1 and prospect_id=$2 and kind='prospects.update' order by created_at desc limit 1`,[OA,prospectA])).rows;
  assert.equal(prospectEvents[0].payload.status,'Contacté');

  // --- New pipeline states (E): additive, human-set-only, everything prior stays valid. ---
  await as(A, `update public.prospects set status='Intéressé' where id=$1`, [prospectA]);
  await as(A, `update public.prospects set status='Ignoré' where id=$1`, [prospectA]);
  await rejects(as(A, `update public.prospects set status='Nawak' where id=$1`, [prospectA]), /check/i);
  await rejects(as(A, `insert into public.outreach(organization_id,prospect_id,content,status) values ($1,$2,'x','SENT')`, [OA,prospectA]), /check/i);

  // --- 8/13: multi-tenant isolation. B cannot read, update, or attach a draft to A's tenant. ---
  const crossRead = await as(B, `select * from public.outreach where id=$1`, [draftId]);
  assert.equal(crossRead.rows.length,0,'B cannot read A\'s draft');
  const crossUpdate = await as(B, `update public.outreach set status='DISCARDED' where id=$1`, [draftId]);
  assert.equal(crossUpdate.affectedRows ?? 0,0,'B cannot update A\'s draft');
  draft = (await sql(`select status from public.outreach where id=$1`,[draftId])).rows[0];
  assert.equal(draft.status,'USED','A\'s draft status is unaffected by B\'s blocked update attempt');
  await rejects(as(B, `insert into public.outreach(organization_id,prospect_id,content,evidence_ids) values ($1,$2,'Untrusted','[]'::jsonb)`, [OB,prospectA]),
    /foreign key/i);
  const crossProspectUpdate = await as(B, `update public.prospects set status='Contacté' where id=$1`, [prospectA]);
  assert.equal(crossProspectUpdate.affectedRows ?? 0,0,'B cannot modify A\'s prospect');

  // ============================================================
  // M1 — at most one live DRAFT per prospect, enforced by a partial unique index (migration 007),
  // not by the discard-then-insert application sequence alone.
  // ============================================================
  const raceProspect = '40000000-0000-4000-8000-000000000003';
  await as(A, `insert into public.prospects(id,organization_id,project_id,name) values ($1,$2,$3,'Race prospect')`, [raceProspect,OA,PA]);

  // 1/2 — two concurrent generations for the same prospect: simulate the exact interleaving two
  // simultaneous "Préparer le message" requests would produce (each request is its own
  // discard-then-insert, run as two independent statements/transactions, never one atomic unit).
  const raceDraft1 = '60000000-0000-4000-8000-000000000001';
  const raceDraft2 = '60000000-0000-4000-8000-000000000002';
  await sql(`update public.outreach set status='DISCARDED' where prospect_id=$1 and organization_id=$2 and status='DRAFT'`, [raceProspect, OA]); // request 1 discard (no-op, nothing yet)
  await sql(`update public.outreach set status='DISCARDED' where prospect_id=$1 and organization_id=$2 and status='DRAFT'`, [raceProspect, OA]); // request 2 discard, races ahead of request 1's insert
  await as(A, `insert into public.outreach(id,organization_id,prospect_id,content,evidence_ids) values ($1,$2,$3,'request 1 draft','[]'::jsonb)`, [raceDraft1, OA, raceProspect]); // request 1 insert: wins
  await rejects(
    as(A, `insert into public.outreach(id,organization_id,prospect_id,content,evidence_ids) values ($1,$2,$3,'request 2 draft','[]'::jsonb)`, [raceDraft2, OA, raceProspect]),
    /duplicate key|unique/i
  ); // request 2 insert: the exact race the previous red-team proved — now rejected by the DB, a clean unique_violation, never a silent second DRAFT
  const liveDraftsAfterRace = (await sql(`select id from public.outreach where prospect_id=$1 and status='DRAFT'`, [raceProspect])).rows;
  assert.equal(liveDraftsAfterRace.length, 1, 'never more than one live DRAFT for the same prospect, even under a raced discard-then-insert');
  assert.equal(liveDraftsAfterRace[0].id, raceDraft1);

  // The loser's retry (exactly what route.ts's caller is expected to do on a 409) succeeds cleanly:
  // discard the current DRAFT, then insert — no leftover row, no data loss.
  await sql(`update public.outreach set status='DISCARDED' where prospect_id=$1 and organization_id=$2 and status='DRAFT'`, [raceProspect, OA]);
  await as(A, `insert into public.outreach(id,organization_id,prospect_id,content,evidence_ids) values ($1,$2,$3,'request 2 retry draft','[]'::jsonb)`, [raceDraft2, OA, raceProspect]);
  const afterRetry = (await sql(`select id,status from public.outreach where prospect_id=$1 order by created_at`, [raceProspect])).rows;
  assert.deepEqual(afterRetry.map(r=>r.status), ['DISCARDED','DRAFT'], '2 — the superseded draft becomes DISCARDED, never deleted');
  assert.equal(afterRetry.length, 2, '5 — both rows still exist: history is never destroyed by the race or the retry');

  // 3/4 — a regeneration (the same discard-then-insert route.ts runs) must never touch an existing
  // USED or APPROVED row for the same prospect: it only ever discards rows currently DRAFT.
  const usedEarlierId = '60000000-0000-4000-8000-000000000006';
  await as(A, `insert into public.outreach(id,organization_id,prospect_id,content,evidence_ids,status) values ($1,$2,$3,'used earlier','[]'::jsonb,'USED')`, [usedEarlierId, OA, raceProspect]);
  const approvedId = '60000000-0000-4000-8000-000000000003';
  await as(A, `insert into public.outreach(id,organization_id,prospect_id,content,evidence_ids,status) values ($1,$2,$3,'approved earlier','[]'::jsonb,'APPROVED')`, [approvedId, OA, raceProspect]);
  // A fresh regeneration for this prospect: discard current DRAFT (raceDraft2), insert a new one.
  await sql(`update public.outreach set status='DISCARDED' where prospect_id=$1 and organization_id=$2 and status='DRAFT'`, [raceProspect, OA]);
  const raceDraft3 = '60000000-0000-4000-8000-000000000004';
  await as(A, `insert into public.outreach(id,organization_id,prospect_id,content,evidence_ids) values ($1,$2,$3,'request 3 draft','[]'::jsonb)`, [raceDraft3, OA, raceProspect]);
  const statusesAfterRegen = Object.fromEntries((await sql(`select id,status from public.outreach where prospect_id=$1`, [raceProspect])).rows.map(r=>[r.id,r.status]));
  assert.equal(statusesAfterRegen[usedEarlierId], 'USED', '3 — a USED draft is left untouched by a later regeneration');
  assert.equal(statusesAfterRegen[approvedId], 'APPROVED', '4 — an APPROVED draft is left untouched by a later regeneration');
  assert.equal(statusesAfterRegen[raceDraft2], 'DISCARDED');
  assert.equal(statusesAfterRegen[raceDraft3], 'DRAFT');

  // 6 — the constraint (index) itself survives being re-applied without duplication (already asserted
  // above at load time; re-confirmed here after real traffic has flowed through the table).
  await db.exec(migrationHardening);
  const guardTriggerCountAfterTraffic = (await sql(`select count(*)::int n from pg_trigger where tgrelid='public.outreach'::regclass and tgname='outreach_guard'`)).rows[0].n;
  assert.equal(guardTriggerCountAfterTraffic, 1, '6 — the migration stays idempotent after real rows/traffic exist, not just on an empty table');

  // ============================================================
  // M2 — USED and DISCARDED are terminal: neither status nor content can change again, enforced
  // independently by the DB trigger (outreach_guard) regardless of any API-level check.
  // ============================================================
  const usedRow = usedEarlierId; // already USED from above
  const discardedRow = raceDraft2; // already DISCARDED from above
  const draftRow = raceDraft3; // still DRAFT

  // 7/8 — content or status patch on a USED row is rejected.
  await rejects(as(A, `update public.outreach set content='hacked after use' where id=$1`, [usedRow]), /immutable/i);
  await rejects(as(A, `update public.outreach set status='DISCARDED' where id=$1`, [usedRow]), /immutable/i);
  let usedAfter = (await sql(`select status,content from public.outreach where id=$1`,[usedRow])).rows[0];
  assert.equal(usedAfter.status, 'USED');
  assert.notEqual(usedAfter.content, 'hacked after use');

  // 9/10 — content or status patch on a DISCARDED row is rejected.
  await rejects(as(A, `update public.outreach set content='hacked after discard' where id=$1`, [discardedRow]), /immutable/i);
  await rejects(as(A, `update public.outreach set status='USED' where id=$1`, [discardedRow]), /immutable/i);
  let discardedAfter = (await sql(`select status,content from public.outreach where id=$1`,[discardedRow])).rows[0];
  assert.equal(discardedAfter.status, 'DISCARDED');
  assert.notEqual(discardedAfter.content, 'hacked after discard');

  // 11/12/13 — a DRAFT row stays fully mutable: content editable, and can still reach USED or
  // DISCARDED (the transitions the product actually uses).
  await as(A, `update public.outreach set content='edited while still draft' where id=$1`, [draftRow]);
  assert.equal((await sql(`select content from public.outreach where id=$1`,[draftRow])).rows[0].content, 'edited while still draft', '11 — DRAFT content is modifiable');
  await as(A, `update public.outreach set status='USED' where id=$1`, [draftRow]);
  assert.equal((await sql(`select status from public.outreach where id=$1`,[draftRow])).rows[0].status, 'USED', '12 — DRAFT -> USED is allowed');
  await rejects(as(A, `update public.outreach set content='too late now' where id=$1`, [draftRow]), /immutable/i); // now terminal itself

  const discardableDraft = '60000000-0000-4000-8000-000000000005';
  await as(A, `insert into public.outreach(id,organization_id,prospect_id,content,evidence_ids) values ($1,$2,$3,'to be discarded','[]'::jsonb)`, [discardableDraft, OA, raceProspect]);
  await as(A, `update public.outreach set status='DISCARDED' where id=$1`, [discardableDraft]);
  assert.equal((await sql(`select status from public.outreach where id=$1`,[discardableDraft])).rows[0].status, 'DISCARDED', '13 — DRAFT -> DISCARDED is allowed');

  // 14 — cross-tenant remains blocked exactly as before these two fixes (RLS is untouched by
  // migration 007; the new trigger/index add restrictions, they never relax RLS).
  const crossReadAfterHardening = await as(B, `select * from public.outreach where id=$1`, [usedRow]);
  assert.equal(crossReadAfterHardening.rows.length, 0, '14 — B still cannot read A\'s outreach rows');
  const crossUpdateAfterHardening = await as(B, `update public.outreach set content='cross-tenant' where id=$1`, [draftRow]);
  assert.equal(crossUpdateAfterHardening.affectedRows ?? 0, 0, '14 — B still cannot update A\'s outreach rows');
  await rejects(as(B, `insert into public.outreach(organization_id,prospect_id,content,evidence_ids) values ($1,$2,'cross-tenant insert','[]'::jsonb)`, [OB, raceProspect]),
    /foreign key/i);

  console.log('PASS: outreach draft lifecycle (DRAFT/USED), traceability via the shared events trigger, copy-is-not-contacted, additive pipeline statuses, multi-tenant isolation, single-live-DRAFT under a race (M1), and USED/DISCARDED terminality (M2)');
} finally {
  await db.close();
}
