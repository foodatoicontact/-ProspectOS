// O1 — address_mode 'tu' in the rule-based message (French only). The sentences ProspectOS writes itself address one
// person, tutoyée: « Bonjour, j’ai remarqué ceci sur ton site : « … ». … Est-ce qu’un court échange t’intéresserait ? »,
// and the angle sentence « j’ai lu cette publication / j’ai vu cette actualité récente concernant ton entreprise : « … » ».
// Quotes are the source's own words and are never touched (a « vous » inside one stays), nor are the offer, the facts,
// the provenance or the selected angle. 'vous' and 'auto' keep today's text to the character (pinned below), English
// never changes. The greeting is one shared definition, so the angle sentence can never be dropped by a greeting it does
// not recognise. Each case fails on its own (RED) until the change exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {composeRuleBased} from '../src/outreach/compose.ts';
import * as core from '../src/domain/core.ts';
import * as whyNowModule from '../src/domain/why-now.ts';
import {DEFAULT_STYLE_PROFILE,type StyleProfile} from '../src/outreach/style.ts';
import type {IntentSignal} from '../src/domain/intent.ts';

const src=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const NOW=new Date('2026-10-10T12:00:00Z');
const day=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
const OFFER='BIG aide les entreprises B2B à accélérer leur prospection commerciale.';
// Every quote is written with vous / votre / vos on purpose: it is the source's own text and must stay as it is.
const EXCERPT='Nous vous accompagnons depuis 1987 : votre réussite et vos projets sont notre priorité';
const PC_TEXT='Merci à vous tous pour votre confiance : nous ouvrons un atelier à Vannes en 2027.';
const SIG_TEXT='Vous voulez rejoindre Kerlan ? Nous recrutons un RSSI pour sécuriser vos sites.';
const ev=(o:Partial<core.Evidence>={}):core.Evidence=>({id:'e1',criterion:'need_fit',value:true,status:'VERIFIED',source_url:'https://kerlan.example/a-propos',excerpt:EXCERPT,observed_at:day(5),verified_by:'u1',...o});
const pc=(o:Record<string,unknown>={})=>({id:'pc1',status:'VERIFIED',pinned:false,source_type:'user_provided',source_url:'https://www.linkedin.com/posts/kerlan-123',author:'Kerlan',
 content:PC_TEXT,published_at:day(3),observed_at:day(2),...o});
const sig=(o:Partial<IntentSignal>={}):IntentSignal=>({id:'s1',signal_type:'hiring_role',status:'VERIFIED',title:'Kerlan recrute un RSSI',excerpt:SIG_TEXT,
 source_url:'https://jobs.example/kerlan',source_domain:'jobs.example',confidence:0.8,event_date:null,published_at:day(4),observed_at:day(1),matched_terms:[],...o} as IntentSignal);
const PROFILE={types:{hiring_role:25},terms:[]};
const style=(o:Partial<StyleProfile>={}):StyleProfile=>({...DEFAULT_STYLE_PROFILE,...o});
const TU=style({address_mode:'tu'});

type Scenario={evidence:core.Evidence[];signals:IntentSignal[];publicContent:any[];offer?:string};
const SCENARIOS:Record<string,Scenario>={
 evidence:{evidence:[ev()],signals:[],publicContent:[]},
 generic:{evidence:[],signals:[],publicContent:[]},
 generic_no_offer:{evidence:[],signals:[],publicContent:[],offer:''},
 public_content_pinned:{evidence:[ev()],signals:[],publicContent:[pc({pinned:true})]},
 public_content:{evidence:[ev()],signals:[],publicContent:[pc()]},
 signal:{evidence:[ev()],signals:[sig()],publicContent:[]},
};
const compose=(s:Scenario,locale:'fr'|'en',st?:StyleProfile)=>composeRuleBased({name:'Kerlan',offer:OFFER,criteria:core.DEFAULT_CRITERIA,profile:PROFILE,now:NOW,...s,locale,style:st});

