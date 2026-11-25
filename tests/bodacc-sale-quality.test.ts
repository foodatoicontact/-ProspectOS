// Weekly check of the BODACC sale sort (src/collect/sale-quality.ts, migration 054, app/api/cron/bodacc-quality) — owner
// decision, 25 nov. 2026: a change in the register's wording raises an alert instead of a silent error. Counts only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkSaleQuality,alertText,countRules,RULE_KIND,SHIFT_POINTS,UNDETERMINED_MAX} from '../src/collect/sale-quality.ts';
import {SALE_RULES} from '../src/domain/bodacc-purchase.ts';
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
// A normal week, in the proportions of 26 Oct.–24 Nov. 2026: half purchases, mostly mergers otherwise.
const normal={category_purchase:360,start_after_purchase:150,origin_purchase:40,text_merger:520,text_contribution:25,origin_forced:6,no_rule:4};
const week=(week_start:string,rules:Record<string,number>)=>({week_start,runs:7,rules});
const history=[week('2026-11-17',normal),week('2026-11-10',normal),week('2026-11-03',normal),week('2026-10-27',normal),week('2026-10-20',normal)];

test('every rule maps to a kind, and nothing else',()=>{
 assert.deepEqual(Object.keys(RULE_KIND).sort(),[...SALE_RULES].sort());
 assert.deepEqual(countRules(['text_sale','text_sale','no_rule']),{text_sale:2,no_rule:1});
});

test('a normal week raises nothing',()=>{
 const r=checkSaleQuality(history);
 assert.deepEqual(r.alerts,[]);assert.equal(r.notices,1105);assert.equal(r.week_start,'2026-11-17');
 assert.ok(Math.abs(r.shares.PURCHASE-0.498)<0.001);
});

test('alerts: collection stopped, unknown rule, too many undetermined, a share that moves',()=>{
 assert.deepEqual(checkSaleQuality([week('2026-11-17',{category_purchase:3}),...history.slice(1)]).alerts,[{code:'NO_NOTICES',notices:3}]);
 assert.deepEqual(checkSaleQuality([]).alerts,[{code:'NO_NOTICES',notices:0}]);
 const unknown=checkSaleQuality([week('2026-11-17',{...normal,new_rule:2}),...history.slice(1)]);
 assert.deepEqual(unknown.alerts,[{code:'UNKNOWN_RULE',rule:'new_rule'}]);
 // The register renames « Autre achat… »: the catch-all is no longer recognised, everything falls into no_rule.
 const renamed=checkSaleQuality([week('2026-11-17',{category_purchase:360,start_after_purchase:150,no_rule:590}),...history.slice(1)]);
 assert.deepEqual(renamed.alerts.map(a=>a.code),['UNDETERMINED_HIGH','SHARE_SHIFT','SHARE_SHIFT']);
 assert.deepEqual(renamed.alerts.filter(a=>a.code==='SHARE_SHIFT').map(a=>a.code==='SHARE_SHIFT'&&a.kind),['MERGER','UNDETERMINED']);
 const text=alertText(renamed);
 assert.match(text,/semaine du 2026-11-17/);assert.match(text,/n'ont pu être classées/);assert.match(text,/Part des fusions et restructurations/);
 assert.ok(SHIFT_POINTS===10&&UNDETERMINED_MAX===0.03);
 // No baseline yet (first weeks after the migration): only the week's own checks.
 assert.deepEqual(checkSaleQuality([week('2026-11-17',normal)]).baseline,null);
});

test('route: weekly Vercel cron, the Authorization header only, a mail only on alert and only if configured; counts only',()=>{
 const vercel=JSON.parse(read('vercel.json'));
 assert.deepEqual(vercel.crons.filter((c:{path:string})=>c.path==='/api/cron/bodacc-quality'),[{path:'/api/cron/bodacc-quality',schedule:'53 7 * * 1'}]);
 const src=read('app/api/cron/bodacc-quality/route.ts');
 assert.match(src,/cronAuthorized\(request\.headers\.get\('authorization'\),process\.env\.CRON_SECRET\)/);
 assert.match(src,/if\(report\.alerts\.length\)\{/);assert.match(src,/process\.env\.OPS_ALERT_EMAIL/);
 assert.doesNotMatch(src,/descriptif|listepersonnes|public_events\b/,'the check reads rule counts only');
 assert.doesNotMatch(src,/export async function (POST|PUT|DELETE)/);
});
