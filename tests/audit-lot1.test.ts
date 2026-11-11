// Audit of 11 nov. 2026, lot 1 (docs/AUDIT-2026-11-11.md): B1 the tenders card follows the v2 theme, B2 the TEST source is
// never offered nor accepted in production, B7 saving an ICP drops half-empty rules and names what it refuses, R2 the
// manual draft ends with the right-to-object line of the automated messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {createDiscoveryProvider,discoveryProviderConfig,fixtureProviderAvailable,FIXTURE_PROVIDER_DISABLED} from '../src/discovery/providers/index.ts';
import {CriterionContextSchema,normalizeCriteriaInput,criteriaIssueMessage} from '../src/discovery/types.ts';
import {composeRuleBased,withOptOut,OPT_OUT_LINE} from '../src/outreach/compose.ts';
import {DEFAULT_STYLE_PROFILE} from '../src/outreach/style.ts';

const read=(f:string)=>readFileSync(new URL(`../${f}`,import.meta.url),'utf8');

test('B1 — the tenders panel uses the v2 theme tokens only: no legacy white card, no hard-coded colour',()=>{
 const ui=read('src/components/TendersPanel.tsx');
 assert.doesNotMatch(ui,/className="card"/,'the legacy .card is white whatever the theme');
 assert.doesNotMatch(ui,/#[0-9a-f]{3,8}\b|rgba?\(/i,'tokens only');
 assert.match(ui,/\.pos-ui \.pos-tenders__card\{[^}]*background:var\(--pos-surface-card\)/);
 assert.match(ui,/\.pos-ui \.pos-tenders\{[^}]*color:var\(--pos-text-1\)/);
 assert.match(ui,/<label className="pos-sfield" htmlFor="pos-tenders-keywords"><span>/,'the fields of the search screen');
});

test('B2 — the TEST source: off on every deployed build, on in development and tests, an explicit switch wins',()=>{
 assert.equal(fixtureProviderAvailable({}),true,'local, tests');
 assert.equal(fixtureProviderAvailable({NODE_ENV:'development'}),true);
 // Every deployed build (Production and Preview) runs with NODE_ENV=production: off unless switched on explicitly.
 assert.equal(fixtureProviderAvailable({NODE_ENV:'production'}),false);
 assert.equal(fixtureProviderAvailable({NODE_ENV:'production',VERCEL_ENV:'preview'}),false,'VERCEL_ENV is not read: the functions do not see it at run time');
 assert.equal(fixtureProviderAvailable({NODE_ENV:'production',DISCOVERY_FIXTURE_ENABLED:'true'}),true);
 assert.equal(fixtureProviderAvailable({DISCOVERY_FIXTURE_ENABLED:'false'}),false);
 assert.doesNotMatch(read('src/discovery/providers/index.ts'),/env\.VERCEL_ENV/);
 const prod={NODE_ENV:'production'};
 assert.equal(discoveryProviderConfig(prod).providers.find(p=>p.id==='fixture')!.available,false);
 assert.equal(discoveryProviderConfig({}).providers.find(p=>p.id==='fixture')!.available,true);
 // Asked by name or by default (no provider): refused in production, never replaced by another source.
 assert.throws(()=>createDiscoveryProvider('fixture',prod),new RegExp(FIXTURE_PROVIDER_DISABLED));
 assert.throws(()=>createDiscoveryProvider(undefined,prod),new RegExp(FIXTURE_PROVIDER_DISABLED));
 assert.equal(createDiscoveryProvider('registry',prod).id,'registry');
 assert.equal(createDiscoveryProvider('fixture',{}).id,'fixture');
 // Both screens: the option only where it is offered; the live screen moves to the register when it is not.
 assert.match(read('src/ui/v2/search/SearchNative.tsx'),/\{f\.fixtureAvailable&&<option value="fixture">/);
 const panel=read('src/components/DiscoveryPanel.tsx');
 assert.match(panel,/const fixtureAvailable=mode==='demo'\|\|fixtureOffered;/,'the demo mode keeps it (it runs in the browser)');
 assert.match(panel,/else if\(!fixture&&registry\)setProvider\(p=>p==='fixture'\?'registry':p\)/);
});

test('B7 — half-empty rules are dropped, real mistakes are refused with the criterion and the field named',()=>{
 const S=z.array(CriterionContextSchema).max(30);
 const run=(v:unknown)=>{const raw=normalizeCriteriaInput(v);const r=S.safeParse(raw);return r.success?r.data:criteriaIssueMessage(r.error,raw)};
 const c=(rules:unknown,label='Zone')=>[{key:'a',label,weight:100,rules}];
 // One dimension cleared while another is filled: the filled one is kept.
 assert.deepEqual(run(c({type:'target_fit',config:{categories:[],locations:['Lyon'],match:'any_defined'}})),[{key:'a',label:'Zone',weight:100,rules:{type:'target_fit',config:{locations:['Lyon'],match:'any_defined'}}}]);
 // Nothing left: no rule at all (the criterion stays, as on the screen).
 for(const rules of [null,{type:'target_fit',config:{categories:[],locations:[],match:'any_defined'}},{type:'need_fit',config:{signals:[]}},{type:'need_fit',config:{signals:['  ']}}])
  assert.deepEqual(run(c(rules)),[{key:'a',label:'Zone',weight:100}],JSON.stringify(rules));
 // A criterion without any rule was always valid.
 assert.deepEqual(run([{key:'a',label:'Zone',weight:100}]),[{key:'a',label:'Zone',weight:100}]);
 // Still refused — and said where.
 assert.equal(run([{key:'x',label:'A',weight:50},...c({type:'target_fit',config:{locations:['A'],match:'any_defined'}})]),'critère 2 (« Zone ») — localisation : 2 caractères minimum par valeur');
 assert.equal(run(c({type:'target_fit',config:{locations:Array.from({length:21},(_,i)=>`v${i}`),match:'any_defined'}})),'critère 1 (« Zone ») — localisation : 20 valeurs au maximum');
 assert.equal(run([{key:'a',label:'Zone',weight:100,description:'x'}]),'critère 1 (« Zone ») : champ inconnu (description)');
 assert.equal(run(c({type:'target_fit',config:{locations:['Lyon']}})),'critère 1 (« Zone ») — mode de correspondance : valeur invalide');
 assert.equal(run('x'),'une liste de critères est attendue');
 const route=read('app/api/v1/[...path]/route.ts');
 assert.match(route,/error:`Critères invalides : \$\{criteriaIssueMessage\(parsedCriteria\.error,rawCriteria\)\}`,code:'INVALID_CRITERIA'/);
 assert.doesNotMatch(route,/Critères invalides : structure incorrecte/);
});

test('R2 — the manual draft ends with the right-to-object line of the automated messages, inside the asked length',()=>{
 const auto=/const OPT_OUT='([^']+)';/.exec(read('src/self-outreach/message.ts'))![1];
 assert.equal(OPT_OUT_LINE.fr.vous,auto,'the same sentence as the automated messages');
 const base={name:'ACME',offer:'Nous aidons les équipes commerciales à choisir quels comptes contacter chaque semaine.',criteria:[{key:'icp',label:'Cible',weight:100}],evidence:[],signals:[],profile:null,publicContent:[],now:new Date('2026-11-11T10:00:00Z')};
 const plain=composeRuleBased({...base,locale:'fr'});
 assert.ok(!plain.text.includes('STOP'),'unchanged without the option (Next Best Action drafts, legacy callers)');
 const fr=composeRuleBased({...base,locale:'fr',optOut:true});
 assert.ok(fr.text.endsWith(`\n\n${auto}`));assert.ok(fr.text.startsWith(plain.text.slice(0,30)));
 assert.ok(composeRuleBased({...base,locale:'en',optOut:true}).text.endsWith(`\n\n${OPT_OUT_LINE.en.vous}`));
 const tu=composeRuleBased({...base,locale:'fr',optOut:true,style:{...DEFAULT_STYLE_PROFILE,address_mode:'tu'}});
 assert.ok(tu.text.endsWith(OPT_OUT_LINE.fr.tu));
 // The line counts in the length the person asked for.
 for(const max of [300,500,900]){const t=composeRuleBased({...base,locale:'fr',optOut:true,style:{...DEFAULT_STYLE_PROFILE,max_chars:max}}).text;assert.ok(t.length<=max,`${max}: ${t.length}`);assert.ok(t.endsWith(auto))}
 assert.equal(withOptOut(fr.text,'fr'),fr.text,'never twice');
 const route=read('app/api/v1/[...path]/route.ts');
 assert.match(route,/style:styleOf\(styleRow\),optOut:true\}\);/);
 assert.match(route,/const text=ai\?withOptOut\(ai\.text,draftLocale,/,'an AI text gets the same line');
});
