// Audit 2026-11-11, R1 — the nightly retention job (migration 048): always on, server-only, same authorization as the
// other jobs; the privacy policy states what it deletes.
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
test('retention job: nightly, GET only, CRON_SECRET, calls run_retention through the server client',()=>{
 const route=read('app/api/cron/retention/route.ts');
 assert.match(route,/cronAuthorized\(request\.headers\.get\('authorization'\),process\.env\.CRON_SECRET\)/);
 assert.match(route,/admin\.rpc\('run_retention'\)/);
 assert.doesNotMatch(route,/export async function (POST|PUT|PATCH|DELETE)|request\.(json|text)\(|searchParams|process\.env\.[A-Z_]*ENABLED/,'always on: no flag can skip a retention period');
 assert.deepEqual(JSON.parse(read('vercel.json')).crons.filter((c:{path:string})=>c.path==='/api/cron/retention'),[{path:'/api/cron/retention',schedule:'29 2 * * *'}]);
});
test('privacy policy: section 8 states the 3-year rule for contact details and the purges the job applies',()=>{
 const page=read('app/confidentialite/page.tsx');
 assert.match(page,/supprimées automatiquement lorsque la fiche n’a connu aucune activité pendant 3 ans/);
 assert.match(page,/un signal non examiné est supprimé après 60 jours, un signal écarté 30 jours après son rejet/);
 assert.match(page,/supprimées au bout de 13 mois, sauf celles citées par une liste livrée/);
 const m=read('db/migrations/048_retention.sql');
 assert.match(m,/interval '3 years'/);assert.match(m,/interval '13 months'/);assert.match(m,/purge_inactive_contacts\(5000\)/);
 assert.match(read('db/migrations/024_signals.sql'),/when 'reject' then now\(\)\+interval '30 days' else now\(\)\+interval '60 days'/);
});
