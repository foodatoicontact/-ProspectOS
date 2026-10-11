// UNSUPPORTED_CLAIM made diagnosable. Canary #3 was refused by the company-fact rule, but nothing said which family of
// fact triggered it. The guard now names the family ({reason:'UNSUPPORTED_CLAIM',category}) and the composer propagates it
// as fallback_reason 'UNSUPPORTED_CLAIM_<CATEGORY>', which fits ai_outreach_usage.fallback_reason's CHECK ^[A-Z_]{1,60}$
// (migration 028): the next canary's audit row says which family it was. Only the reason and the family — never the
// message, a sentence, a fragment, the prompt, the offer, the evidence or the prospect. Decisions are strictly unchanged:
// a differential run against the frozen baseline (tests/fixtures/fact-guard-baseline-0b12975.ts) must show 0 change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as guard from '../src/outreach/fact-guard.ts';
import type {GuardContext} from '../src/outreach/fact-guard.ts';
const {checkComposedMessage}=guard;
import {checkComposedMessage as baselineCheck} from './fixtures/fact-guard-baseline-0b12975.ts';
import {composeWithAi} from '../src/outreach/ai-composer.ts';

const EXPECTED_CATEGORIES=['hiring','funding','growth','partnership','incident','contract','acquisition','appointment','launch','certification','event','revenue','publication'];
const OFFER='BIG aide les entreprises B2B à accélérer leur prospection commerciale avec des commerciaux freelances spécialisés. BIG permet de renforcer rapidement une équipe commerciale, externaliser la prospection, tester un nouveau marché et générer des rendez-vous qualifiés sans recruter immédiatement un SDR/BDR en interne.';
const SOURCES=['Enfin, la notation la plus élevée de la Banque de France (E1+), apporte un gage de rentabilité et de fiabilité de la société pour pérenniser la confiance de ses clients.','France','Notre approche et l’esprit « DIMO », séduisent petites et grandes entreprises de tous secteurs d’activité, en France comme à l’international.'];
const ctx=(o:Partial<GuardContext>={}):GuardContext=>({name:'DIMO Software',offer:OFFER,sources:SOURCES,allowedUrls:['https://www.dimosoftware.fr/'],forbiddenNames:[],bannedPhrases:['N’hésitez pas'],maxChars:600,angleType:'evidence',...o});

// ——— the list ———
test('categories — exactly one canonical name per company-fact family, in the guard’s own order',()=>{
 assert.deepEqual([...((guard as {CLAIM_CATEGORIES?:readonly string[]}).CLAIM_CATEGORIES??[])],EXPECTED_CATEGORIES);
});
test('categories — every propagated fallback reason fits the audit column CHECK ^[A-Z_]{1,60}$ (no migration needed)',()=>{
 const migration=readFileSync(new URL('../db/migrations/028_outreach_ai_generation.sql',import.meta.url),'utf8');
 const check=new RegExp(migration.match(/fallback_reason ~ '([^']+)'/)?.[1]??'(?!)');
 assert.equal(check.source,'^[A-Z_]{1,60}$');
 for(const c of EXPECTED_CATEGORIES)assert.match(`UNSUPPORTED_CLAIM_${c.toUpperCase()}`,check);
});

// ——— one representative per family → its category ———
const PER_FAMILY:[string,string][]=[
 ['hiring','DIMO Software recrute des commerciaux.'],
 ['funding','DIMO Software vient de boucler une levée de fonds.'],
 ['growth','Bravo pour ta forte croissance.'],
 ['partnership','J’ai vu ton nouveau partenariat.'],
 ['incident','Désolé pour la cyberattaque subie.'],
 ['contract','Félicitations pour ce contrat signé.'],
 ['acquisition','J’ai vu le rachat de ton concurrent.'],
 ['appointment','Félicitations pour ta nomination.'],
 ['launch','J’ai vu le lancement de ta nouvelle offre.'],
 ['certification','Bravo pour ta certification.'],
 ['event','On se croise au salon la semaine prochaine ?'],
 ['revenue','Ton chiffre d’affaires impressionne.'],
 ['publication','J’ai lu ton article sur la finance.'],
];
for(const [category,message] of PER_FAMILY){
 test(`family ${category} — refused as UNSUPPORTED_CLAIM with category ${category}`,()=>{
  assert.deepEqual(checkComposedMessage(message,ctx()),{ok:false,reason:'UNSUPPORTED_CLAIM',category});
 });
}
test('first offending sentence, then the first family in the guard’s order, decides the category (deterministic)',()=>{
 assert.deepEqual(checkComposedMessage('Bravo pour ta croissance et ton recrutement.',ctx()),{ok:false,reason:'UNSUPPORTED_CLAIM',category:'hiring'},'hiring precedes growth');
 assert.deepEqual(checkComposedMessage('Bonjour. Bravo pour ta croissance. Tu recrutes ?',ctx()),{ok:false,reason:'UNSUPPORTED_CLAIM',category:'growth'},'first sentence wins');
 assert.deepEqual(checkComposedMessage('Ton recrutement continue.',ctx({sources:['DIMO Software recrute.']})),{ok:true},'a sourced family is no claim');
});
test('the other refusals carry no category (unchanged shape)',()=>{
 assert.deepEqual(checkComposedMessage('',ctx()),{ok:false,reason:'EMPTY'});
 assert.deepEqual(checkComposedMessage('x'.repeat(601),ctx()),{ok:false,reason:'TOO_LONG'});
 assert.deepEqual(checkComposedMessage('N’hésitez pas à répondre.',ctx()),{ok:false,reason:'BANNED_PHRASE'});
 assert.deepEqual(checkComposedMessage('Tu as 42 clients.',ctx()),{ok:false,reason:'UNSUPPORTED_NUMBER'});
});

