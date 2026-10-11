// The rule-based message (the safe default and the AI fallback) respects the style profile's max_chars. Canary audits
// showed the DIMO fallback at 612 characters for max_chars 600. The fit is adaptive and deterministic, never a blind
// slice: the protected head (greeting + verified quote + "why now" sentence) is kept verbatim, then, in order, the closing
// question gets its short form, trailing offer sentences are dropped (the first one stays), the first offer sentence is
// shortened on a word boundary with "…", and only then the offer is left out. If the protected head plus the short
// question alone exceed max_chars, that is the message (over the limit): a verified quote is never cut or altered.
// No style profile (legacy / demo call) → the text is exactly what it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import {composeRuleBased} from '../src/outreach/compose.ts';
import * as core from '../src/domain/core.ts';
import {DEFAULT_STYLE_PROFILE,type StyleProfile} from '../src/outreach/style.ts';
import type {IntentSignal} from '../src/domain/intent.ts';

const NOW=new Date('2026-10-10T12:00:00Z');
const day=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
const OFFER='BIG aide les entreprises B2B à accélérer leur prospection commerciale en leur donnant accès à des commerciaux freelances spécialisés sur leur marché. BIG permet de renforcer rapidement une équipe commerciale, externaliser la prospection, tester un nouveau marché et générer des rendez-vous qualifiés sans recruter immédiatement un SDR/BDR en interne.';
const EXCERPT='Enfin, la notation la plus élevée de la Banque de France (E1+), apporte un gage de rentabilité et de fiabilité de la société pour pérenniser la confiance de ses clients.';
const ev=(excerpt=EXCERPT):core.Evidence=>({id:'e1',criterion:'need_fit',value:true,status:'VERIFIED',source_url:'https://www.dimosoftware.fr/',excerpt,observed_at:day(5),verified_by:'u1'});
const sig=():IntentSignal=>({id:'s1',signal_type:'hiring_role',status:'VERIFIED',title:'DIMO recrute',excerpt:'DIMO Software ouvre un poste de responsable commercial grands comptes à Lyon pour accompagner ses clients.',
 source_url:'https://jobs.example/dimo',source_domain:'jobs.example',confidence:0.8,event_date:null,published_at:day(4),observed_at:day(1),matched_terms:[]} as IntentSignal);
const style=(o:Partial<StyleProfile>={}):StyleProfile=>({...DEFAULT_STYLE_PROFILE,...o});
const compose=(o:{st?:StyleProfile;offer?:string;excerpt?:string;locale?:'fr'|'en';signals?:IntentSignal[]}={})=>composeRuleBased({name:'DIMO Software',offer:o.offer??OFFER,criteria:core.DEFAULT_CRITERIA,
 evidence:[ev(o.excerpt)],signals:o.signals??[],profile:{types:{hiring_role:25},terms:[]},publicContent:[],now:NOW,locale:o.locale??'fr',style:o.st});
const QUOTE=`« ${EXCERPT.replace(/[.!?]+$/,'')} »`;
const provenance=(c:ReturnType<typeof compose>)=>({evidence_ids:c.evidence_ids,signal_ids:c.signal_ids,public_content_ids:c.public_content_ids,angle:c.angle,why_now:c.why_now});

