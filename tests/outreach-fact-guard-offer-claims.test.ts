// Offer vs prospect semantics in the company-fact rule. Canary #4 was refused as UNSUPPORTED_CLAIM_HIRING while the offer
// itself says "sans recruter immédiatement un SDR/BDR" and DIMO's sources say nothing about hiring. A fact word that comes
// from OUR offer may stand in a sentence that clearly speaks about our solution; the offer still never proves a fact about
// the prospect. A sentence is offer-attributed only if ALL hold (deterministic, bounded):
//  (a) it starts with an offer subject — the brand read from the offer, "nous", "notre approche/solution/offre/…",
//      "we", "our …" — then a capability verb (aide/permet/propose, help/let/enable/offer), modal and you-pronoun allowed;
//  (b) after that prefix it names nobody on the prospect side: no tu/toi/ton/ta/tes/te/vous/votre/vos/you/your…, nor the
//      prospect's name;
//  (c) every occurrence of the fact family lies inside a run of ≥ 3 consecutive words copied verbatim from the offer.
// Otherwise nothing changes. No family is exempted globally; the diagnostic category is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkComposedMessage,type GuardContext} from '../src/outreach/fact-guard.ts';
import {checkComposedMessage as baselineCheck} from './fixtures/fact-guard-baseline-0b12975.ts';

const DIMO_SOURCES=['Enfin, la notation la plus élevée de la Banque de France (E1+), apporte un gage de rentabilité et de fiabilité de la société pour pérenniser la confiance de ses clients.','France','Notre approche et l’esprit « DIMO », séduisent petites et grandes entreprises de tous secteurs d’activité, en France comme à l’international.'];
const ctxFor=(offer:string,o:Partial<GuardContext>={}):GuardContext=>({name:'DIMO Software',offer,sources:DIMO_SOURCES,allowedUrls:[],forbiddenNames:[],bannedPhrases:[],maxChars:600,angleType:'evidence',...o});
const ACCEPT={ok:true};
const refused=(category:string)=>({ok:false,reason:'UNSUPPORTED_CLAIM',category});

// ——— the mandatory cases ———
const HIRING_OFFER='ProspectOS aide à prospecter sans recruter immédiatement un SDR/BDR.';
for(const message of ['ProspectOS peut t’aider à prospecter sans recruter immédiatement.','Notre approche permet de prospecter sans recruter immédiatement un SDR.']){
 test(`offer claim accepted — "${message}"`,()=>{
  assert.deepEqual(checkComposedMessage(message,ctxFor(HIRING_OFFER)),ACCEPT);
  assert.deepEqual(baselineCheck(message,ctxFor(HIRING_OFFER)).ok,false,'was refused before (this is the fixed false positive)');
 });
}
for(const message of ['DIMO recrute des commerciaux.','Tu recrutes actuellement des SDR.','Votre équipe recrute.','Avec votre croissance, vous allez devoir recruter.','Vous cherchez probablement à recruter.']){
 test(`prospect claim still refused — "${message}"`,()=>{
  const r=checkComposedMessage(message,ctxFor(HIRING_OFFER));
  assert.equal(r.ok,false);assert.equal((r as {reason:string}).reason,'UNSUPPORTED_CLAIM');
 });
}