// ——— the recruter hypothesis: documented, NOT changed ———
test('hypothesis "recruter" — current decisions documented, none changed by this commit',()=>{
 const cases:[string,string][]=[
  ['unsourced prospect fact','DIMO recrute des commerciaux.'],
  ['about our own offer','ProspectOS peut t’aider à prospecter sans recruter immédiatement.'],
  ['ambiguous paraphrase of the offer','Tu pourrais renforcer ton équipe commerciale sans recruter de SDR.'],
 ];
 for(const [label,message] of cases){
  const now=checkComposedMessage(message,ctx()),before=baselineCheck(message,ctx());
  assert.deepEqual({ok:now.ok,reason:now.ok?null:now.reason},{ok:before.ok,reason:before.ok?null:before.reason},`${label}: decision unchanged`);
  assert.deepEqual(now,{ok:false,reason:'UNSUPPORTED_CLAIM',category:'hiring'},`${label}: current behaviour is a hiring refusal`);
 }
 const verbatim='BIG permet de renforcer rapidement une équipe commerciale, externaliser la prospection, tester un nouveau marché et générer des rendez-vous qualifiés sans recruter immédiatement un SDR/BDR en interne.';
 assert.deepEqual(checkComposedMessage(verbatim,ctx()),{ok:true},'a sentence copied from the offer is the offer speaking (unchanged exemption)');
});

// ——— propagation ———
test('propagation — the composer’s fallback_reason names the family; nothing else from the message is carried',async()=>{
 const message='Bonjour, j’ai vu que DIMO Software recrute des commerciaux. Est-ce qu’un court échange t’intéresserait ?';
 const input={name:'DIMO Software',offer:OFFER,locale:'fr' as const,angle:{type:'evidence',source_id:'e1',label:'l',reason:'VERIFIED_EVIDENCE',source_url:'https://www.dimosoftware.fr/',observed_at:'2026-10-06T00:00:00Z',excerpt:SOURCES[0]},
  sources:SOURCES,style:null as any,examples:[],fallback:{text:'Message de secours.',evidence_ids:['e1'],signal_ids:[],public_content_ids:[]}};
 const r=await composeWithAi(input as any,async()=>JSON.stringify({message}));
 assert.deepEqual(r,{text:'Message de secours.',evidence_ids:['e1'],signal_ids:[],public_content_ids:[],provider:'rule_based_v1',fallback_reason:'UNSUPPORTED_CLAIM_HIRING'});
 assert.ok(!JSON.stringify(r).includes('recrute des commerciaux'),'no fragment of the refused message');
});
test('propagation — the other fallback reasons are unchanged',async()=>{
 const input={name:'DIMO Software',offer:OFFER,locale:'fr' as const,angle:{type:'evidence',source_id:'e1',label:'l',reason:'r',source_url:'https://www.dimosoftware.fr/',observed_at:'2026-10-06T00:00:00Z',excerpt:SOURCES[0]},
  sources:SOURCES,style:null as any,examples:[],fallback:{text:'Secours.',evidence_ids:[],signal_ids:[],public_content_ids:[]}};
 const reason=async(raw:string)=>(await composeWithAi(input as any,async()=>raw)).fallback_reason;
 assert.equal(await reason('not json'),'INVALID_JSON');
 assert.equal(await reason(JSON.stringify({text:'x'})),'INVALID_SCHEMA');
 assert.equal(await reason(JSON.stringify({message:'Tu as 42 clients.'})),'UNSUPPORTED_NUMBER');
 assert.equal(await reason(JSON.stringify({message:'x'.repeat(5000)})),'TOO_LONG');
});

