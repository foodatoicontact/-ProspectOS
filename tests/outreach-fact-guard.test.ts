// Outreach fact guard hardening, before any real AI canary. D1 — the offer (our own pitch) and the company's name never
// prove a fact about the prospect: a fact category (recruiting, funding, growth, partnership, launch…) must be found in
// the prospect's own sources. The offer may still be reproduced: a sentence copied from it is the offer speaking. D2 —
// numbers are exact tokens, never pieces of one another (27 is not 2027). A refused answer keeps the safe rule-based
// message, one unit for the attempt, the same provenance. Every case fails on its own (RED) until the guard is hardened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkComposedMessage,type GuardContext} from '../src/outreach/fact-guard.ts';
import {generateOutreachWithAi} from '../src/outreach/ai-generate.ts';

// An offer that talks about recruiting, growth, partners and launches — about OUR offer, never about the prospect.
const OFFER='BIG aide les entreprises B2B à accélérer leur prospection commerciale avec des commerciaux freelances spécialisés. BIG permet de renforcer rapidement une équipe commerciale et d’accompagner votre croissance, sans recruter immédiatement un SDR en interne. Nous sommes le partenaire commercial des éditeurs de logiciels, du lancement d’une nouvelle offre à la signature, en 48 h.';
const SOURCES=['DIMO Software édite des logiciels de gestion financière depuis 1987 et accompagne 2 500 clients dans 25 pays, avec une note de 4,5 sur 5.'];
const ctx=(o:Partial<GuardContext>={}):GuardContext=>({name:'DIMO Software',offer:OFFER,sources:SOURCES,allowedUrls:[],forbiddenNames:[],bannedPhrases:[],maxChars:2000,angleType:'evidence',...o});
const check=(text:string,o:Partial<GuardContext>={})=>checkComposedMessage(text,ctx(o));
const REFUSED_CLAIM={ok:false,reason:'UNSUPPORTED_CLAIM'};
const REFUSED_NUMBER={ok:false,reason:'UNSUPPORTED_NUMBER'};
const OFFER_SENTENCE='BIG permet de renforcer rapidement une équipe commerciale et d’accompagner votre croissance, sans recruter immédiatement un SDR en interne.';

// ——— D1 — offer and prospect facts, strictly apart ———
test('D1 — the reported case: an offer about recruiting never proves that DIMO Software recrute des commerciaux',()=>{
 assert.deepEqual(check('DIMO Software recrute des commerciaux.'),REFUSED_CLAIM);
 assert.deepEqual(check('Bonjour, DIMO Software recrute des commerciaux. BIG aide les entreprises B2B à accélérer leur prospection commerciale avec des commerciaux freelances spécialisés.'),REFUSED_CLAIM);
});

for(const [category,message] of [
 ['recruiting, the offer’s very expression','Bonjour, DIMO Software cherche à recruter immédiatement un SDR en interne.'],
 ['growth, the offer’s very expression','Bravo pour votre croissance, DIMO Software.'],
 ['partnership, the offer’s very expression','DIMO Software est le partenaire commercial des éditeurs de logiciels.'],
 ['launch, the offer’s very expression','J’ai vu le lancement d’une nouvelle offre chez DIMO Software.'],
])test(`D1 — ${category}: in the offer, absent from the prospect’s sources → refused`,()=>{
 assert.deepEqual(check(message),REFUSED_CLAIM);
});

test('D1 — the company’s own name proves nothing either (a name that contains a fact word)',()=>{
 const o={name:'Recrutis',offer:'Nous aidons les équipes commerciales à prospecter.'};
 assert.deepEqual(check('Recrutis recrute des commerciaux.',o),REFUSED_CLAIM);
 assert.deepEqual(check('Recrutis recrute des commerciaux.',{...o,sources:['Recrutis édite un logiciel de paie.']}),REFUSED_CLAIM,'nor does the name inside a source');
 assert.deepEqual(check('Recrutis recrute des commerciaux.',{...o,sources:['Recrutis recrute des commerciaux à Nantes.']}),{ok:true},'a source that states it does');
 assert.deepEqual(check('Bonjour l’équipe Recrutis, nous aidons les équipes commerciales à prospecter.',o),{ok:true},'naming the company is no claim');
});

test('D1 — still accepted: a sentence copied from the offer, a fact the prospect’s sources state, a publication on a public-content angle, a paraphrase without a fact word',()=>{
 assert.deepEqual(check(`Bonjour, j’ai remarqué que DIMO Software édite des logiciels de gestion financière depuis 1987. ${OFFER_SENTENCE}`),{ok:true});
 assert.deepEqual(check(`Bonjour, DIMO Software recrute des développeurs à Lyon. ${OFFER_SENTENCE}`,{sources:['DIMO Software recrute des développeurs à Lyon.']}),{ok:true});
 assert.deepEqual(check('Bonjour, j’ai lu ta publication sur la gestion financière.',{angleType:'public_content_pinned'}),{ok:true});
 assert.deepEqual(check('Bonjour, BIG met à ta disposition des commerciaux freelances spécialisés sur ton marché.'),{ok:true});
});

test('D1 — fail-closed boundary: a paraphrase of the offer that carries a fact word is refused (whose fact it is cannot be told); the copied sentence is accepted',()=>{
 assert.deepEqual(check('BIG t’aide à renforcer ton équipe sans recruter de SDR.'),REFUSED_CLAIM);
 assert.deepEqual(check(OFFER_SENTENCE),{ok:true});
});

