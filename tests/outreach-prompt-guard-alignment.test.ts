// Prompt ↔ fact guard alignment (offline: every model output below is simulated, no provider is called). Canaries #4/#5
// were refused as UNSUPPORTED_CLAIM_HIRING: the offer says "sans recruter immédiatement un SDR/BDR" and the model
// reworded it in a sentence addressed to the prospect. The composer's instructions now spell out the two spaces the
// guard enforces — facts about the company come from sources only, never from the offer; a capability of OUR offer that
// uses a controlled word is written with our brand / "nous" / "notre approche" as subject, an aide/permet/propose verb,
// the offer's own words, and no reference to the company or its reader after the verb — and, in doubt, the claim is
// left out. The prompt never asks to bypass the guard, and the guard is untouched: its decisions are compared to a frozen
// copy of b8ec44fd's guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildComposerRequest,composeWithAi} from '../src/outreach/ai-composer.ts';
import {checkComposedMessage} from '../src/outreach/fact-guard.ts';
import {readFileSync} from 'node:fs';

const OFFER='BIG aide les entreprises B2B à accélérer leur prospection commerciale. BIG permet de renforcer rapidement une équipe commerciale sans recruter immédiatement un SDR/BDR en interne.';
const SOURCES=['Enfin, la notation la plus élevée de la Banque de France (E1+), apporte un gage de rentabilité et de fiabilité de la société pour pérenniser la confiance de ses clients.'];
const input=(offer=OFFER)=>({name:'DIMO Software',offer,locale:'fr' as const,
 angle:{type:'evidence',source_id:'e1',label:'l',reason:'VERIFIED_EVIDENCE',source_url:'https://www.dimosoftware.fr/',observed_at:'2026-10-06T00:00:00Z',excerpt:SOURCES[0]},
 sources:SOURCES,style:{tone:'direct',address_mode:'tu',length:'short',max_chars:600,banned_phrases:['N’hésitez pas'],preferred_ctas:[],instructions:''} as any,examples:[],
 fallback:{text:'Message de secours.',evidence_ids:['e1'],signal_ids:[],public_content_ids:[]}});
const run=async(message:string,offer=OFFER)=>composeWithAi(input(offer) as any,async()=>JSON.stringify({message}));

// ——— the instructions ———
test('prompt — spells out the prospect-fact space: sources only, the offer never proves a company fact (all controlled families)',()=>{
 const {system}=buildComposerRequest(input() as any);
 assert.match(system,/offer ne prouve jamais un fait sur l’entreprise/);
 for(const w of ['recrutement','croissance','financement','partenariat','acquisition','lancement','chiffre d’affaires'])assert.ok(system.includes(w),w);
});
test('prompt — spells out how to write a capability of our offer that uses a controlled word',()=>{
 const {system}=buildComposerRequest(input() as any);
 assert.match(system,/sujet .*notre marque.*« nous ».*« notre approche »/);
 assert.match(system,/aide, permet ou propose/);
 assert.match(system,/mots exacts de offer/);
 assert.match(system,/aucune référence à l’entreprise ni à son interlocuteur après le verbe/);
 assert.match(system,/En cas de doute, n’écris pas cette affirmation/);
});
test('prompt — generic (no brand or prospect hardcoded) and never asks to bypass or weaken the guard',()=>{
 const {system}=buildComposerRequest(input() as any);
 assert.doesNotMatch(system,/\bBIG\b|DIMO|ProspectOS/);
 assert.doesNotMatch(system,/contourn|ignore|désactiv|bypass|affaibli/i);
 const other=buildComposerRequest({...input('Nous aidons les PME à se développer.'),name:'Kerlan'} as any).system;
 assert.equal(other,system,'the instructions do not depend on the brand, the offer or the prospect');
});