test('the reported case — tu, max_chars 600: was 612, now ≤ 600, quote and full offer kept, short closing question',()=>{
 const unbounded=compose({st:style({address_mode:'tu',max_chars:2000})});
 assert.equal(unbounded.text.length,612,'the reproduced 612-character fallback');
 const c=compose({st:style({address_mode:'tu',max_chars:600})});
 assert.ok(c.text.length<=600,`${c.text.length} > 600`);
 assert.ok(c.text.includes(QUOTE),'verified quote verbatim');
 assert.ok(c.text.includes(OFFER),'the whole offer still fits');
 assert.ok(c.text.startsWith('Bonjour, j’ai remarqué ceci sur ton site : '));
 assert.ok(c.text.endsWith('Ça t’intéresserait d’en parler ?'));
 assert.deepEqual(provenance(c),provenance(unbounded),'same angle and provenance');
});
test('vous — the same fit keeps vous: greeting and short question in vous',()=>{
 const c=compose({st:style({address_mode:'vous',max_chars:600})});
 assert.ok(c.text.length<=600);assert.ok(c.text.startsWith('Bonjour l’équipe DIMO Software, j’ai remarqué ceci sur votre site : '));
 assert.ok(c.text.includes(QUOTE));assert.ok(c.text.endsWith('Seriez-vous ouvert à un échange ?'));assert.doesNotMatch(c.text,/\bt’|\bton\b|\btes\b/);
});
test('larger limit — nothing changes',()=>{
 for(const max of [700,1000,2000])assert.equal(compose({st:style({address_mode:'tu',max_chars:max})}).text,compose({st:style({address_mode:'tu',max_chars:2000})}).text);
});
for(const max of [450,400,300,250,200]){
 test(`smaller limit ${max} — fits, quote verbatim, offer reduced from its end, deterministic, provenance unchanged`,()=>{
  const c=compose({st:style({address_mode:'tu',max_chars:max})});
  assert.ok(c.text.length<=max||c.text===compose({st:style({address_mode:'tu',max_chars:max})}).text,'deterministic');
  assert.ok(c.text.includes(QUOTE),'quote never cut');
  assert.ok(c.text.endsWith('Ça t’intéresserait d’en parler ?'));
  assert.deepEqual(provenance(c),provenance(compose({st:style({address_mode:'tu',max_chars:2000})})));
  const head=`Bonjour, j’ai remarqué ceci sur ton site : ${QUOTE}.`;
  if(head.length+1+'Ça t’intéresserait d’en parler ?'.length<=max){
   assert.ok(c.text.length<=max,`${c.text.length} > ${max}`);
   const middle=c.text.slice(head.length+1,c.text.length-'Ça t’intéresserait d’en parler ?'.length).trim();
   if(middle)assert.ok(OFFER.startsWith(middle.replace(/…$/,'').trim()),'what is left of the offer is its beginning, never a rewrite');
  }
 });
}
test('dropping whole sentences comes before shortening one: the first offer sentence stays whole when it fits',()=>{
 const first=OFFER.split(/(?<=[.!?])\s+/)[0];
 const c=compose({st:style({address_mode:'tu',max_chars:450})});
 assert.ok(c.text.includes(first),'first offer sentence kept whole');assert.ok(!c.text.includes('BIG permet'),'second sentence dropped');assert.ok(c.text.length<=450);
});
test('shortened offer sentence — cut on a word boundary with "…", never inside the quote',()=>{
 const c=compose({st:style({address_mode:'tu',max_chars:300})});
 assert.ok(c.text.length<=300);assert.match(c.text,/\p{L}… Ça t’intéresserait d’en parler \?$/u);assert.ok(c.text.includes(QUOTE));
});
test('quote close to the limit — the offer leaves, the quote stays',()=>{
 const long='La société accompagne depuis plus de trente ans les directions financières des groupes industriels et des entreprises de services dans la consolidation, le reporting et la planification budgétaire au quotidien';
 const c=compose({st:style({address_mode:'tu',max_chars:300}),excerpt:long});
 const q=`« ${long} »`;assert.ok(c.text.includes(q));assert.ok(c.text.length<=300,`${c.text.length}`);assert.ok(!c.text.includes('BIG'),'offer left out');
});
test('a quote that alone exceeds max_chars — explicit, documented behaviour: protected head + short question, over the limit, quote intact',()=>{
 const long='La société accompagne depuis plus de trente ans les directions financières des groupes industriels et des entreprises de services dans la consolidation, le reporting et la planification budgétaire';
 const c=compose({st:style({address_mode:'tu',max_chars:200}),excerpt:long});
 assert.equal(c.text,`Bonjour, j’ai remarqué ceci sur ton site : « ${long} ». Ça t’intéresserait d’en parler ?`);
 assert.ok(c.text.length>200,'over the limit by design: a verified quote is never cut');
});
test('a "why now" signal sentence is protected like the quote',()=>{
 const unbounded=compose({st:style({address_mode:'tu',max_chars:2000}),signals:[sig()]});
 const c=compose({st:style({address_mode:'tu',max_chars:400}),signals:[sig()]});
 assert.ok(unbounded.why_now&&c.text.includes(unbounded.why_now),'why-now sentence kept verbatim');
 assert.deepEqual(c.signal_ids,unbounded.signal_ids);assert.deepEqual(provenance(c),provenance(unbounded));
 assert.ok(c.text.length<=400||!c.text.includes('BIG'));
});
test('English — same strategy, English short question',()=>{
 const c=compose({st:style({max_chars:300}),locale:'en'});
 assert.ok(c.text.length<=300);assert.ok(c.text.endsWith('Open to a quick chat?'));assert.ok(c.text.includes(`“${EXCERPT.replace(/[.!?]+$/,'')}”`));
});
test('no style profile (legacy / demo) — exactly the previous text, even above 600',()=>{
 const legacy=compose({});
 assert.equal(legacy.text,core.generateOutreach('DIMO Software',OFFER,core.DEFAULT_CRITERIA,[ev()],NOW,'fr').text);
 assert.ok(legacy.text.length>600);
});
test('unrecognised structure — returned unchanged rather than sliced (fail-safe)',async()=>{
 const {fitToMaxChars}=await import('../src/outreach/compose.ts') as any;
 assert.equal(typeof fitToMaxChars,'function');
 assert.equal(fitToMaxChars('Texte libre sans la structure du modèle.'.repeat(30),{offer:OFFER,locale:'fr',address:'tu',maxChars:200}),'Texte libre sans la structure du modèle.'.repeat(30));
});