// What ProspectOS writes for each angle when address_mode = 'tu' (the wording validated for O1).
const QUOTE_EV='« Nous vous accompagnons depuis 1987 : votre réussite et vos projets sont notre priorité »';
const QUOTE_PC='« Merci à vous tous pour votre confiance : nous ouvrons un atelier à Vannes en 2027 » (www.linkedin.com, 7 octobre 2026)';
const QUOTE_SIG='« Vous voulez rejoindre Kerlan ? Nous recrutons un RSSI pour sécuriser vos sites » (jobs.example, 6 octobre 2026)';
const CTA_TU='Est-ce qu’un court échange t’intéresserait ?';
const EXPECTED_TU:Record<string,string>={
 evidence:`Bonjour, j’ai remarqué ceci sur ton site : ${QUOTE_EV}. ${OFFER} ${CTA_TU}`,
 generic:`Bonjour, je t’écris au sujet de ton activité. ${OFFER} ${CTA_TU}`,
 generic_no_offer:`Bonjour, je t’écris au sujet de ton activité. Je souhaite te présenter notre offre et vérifier si elle correspond à tes besoins. ${CTA_TU}`,
 public_content_pinned:`Bonjour, j’ai lu cette publication concernant ton entreprise : ${QUOTE_PC}. J’ai remarqué ceci sur ton site : ${QUOTE_EV}. ${OFFER} ${CTA_TU}`,
 public_content:`Bonjour, j’ai lu cette publication concernant ton entreprise : ${QUOTE_PC}. J’ai remarqué ceci sur ton site : ${QUOTE_EV}. ${OFFER} ${CTA_TU}`,
 signal:`Bonjour, j’ai vu cette actualité récente concernant ton entreprise : ${QUOTE_SIG}. J’ai remarqué ceci sur ton site : ${QUOTE_EV}. ${OFFER} ${CTA_TU}`,
};
// Today's text, captured from the code before the change: 'vous', 'auto' and no profile must keep it to the character.
const CTA_VOUS='Seriez-vous ouvert à un court échange ?';
const BASELINE_FR:Record<string,string>={
 evidence:`Bonjour l’équipe Kerlan, j’ai remarqué ceci sur votre site : ${QUOTE_EV}. ${OFFER} ${CTA_VOUS}`,
 generic:`Bonjour l’équipe Kerlan, je vous écris au sujet de votre activité. ${OFFER} ${CTA_VOUS}`,
 generic_no_offer:`Bonjour l’équipe Kerlan, je vous écris au sujet de votre activité. Je souhaite vous présenter notre offre et vérifier si elle correspond à vos besoins. ${CTA_VOUS}`,
 public_content_pinned:`Bonjour l’équipe Kerlan, j’ai lu cette publication vous concernant : ${QUOTE_PC}. J’ai remarqué ceci sur votre site : ${QUOTE_EV}. ${OFFER} ${CTA_VOUS}`,
 public_content:`Bonjour l’équipe Kerlan, j’ai lu cette publication vous concernant : ${QUOTE_PC}. J’ai remarqué ceci sur votre site : ${QUOTE_EV}. ${OFFER} ${CTA_VOUS}`,
 signal:`Bonjour l’équipe Kerlan, j’ai vu cette actualité récente vous concernant : ${QUOTE_SIG}. J’ai remarqué ceci sur votre site : ${QUOTE_EV}. ${OFFER} ${CTA_VOUS}`,
};
const EN_QUOTE_EV='“Nous vous accompagnons depuis 1987 : votre réussite et vos projets sont notre priorité”';
const EN_CTA='Would you be open to a short conversation?';
const BASELINE_EN:Record<string,string>={
 evidence:`Hello Kerlan team, I noticed this on your website: ${EN_QUOTE_EV}. ${OFFER} ${EN_CTA}`,
 generic:`Hello Kerlan team, I’m reaching out about your business. ${OFFER} ${EN_CTA}`,
 generic_no_offer:`Hello Kerlan team, I’m reaching out about your business. I’d like to introduce our offer and check whether it fits your needs. ${EN_CTA}`,
 public_content_pinned:`Hello Kerlan team, I read this publication about you: “Merci à vous tous pour votre confiance : nous ouvrons un atelier à Vannes en 2027” (www.linkedin.com, 7 October 2026). I noticed this on your website: ${EN_QUOTE_EV}. ${OFFER} ${EN_CTA}`,
 public_content:`Hello Kerlan team, I read this publication about you: “Merci à vous tous pour votre confiance : nous ouvrons un atelier à Vannes en 2027” (www.linkedin.com, 7 October 2026). I noticed this on your website: ${EN_QUOTE_EV}. ${OFFER} ${EN_CTA}`,
 signal:`Hello Kerlan team, I saw this recent news about you: “Vous voulez rejoindre Kerlan ? Nous recrutons un RSSI pour sécuriser vos sites” (jobs.example, 6 October 2026). I noticed this on your website: ${EN_QUOTE_EV}. ${OFFER} ${EN_CTA}`,
};