// ——— simulated outputs through the real composer + guard ———
const CASES:{label:string;message:string;offer?:string;expect:string|null}[]=[
 {label:'offer capability attributed to our brand (tu)',message:'Bonjour, j’ai vu ta notation E1+ de la Banque de France. BIG peut t’aider à renforcer rapidement une équipe commerciale sans recruter immédiatement un SDR/BDR en interne. Ça t’intéresserait d’en parler ?',expect:null},
 {label:'offer capability with "notre approche" (tu)',message:'Bonjour, j’ai vu ta notation E1+. Notre approche permet de renforcer rapidement une équipe commerciale sans recruter immédiatement un SDR/BDR en interne. On en parle ?',expect:null},
 {label:'verbatim offer sentence',message:'Bonjour. BIG permet de renforcer rapidement une équipe commerciale sans recruter immédiatement un SDR/BDR en interne. On en parle ?',expect:null},
 {label:'direct unsourced prospect fact',message:'Bonjour, DIMO recrute des commerciaux. On en parle ?',expect:'UNSUPPORTED_CLAIM_HIRING'},
 {label:'implicit prospect fact',message:'Bonjour, vu tes besoins, tu vas sûrement devoir recruter. On en parle ?',expect:'UNSUPPORTED_CLAIM_HIRING'},
 {label:'prospect fact + our brand in the same sentence',message:'Bonjour, BIG a vu que DIMO recrute des commerciaux. On en parle ?',expect:'UNSUPPORTED_CLAIM_HIRING'},
 {label:'mixed offer + prospect sentence (tu after the verb)',message:'Bonjour. BIG peut t’aider à renforcer ton équipe sans recruter immédiatement un SDR/BDR en interne. On en parle ?',expect:'UNSUPPORTED_CLAIM_HIRING'},
 {label:'growth on the prospect',message:'Bonjour, bravo pour ta croissance. On en parle ?',expect:'UNSUPPORTED_CLAIM_GROWTH'},
 {label:'growth as our capability',offer:'BIG aide à soutenir la croissance commerciale des PME.',message:'Bonjour. BIG peut t’aider à soutenir la croissance commerciale des PME. On en parle ?',expect:null},
 {label:'funding on the prospect',message:'Bonjour, félicitations pour ta levée de fonds. On en parle ?',expect:'UNSUPPORTED_CLAIM_FUNDING'},
 {label:'partnership on the prospect',message:'Bonjour, j’ai vu ton nouveau partenariat. On en parle ?',expect:'UNSUPPORTED_CLAIM_PARTNERSHIP'},
 {label:'partnership as our capability',offer:'BIG propose un partenariat commercial aux éditeurs de logiciels.',message:'Bonjour. Nous proposons un partenariat commercial aux éditeurs de logiciels. On en parle ?',expect:null},
 {label:'launch on the prospect',message:'Bonjour, j’ai vu le lancement de ta nouvelle offre. On en parle ?',expect:'UNSUPPORTED_CLAIM_LAUNCH'},
 {label:'revenue on the prospect',message:'Bonjour, ton chiffre d’affaires progresse bien. On en parle ?',expect:'UNSUPPORTED_CLAIM_REVENUE'},
 {label:'revenue as our capability',offer:'BIG aide à augmenter le chiffre d’affaires des équipes commerciales.',message:'Bonjour. BIG peut t’aider à augmenter le chiffre d’affaires des équipes commerciales. On en parle ?',expect:null},
];
for(const c of CASES){
 test(`simulated output — ${c.label} → ${c.expect??'AI text accepted'}`,async()=>{
  const r=await run(c.message,c.offer);
  if(c.expect===null){assert.equal(r.provider,'ai_composer_v1',JSON.stringify(r.fallback_reason));assert.equal(r.text,c.message)}
  else{assert.equal(r.provider,'rule_based_v1');assert.equal(r.fallback_reason,c.expect);assert.equal(r.text,'Message de secours.')}
 });
}
test('"DIMO recrute des commerciaux." stays refused without a source',()=>{
 const r=checkComposedMessage('DIMO recrute des commerciaux.',{name:'DIMO Software',offer:OFFER,sources:SOURCES,allowedUrls:[],forbiddenNames:[],bannedPhrases:[],maxChars:600,angleType:'evidence'});
 assert.deepEqual(r,{ok:false,reason:'UNSUPPORTED_CLAIM',category:'hiring'});
});
test('the fact guard is untouched by this block (byte-identical to b8ec44fd)',()=>{
 const now=readFileSync(new URL('../src/outreach/fact-guard.ts',import.meta.url),'utf8');
 const frozen=readFileSync(new URL('./fixtures/fact-guard-b8ec44fd.ts.txt',import.meta.url),'utf8');
 assert.equal(now,frozen,'src/outreach/fact-guard.ts changed: the prompt block must not change guard decisions');
});