// ——— adversarial: one offer per family, an accepted offer claim and its refused prospect neighbours ———
const FAMILIES:{family:string;offer:string;accepted:string[];refused:string[]}[]=[
 {family:'hiring',offer:HIRING_OFFER,
  accepted:['ProspectOS te permet de prospecter sans recruter immédiatement un SDR.','Nous aidons à prospecter sans recruter immédiatement un SDR/BDR.'],
  refused:['DIMO Software recrute des SDR.','ProspectOS a vu que DIMO recrute.','ProspectOS aide DIMO Software à prospecter sans recruter immédiatement.','Notre solution est idéale puisque tu recrutes.',
   'Notre solution aide les équipes qui recrutent.','ProspectOS aide à prospecter sans recruter immédiatement, et tu recrutes déjà.','ProspectOS aide à prospecter sans recruter immédiatement, comme ton équipe.',
   'Tu pourrais prospecter sans recruter immédiatement.','Prospecter sans recruter immédiatement, c’est possible.','Sans recruter immédiatement, ProspectOS aide à prospecter.',
   'ProspectOS permet de recruter des SDR.','BIG aide à prospecter sans recruter immédiatement.','ProspectOS aide à prospecter sans recruter immédiatement car DIMO recrute.']},
 {family:'growth',offer:'ProspectOS aide à soutenir la croissance commerciale des PME.',
  accepted:['ProspectOS peut t’aider à soutenir la croissance commerciale des PME.'],
  refused:['Bravo pour ta croissance commerciale.','ProspectOS aide à soutenir ta croissance commerciale.','Avec ta croissance, ProspectOS aide les PME.','ProspectOS aide à soutenir la croissance commerciale de DIMO Software.']},
 {family:'funding',offer:'ProspectOS permet de prospecter sans levée de fonds préalable.',
  accepted:['ProspectOS te permet de prospecter sans levée de fonds préalable.'],
  refused:['DIMO vient de faire une levée de fonds.','ProspectOS te permet de prospecter après ta levée de fonds.','Notre offre permet de prospecter grâce à votre levée de fonds.']},
 {family:'partnership',offer:'ProspectOS propose un partenariat commercial aux éditeurs de logiciels.',
  accepted:['Nous proposons un partenariat commercial aux éditeurs de logiciels.'],
  refused:['J’ai vu ton nouveau partenariat commercial.','ProspectOS propose un partenariat commercial comme celui que tu as signé.','DIMO Software a signé un partenariat commercial.']},
 {family:'launch',offer:'ProspectOS aide au lancement de nouvelles offres commerciales.',
  accepted:['ProspectOS peut t’aider au lancement de nouvelles offres commerciales.'],
  refused:['J’ai vu le lancement de ta nouvelle offre.','ProspectOS aide au lancement de nouvelles offres commerciales, comme celle de DIMO Software.','Notre solution aide au lancement de ton offre.']},
 {family:'revenue',offer:'ProspectOS aide à augmenter le chiffre d’affaires des équipes commerciales.',
  accepted:['Notre solution aide à augmenter le chiffre d’affaires des équipes commerciales.'],
  refused:['Ton chiffre d’affaires progresse.','ProspectOS aide à augmenter ton chiffre d’affaires.','Vu votre chiffre d’affaires, ProspectOS aide les équipes commerciales.']},
];
for(const {family,offer,accepted,refused:refusedMessages} of FAMILIES){
 for(const message of accepted)test(`${family} — offer claim accepted: "${message}"`,()=>{
  assert.deepEqual(checkComposedMessage(message,ctxFor(offer)),ACCEPT);
 });
 for(const message of refusedMessages)test(`${family} — prospect / ambiguous / mixed claim refused: "${message}"`,()=>{
  const r=checkComposedMessage(message,ctxFor(offer));
  assert.equal(r.ok,false);assert.equal((r as {reason:string}).reason,'UNSUPPORTED_CLAIM');
 });
}