// ——— differential: frozen baseline vs current, 0 decision change ———
function corpus():{text:string;ctx:GuardContext}[]{
 const words=['recrute','recrutement','embauche','hiring','recruit','levée de fonds','a levé','financement','funding','raised','tour de table','croissance','growth','en plein essor','forte expansion',
  'partenariat','partenaire','partnership','partner','incident','cyberattaque','piratage','breach','attaque','ransomware','rançongiciel','contrat','marché public','appel d’offres','contract','tender',
  'rachat','acquisition','acquis','acquired','fusion','merger','nomination','nommé','appointed','nouveau directeur','new CEO','lancement','lance','launch','certification','certifié','certified',
  'salon','événement','webinar','conférence','chiffre d’affaires','revenue','CA de','publication','post','article','vous avez écrit','vous avez publié','you wrote','you posted',
  'logiciel','finance','clients','France','international','équipe','prospection','rendez-vous','confiance','rentabilité'];
 const frames=[(w:string)=>`J’ai vu : ${w}.`,(w:string)=>`DIMO Software et ${w}.`,(w:string)=>`Bonjour, ${w} chez toi ? Un court échange t’intéresserait ?`,(w:string)=>`Hello, about the ${w}.`,
  (w:string)=>`« ${w} »`,(w:string)=>`Bravo pour ${w} en 2026.`,(w:string)=>`BIG aide les entreprises B2B. ${w} https://www.dimosoftware.fr/`,(w:string)=>`Tu pourrais ${w} sans recruter.`];
 const fixed=['Bonjour, j’ai remarqué ceci sur ton site : « Enfin, la notation la plus élevée de la Banque de France (E1+), apporte un gage de rentabilité et de fiabilité de la société pour pérenniser la confiance de ses clients ». Est-ce qu’un court échange t’intéresserait ?',
  OFFER,'BIG permet de renforcer rapidement une équipe commerciale, externaliser la prospection, tester un nouveau marché et générer des rendez-vous qualifiés sans recruter immédiatement un SDR/BDR en interne.',
  'Tu as 2 500 clients dans 25 pays.','Visite https://evil.example/x','N’hésitez pas à me répondre.','Bonjour Société X.','','   ','x'.repeat(700),'« une citation inventée »','DIMO Software, E1+ et France.'];
 const contexts:GuardContext[]=[ctx(),ctx({angleType:'public_content_post'}),ctx({sources:[...SOURCES,'DIMO Software recrute, lève des fonds, signe un contrat et lance une offre.']}),
  ctx({forbiddenNames:['Société X'],maxChars:200}),ctx({name:'Recrutis',offer:'Nous aidons les équipes commerciales à prospecter.'}),ctx({sources:['DIMO Software accompagne 2 500 clients dans 25 pays.']}),
  ctx({angleType:'signal',sources:['DIMO Software est certifié ISO, présent au salon et annonce une acquisition.']})];
 const out:{text:string;ctx:GuardContext}[]=[];
 for(const c of contexts){for(const w of words)for(const f of frames)out.push({text:f(w),ctx:c});for(const t of fixed)out.push({text:t,ctx:c});
  for(let i=0;i<words.length;i++)out.push({text:`${frames[i%frames.length](words[i])} ${frames[(i+3)%frames.length](words[(i*7)%words.length])}`,ctx:c});}
 return out;
}
test('differential — frozen baseline vs current guard: 0 ACCEPT/REJECT change, same reason, on the whole corpus',()=>{
 const cases=corpus();let accept=0,reject=0;const seen=new Set<string>();
 for(const {text,ctx:c} of cases){
  const before=baselineCheck(text,c),now=checkComposedMessage(text,c);
  assert.equal(now.ok,before.ok,'ACCEPT/REJECT decision changed');
  if(!now.ok&&!before.ok){
   assert.equal(now.reason,before.reason,'refusal reason changed');
   if(now.reason==='UNSUPPORTED_CLAIM'){assert.ok(EXPECTED_CATEGORIES.includes((now as {category?:string}).category??''),'claim refusal always names a known family');seen.add((now as {category:string}).category)}
   else assert.equal((now as {category?:string}).category,undefined);
  }
  now.ok?accept++:reject++;
 }
 assert.ok(cases.length>=4000,`corpus size ${cases.length}`);
 assert.ok(accept>=300&&reject>=300,`both outcomes exercised (accept ${accept}, reject ${reject})`);
 assert.deepEqual([...seen].sort(),[...EXPECTED_CATEGORIES].sort(),'every family is exercised');
 console.log(JSON.stringify({differential:{cases:cases.length,accept,reject,decision_changes:0,categories_seen:seen.size}}));
});