const quotes=(t:string)=>t.match(/«[^»]*»( \([^)]*\))?/g)??[];
// ProspectOS's own words: the text without its quotes and without the user's offer.
const ownWords=(t:string,offer=OFFER)=>t.replace(/«[^»]*»/g,'«»').split(offer).join('');
const VOUS=/(^|[^\p{L}])(vous|votre|vos)(?![\p{L}])/iu;

for(const [name,s] of Object.entries(SCENARIOS))test(`A — tu, ${name}: individual tutoiement, nothing else changes (angle, provenance, quotes)`,()=>{
 const tu=compose(s,'fr',TU),vous=compose(s,'fr');
 assert.equal(tu.text,EXPECTED_TU[name]);
 assert.doesNotMatch(ownWords(tu.text),VOUS,'no vous / votre / vos written by ProspectOS');
 assert.deepEqual(tu.angle,vous.angle,'same angle');
 assert.deepEqual([tu.evidence_ids,tu.signal_ids,tu.public_content_ids,tu.provider],[vous.evidence_ids,vous.signal_ids,vous.public_content_ids,vous.provider],'same provenance');
 assert.deepEqual(quotes(tu.text),quotes(vous.text),'the quotes are the very same, character for character');
});

test('B — tu: the angle sentence is never lost and why_now is the tutoyé sentence (publication and signal)',()=>{
 const pinned=compose(SCENARIOS.public_content_pinned,'fr',TU),recent=compose(SCENARIOS.public_content,'fr',TU),signal=compose(SCENARIOS.signal,'fr',TU);
 assert.equal(pinned.why_now,`j’ai lu cette publication concernant ton entreprise : ${QUOTE_PC}.`);
 assert.equal(recent.why_now,pinned.why_now);
 assert.equal(signal.why_now,`j’ai vu cette actualité récente concernant ton entreprise : ${QUOTE_SIG}.`);
 for(const c of [pinned,recent,signal])assert.ok(c.why_now&&c.text.startsWith(`Bonjour, ${c.why_now} `),'inserted right after the greeting');
 assert.deepEqual(pinned.public_content_ids,['pc1']);assert.deepEqual(signal.signal_ids,['s1']);
});

test('C — quotes are never transformed, even when they contain the template’s own words',()=>{
 const hostile='Bonjour l’équipe Kerlan, seriez-vous ouvert à un court échange ? Voir sur votre site, vous concernant';
 const s:Scenario={evidence:[ev({excerpt:hostile})],signals:[],publicContent:[pc({pinned:true,content:`${hostile}.`})]};
 const tu=compose(s,'fr',TU),vous=compose(s,'fr');
 assert.deepEqual(quotes(tu.text),quotes(vous.text));
 assert.equal(quotes(tu.text).length,2);
 for(const q of quotes(tu.text))assert.ok(q.startsWith(`« ${hostile} »`),'quoted verbatim');
 assert.doesNotMatch(ownWords(tu.text),VOUS);
 assert.ok(tu.text.startsWith('Bonjour, j’ai lu cette publication concernant ton entreprise : '));
 assert.ok(tu.text.endsWith(CTA_TU));
});

test('D — the offer is the user’s own text: kept verbatim in tu (never rewritten)',()=>{
 const offer='Nous vous aidons à recruter vos commerciaux.';
 const tu=composeRuleBased({name:'Kerlan',offer,criteria:core.DEFAULT_CRITERIA,profile:PROFILE,now:NOW,evidence:[ev()],signals:[],publicContent:[],locale:'fr',style:TU});
 assert.equal(tu.text,`Bonjour, j’ai remarqué ceci sur ton site : ${QUOTE_EV}. ${offer} ${CTA_TU}`);
 assert.doesNotMatch(ownWords(tu.text,offer),VOUS);
});

for(const [name,s] of Object.entries(SCENARIOS))test(`E — vous / auto / no profile, ${name}: today’s text to the character`,()=>{
 assert.equal(compose(s,'fr').text,BASELINE_FR[name]);
 assert.equal(compose(s,'fr',style({address_mode:'vous'})).text,BASELINE_FR[name]);
 assert.equal(compose(s,'fr',style({address_mode:'auto'})).text,BASELINE_FR[name]);
});