test('an offer phrase reused with a prospect attribution stays refused',()=>{
 const offer='ProspectOS aide les entreprises qui recrutent des commerciaux.';
 assert.deepEqual(checkComposedMessage('ProspectOS aide les entreprises qui recrutent des commerciaux.',ctxFor(offer)),ACCEPT,'the copied offer sentence (existing exemption)');
 for(const m of ['ProspectOS aide les entreprises qui recrutent des commerciaux comme toi.','ProspectOS aide les entreprises qui recrutent des commerciaux comme DIMO Software.','ProspectOS aide les entreprises qui recrutent des commerciaux, comme la tienne.'])
  assert.deepEqual(checkComposedMessage(m,ctxFor(offer)),refused('hiring'),m);
});
test('a partial prospect name (a distinctive word of it) is a prospect-side reference too',()=>{
 for(const m of ['ProspectOS aide à prospecter sans recruter immédiatement, comme chez DIMO.','Notre approche permet de prospecter sans recruter immédiatement un SDR pour Dimo.'])
  assert.deepEqual(checkComposedMessage(m,ctxFor(HIRING_OFFER)),refused('hiring'),m);
 assert.deepEqual(checkComposedMessage('ProspectOS aide à prospecter sans recruter immédiatement un SDR/BDR pour les éditeurs de software.',ctxFor(HIRING_OFFER)),ACCEPT,'a generic word of the name (software) is not a reference');
});
test('the canary #4 offer — an offer-attributed paraphrase now passes, the prospect version does not',()=>{
 const offer='BIG aide les entreprises B2B à accélérer leur prospection commerciale en leur donnant accès à des commerciaux freelances spécialisés sur leur marché. BIG permet de renforcer rapidement une équipe commerciale, externaliser la prospection, tester un nouveau marché et générer des rendez-vous qualifiés sans recruter immédiatement un SDR/BDR en interne.';
 assert.deepEqual(checkComposedMessage('BIG te permet de renforcer rapidement une équipe commerciale sans recruter immédiatement un SDR/BDR en interne.',ctxFor(offer)),ACCEPT);
 assert.deepEqual(checkComposedMessage('BIG t’aide à renforcer ton équipe sans recruter de SDR.',ctxFor(offer)),refused('hiring'),'ton équipe + words not copied from the offer');
 assert.deepEqual(checkComposedMessage('DIMO Software recrute un SDR/BDR en interne.',ctxFor(offer)),refused('hiring'));
});
test('sources still prove a prospect fact exactly as before; the offer never does',()=>{
 assert.deepEqual(checkComposedMessage('DIMO Software recrute des SDR.',ctxFor(HIRING_OFFER,{sources:['DIMO Software recrute des SDR à Lyon.']})),ACCEPT);
 assert.deepEqual(checkComposedMessage('DIMO Software recrute toujours des SDR.',ctxFor('DIMO Software recrute des SDR. ProspectOS aide à prospecter.')),refused('hiring'),'an offer that talks about the prospect proves nothing (no offer subject)');
});

// ——— differential: frozen baseline (0b12975) vs current, on an offer-vs-prospect corpus ———
// Every REJECT → ACCEPT must be (1) in the frozen list below, (2) an offer claim: starts with this offer's subject + a
// capability verb, no prospect-side word, (3) justified by the offer: it carries the offer's own anchor phrase for that
// family, (4) paired with neighbours — the same words attributed to the prospect — that stay refused. No ACCEPT → REJECT.
const DIFF_OFFERS:{offer:string;brand:string;anchors:string[]}[]=[
 {offer:HIRING_OFFER,brand:'ProspectOS',anchors:['prospecter sans recruter immédiatement','sans recruter immédiatement un SDR']},
 ...FAMILIES.slice(1).map(f=>({offer:f.offer,brand:'ProspectOS',anchors:[f.offer.replace(/^ProspectOS (aide|permet|propose) /,'').replace(/\.$/,'')]})),
 {offer:'BIG permet de renforcer rapidement une équipe commerciale, externaliser la prospection, tester un nouveau marché et générer des rendez-vous qualifiés sans recruter immédiatement un SDR/BDR en interne.',brand:'BIG',anchors:['sans recruter immédiatement un SDR/BDR en interne']},
];
const SUBJECTS=(brand:string)=>[`${brand} aide`,`${brand} peut t’aider`,`${brand} te permet`,`${brand} vous aide`,'Notre approche permet','Notre solution aide','Nous aidons','Nous proposons',
 'DIMO Software','Tu','Votre équipe','Ton entreprise','On voit que DIMO','Bravo,',`${brand} a vu que`,'Avec ta croissance,','Sans doute'];