// ——— D2 — exact numbers ———
test('D2 — 27 is not 2027, nor 202, nor 7: a number is sourced only as a whole token',()=>{
 const s={sources:['DIMO Software ouvrira un bureau à Lyon en 2027.']};
 for(const n of ['27','202','7','20'])assert.deepEqual(check(`DIMO Software, depuis ${n} ans au service de ses clients.`,s),REFUSED_NUMBER,n);
 assert.deepEqual(check('DIMO Software ouvrira un bureau à Lyon en 2027.',s),{ok:true});
});

test('D2 — the other way round: 2027 is not sourced by 27',()=>{
 assert.deepEqual(check('DIMO Software ouvrira un bureau en 2027.',{sources:['DIMO Software compte 27 consultants.']}),REFUSED_NUMBER);
});

test('D2 — numbers next to each other in a source are never glued together (1987, 2027 ≠ 8720 / 19872027)',()=>{
 const s={sources:['Dates clés de DIMO Software : 1987, 2027.']};
 for(const n of ['8720','19872027','872'])assert.deepEqual(check(`DIMO Software : ${n}.`,s),REFUSED_NUMBER,n);
 assert.deepEqual(check('Dates clés de DIMO Software : 1987, 2027.',s),{ok:true},'both years, each one sourced');
});

test('D2 — real sourced numbers keep passing, whatever their formatting (spaces, no-break spaces, decimal comma or dot), and the offer’s own',()=>{
 for(const text of ['DIMO Software accompagne 2 500 clients.','DIMO Software accompagne 2500 clients.','DIMO Software accompagne 2 500 clients.','DIMO Software accompagne 2 500 clients.',
  'Clients dans 25 pays depuis 1987.','Une note de 4,5 sur 5.','Une note de 4.5 sur 5.',`${OFFER_SENTENCE} Réponse en 48 h.`,'BIG aide les entreprises B2B.'])
  assert.deepEqual(check(text),{ok:true},text);
 assert.deepEqual(check('Une note de 4,6 sur 5.'),REFUSED_NUMBER,'a neighbouring decimal is not the sourced one');
});

// ——— The attempt around a refusal: safe fallback, one unit, provenance unchanged ———
const composed={text:'Bonjour l’équipe DIMO Software, j’ai remarqué ceci sur votre site : « DIMO Software édite des logiciels de gestion financière depuis 1987 ». BIG aide les entreprises B2B à accélérer leur prospection commerciale avec des commerciaux freelances spécialisés. Seriez-vous ouvert à un court échange ?',
 evidence_ids:['e1','e2'],signal_ids:[],public_content_ids:[],provider:'rule_based_v1' as const,why_now:null,
 angle:{type:'evidence' as const,source_id:'e1',label:'DIMO Software édite des logiciels de gestion financière',reason:'VERIFIED_EVIDENCE',source_url:'https://dimo.example/a-propos',observed_at:'2026-10-05T12:00:00Z',excerpt:SOURCES[0]}};
function attempt(message:string){
 const log:string[]=[];
 const deps={userId:'me',availability:async()=>({ok:true as const,apiKeyOverride:null,billingSource:'PLATFORM' as const}),
  reserve:async()=>{log.push('reserve');return 'u1'},loadExampleRows:async()=>[],
  call:async()=>({text:JSON.stringify({message}),usage:{provider:'anthropic' as const,model:'m',input_tokens:120,output_tokens:40}}),
  meter:async()=>{log.push('meter')}};
 return generateOutreachWithAi({composed,name:'DIMO Software',offer:OFFER,locale:'fr',style:null,sources:SOURCES,userId:'me'},deps).then(r=>({r,log}));
}
for(const [name,message,reason] of [
 ['D1 claim','Bonjour, DIMO Software recrute des commerciaux. BIG aide les entreprises B2B à accélérer leur prospection commerciale avec des commerciaux freelances spécialisés.','UNSUPPORTED_CLAIM'],
 ['D2 number (250, a piece of the sourced 2 500)','Bonjour, DIMO Software accompagne 250 clients. BIG aide les entreprises B2B à accélérer leur prospection commerciale avec des commerciaux freelances spécialisés.','UNSUPPORTED_NUMBER'],
])test(`fallback — a refused AI answer (${name}) → the safe rule-based message, exactly 1 unit, the same provenance`,async()=>{
 const {r,log}=await attempt(message);
 assert.equal(r.provider,'rule_based_fallback_v1');assert.equal(r.text,composed.text,'the rule-based message, unchanged');
 assert.equal(r.outcome,'FALLBACK');assert.equal(r.fallback_reason,reason);assert.equal(r.attempted,true);assert.equal(r.usage_id,'u1');
 assert.deepEqual(log,['reserve','meter'],'one unit for the attempt and its fallback, the billed answer metered once');
 assert.deepEqual([r.evidence_ids,r.signal_ids,r.public_content_ids],[composed.evidence_ids,composed.signal_ids,composed.public_content_ids]);
});

test('fallback — a valid answer (copied offer sentence, sourced fact and number) stays the AI text, 1 unit, the same provenance',async()=>{
 const message=`Bonjour, j’ai remarqué que DIMO Software édite des logiciels de gestion financière depuis 1987. ${OFFER_SENTENCE}`;
 const {r,log}=await attempt(message);
 assert.equal(r.provider,'ai_composer_v1',JSON.stringify(r));assert.equal(r.text,message);assert.equal(r.outcome,'AI_VALID');
 assert.deepEqual(log,['reserve','meter']);
 assert.deepEqual([r.evidence_ids,r.signal_ids,r.public_content_ids],[composed.evidence_ids,composed.signal_ids,composed.public_content_ids]);
});