test('E — vous with an empty banned list keeps the template’s generic opening, as today',()=>{
 const t=compose(SCENARIOS.generic,'fr',style({address_mode:'vous',banned_phrases:[]})).text;
 assert.equal(t,`Bonjour l’équipe Kerlan, je me permets de vous contacter au sujet de votre activité. ${OFFER} ${CTA_VOUS}`);
 const tu=compose(SCENARIOS.generic,'fr',style({address_mode:'tu',banned_phrases:[]})).text;
 assert.equal(tu,EXPECTED_TU.generic,'tu: the same individual opening, whatever the banned list');
});

for(const [name,s] of Object.entries(SCENARIOS))test(`F — English, ${name}: unchanged, whatever the address mode`,()=>{
 assert.equal(compose(s,'en').text,BASELINE_EN[name]);
 assert.equal(compose(s,'en',TU).text,BASELINE_EN[name]);
 assert.equal(compose(s,'en',style({address_mode:'vous'})).text,BASELINE_EN[name]);
});

test('G — one shared greeting: the frozen template opens with it, the tu message too, and withWhyNow inserts the angle right after it',async()=>{
 const greet=(whyNowModule as Record<string,unknown>).outreachGreeting as ((name:string,locale:'fr'|'en',address?:'vous'|'tu')=>string)|undefined;
 assert.equal(typeof greet,'function','outreachGreeting is exported by src/domain/why-now.ts');
 assert.equal(greet!('Kerlan','fr','tu'),'Bonjour, ');
 assert.equal(greet!('Kerlan','fr','vous'),'Bonjour l’équipe Kerlan, ');assert.equal(greet!('Kerlan','fr'),'Bonjour l’équipe Kerlan, ');
 assert.equal(greet!('Kerlan','en','tu'),'Hello Kerlan team, ');assert.equal(greet!('Kerlan','en'),'Hello Kerlan team, ');
 // src/domain/core.ts is frozen (scoring invariant): its own greeting must stay the shared 'vous' one, with or without excerpt.
 for(const locale of ['fr','en'] as const)for(const evidence of [[ev()],[]])
  assert.ok(core.generateOutreach('Kerlan',OFFER,core.DEFAULT_CRITERIA,evidence,NOW,locale).text.startsWith(greet!('Kerlan',locale,'vous')),`${locale}, ${evidence.length} evidence`);
 for(const s of Object.values(SCENARIOS))assert.ok(compose(s,'fr',TU).text.startsWith(greet!('Kerlan','fr','tu')));
 const withWhyNow=whyNowModule.withWhyNow as (...a:unknown[])=>string;
 assert.equal(withWhyNow(EXPECTED_TU.evidence,'Kerlan',{sentence:'j’ai vu ceci.',signal_ids:['s1']},'fr','tu'),`Bonjour, j’ai vu ceci. J’ai remarqué ceci sur ton site : ${QUOTE_EV}. ${OFFER} ${CTA_TU}`);
 const why=await src('../src/domain/why-now.ts'),composeSrc=await src('../src/outreach/compose.ts');
 assert.match(why,/const greeting=outreachGreeting\(name,locale,address\);/,'withWhyNow uses the shared greeting');
 assert.equal(why.split('Bonjour l’équipe').length-1,1,'one definition of the greeting, in outreachGreeting');
 assert.doesNotMatch(composeSrc,/Bonjour/,'the composer never writes a greeting of its own');
});

test('H — the tu wording takes the template back by position: nested guillemets, an offer quoting the CTA, anything else untouched',async()=>{
 const {tutoyerTemplate}=await import('../src/outreach/compose.ts') as {tutoyerTemplate?:(text:string,name:string,offer:string)=>string};
 assert.equal(typeof tutoyerTemplate,'function');
 const nested='Notre devise : « votre site, vos règles » depuis 1987';
 const tricky='Seriez-vous ouvert à un court échange ? Nous vous rappelons sous 24 h.';
 const t=composeRuleBased({name:'Kerlan',offer:tricky,criteria:core.DEFAULT_CRITERIA,profile:PROFILE,now:NOW,evidence:[ev({excerpt:nested})],signals:[],publicContent:[],locale:'fr',style:TU}).text;
 assert.equal(t,`Bonjour, j’ai remarqué ceci sur ton site : « ${nested} ». ${tricky} ${CTA_TU}`);
 for(const other of ['','Bonjour l’équipe Kerlan, autre texte.','Un message écrit à la main, vous concernant.',`Bonjour l’équipe Kerlan, j’ai remarqué ceci sur votre site : « x ». Autre offre. ${CTA_VOUS}`])
  assert.equal(tutoyerTemplate!(other,'Kerlan',OFFER),other,'not exactly the template: returned as it is, never partly rewritten');
});