const SUFFIXES=['',' comme toi',' comme DIMO Software',' et tu recrutes déjà',', bravo pour ta croissance',' car DIMO lance une offre',' pour ton équipe',' aux entreprises'];
function differentialCorpus(){
 const out:{text:string;offer:string;brand:string;anchors:string[];subject:string}[]=[];
 for(const o of DIFF_OFFERS){
  const middles=[...o.anchors,...o.anchors.map(a=>a.split(' ').slice(0,2).join(' ')),...o.anchors.map(a=>a.split(' ').slice(-2).join(' ')),'à prospecter','à recruter des SDR','à lever des fonds','à signer un partenariat','à lancer une offre','à augmenter le chiffre d’affaires'];
  for(const subject of SUBJECTS(o.brand))for(const middle of middles)for(const suffix of SUFFIXES){
   const glue=/^(à|de|au|sans|un|la|le)\b/.test(middle)||/,$/.test(subject)?' ':' à ';
   out.push({text:`${subject}${glue}${middle}${suffix}.`.replace(/\s+/g,' '),offer:o.offer,brand:o.brand,anchors:o.anchors,subject});
  }
 }
 return out;
}
const fold2=(x:string)=>x.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’‘]/g,"'").toLowerCase();
const isOfferSubject=(subject:string,brand:string)=>[`${brand} aide`,`${brand} peut t’aider`,`${brand} te permet`,`${brand} vous aide`,'Notre approche permet','Notre solution aide','Nous aidons','Nous proposons'].includes(subject);
const PROSPECT_WORDS=/\b(tu|toi|ton|ta|tes|vous|votre|vos|dimo)\b/;
test('differential — offer-vs-prospect corpus: no ACCEPT → REJECT; every REJECT → ACCEPT listed, offer-attributed, offer-justified, with refused prospect neighbours',async()=>{
 const {readFileSync}=await import('node:fs');
 const expected:string[]=JSON.parse(readFileSync(new URL('./fixtures/fact-guard-offer-claims-flips.json',import.meta.url),'utf8'));
 const flips:string[]=[];let total=0,acceptToReject=0,unchangedAccept=0,unchangedReject=0;
 for(const c of differentialCorpus()){
  total++;const ctx=ctxFor(c.offer),before=baselineCheck(c.text,ctx).ok,now=checkComposedMessage(c.text,ctx).ok;
  if(before&&!now)acceptToReject++;
  else if(!before&&now){
   flips.push(`${c.brand} | ${c.text}`);
   assert.ok(isOfferSubject(c.subject,c.brand),`(2) offer subject: ${c.text}`);
   const after=fold2(c.text).slice(fold2(c.subject).length);
   assert.ok(!PROSPECT_WORDS.test(after),`(2) no prospect-side word after the offer subject: ${c.text}`);
   const windows=c.anchors.flatMap(a=>{const w=fold2(a).split(' ');return w.slice(0,-2).map((_,i)=>w.slice(i,i+3).join(' '))});
   assert.ok(windows.some(x=>after.includes(x)),`(3) carries ≥ 3 consecutive words of the offer's own phrase after the subject: ${c.text}`);
   for(const neighbour of ['DIMO Software','Tu','Votre équipe']){
    const t=c.text.replace(c.subject,neighbour);
    assert.equal(checkComposedMessage(t,ctx).ok,false,`(4) prospect neighbour stays refused: ${t}`);
   }
  }else if(now)unchangedAccept++;else unchangedReject++;
 }
 console.log(JSON.stringify({offer_vs_prospect_differential:{cases:total,unchanged_accept:unchangedAccept,unchanged_reject:unchangedReject,reject_to_accept:flips.length,accept_to_reject:acceptToReject}}));
 assert.equal(acceptToReject,0,'no ACCEPT → REJECT');
 assert.deepEqual(flips,expected,'(1) every REJECT → ACCEPT is in the frozen, reviewed list');
});
