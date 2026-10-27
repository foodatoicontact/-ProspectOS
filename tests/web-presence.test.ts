// Web presence diagnostic (src/discovery/strategies/web-presence.ts): French sites first, every quote found again
// in the page, absence never stated as a fact, and nothing ever reaching a criterion, a proposal or the score.
import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {diagnoseWebPresence,webPresenceObservations,isGrounded,visibleText,detectAgencyCredit,staleCopyright,WEB_PRESENCE_TYPES,MAX_WEB_PRESENCE_FACTS,type WebPage} from '../src/discovery/strategies/web-presence.ts';
import {EvidenceProposalService} from '../src/discovery/observations.ts';
import {CompanyAnalysisService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {presentObservation} from '../src/components/evidence-presentation.ts';
import {DEFAULT_CRITERIA,scoreProspect} from '../src/domain/core.ts';
import type {Observation,StoredObservation} from '../src/discovery/types.ts';

const NOW=new Date('2026-10-27T12:00:00Z');

const PLOMBIER=`<!doctype html><html><head><title>Dupuy Plomberie Bayonne | Plombier chauffagiste</title>
<meta name="generator" content="WordPress 5.2.4">
<script src="/wp-content/plugins/elementor/frontend.min.js"></script></head><body>
<h1>Votre plombier à Bayonne depuis 2009</h1>
<p>Dépannage, chauffe-eau, salle de bain. Devis gratuit au 05 59 00 00 00.</p>
<footer><p>SIRET 812 345 678 00019 · <a href="/mentions-legales">Mentions légales</a></p>
<p>Hébergé par <a href="https://www.ovhcloud.com">OVH</a></p>
<p>Site réalisé par <a href="https://www.pixel-basque.fr">Agence Pixel Basque</a></p>
<p>© 2017 Dupuy Plomberie</p>
<p><a href="https://www.facebook.com/dupuy">Facebook</a></p></footer></body></html>`;

const MODERNE=`<!doctype html><html><head><title>Atelier Lumen — Coiffure Toulouse</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<h1>Atelier Lumen</h1><a class="btn" href="https://www.planity.com/atelier-lumen-31000-toulouse">Prendre rendez-vous</a>
<form><h2>Demander un devis mariage</h2><input name="nom"><input name="email"><button>Envoyer</button></form>
<footer><p>© 2015 - 2026 Atelier Lumen</p></footer></body></html>`;

const page=(html:string,url='https://www.dupuy-plomberie.fr/'):WebPage=>({url,html});
const types=(facts:{type:string}[])=>facts.map(f=>f.type).sort();

test('a dated French tradesman site: agency, CMS, old copyright, no mobile viewport, no online quote, no booking',()=>{
 const facts=diagnoseWebPresence([page(PLOMBIER)],NOW);
 assert.deepEqual(types(facts),['WEB_AGENCY_CREDIT','WEB_CMS','WEB_COPYRIGHT_OLD','WEB_NO_MOBILE_VIEWPORT','WEB_NO_ONLINE_BOOKING_SEEN','WEB_NO_QUOTE_REQUEST_SEEN']);
 const agency=facts.find(f=>f.type==='WEB_AGENCY_CREDIT')!;
 assert.equal(agency.excerpt,'Site réalisé par Agence Pixel Basque');assert.equal(agency.confidence,.9);
 assert.equal(facts.find(f=>f.type==='WEB_CMS')!.excerpt,'WordPress 5.2.4');
 assert.match(facts.find(f=>f.type==='WEB_COPYRIGHT_OLD')!.claim,/2017 \(il y a 9 ans\)/);
});

test('a sentence "Devis gratuit au 05…" is not an online quote request; a phone number is not a form',()=>{
 const facts=diagnoseWebPresence([page(PLOMBIER)],NOW);
 assert.ok(!facts.some(f=>f.type==='WEB_QUOTE_REQUEST_FOUND'));
});

test('a maintained site: quote form, booking link, current copyright, viewport — only "found" facts',()=>{
 const facts=diagnoseWebPresence([page(MODERNE,'https://atelier-lumen.fr/')],NOW);
 assert.deepEqual(types(facts),['WEB_ONLINE_BOOKING_FOUND','WEB_QUOTE_REQUEST_FOUND']);
 assert.equal(facts.find(f=>f.type==='WEB_QUOTE_REQUEST_FOUND')!.excerpt,'Demander un devis mariage');
 assert.equal(facts.find(f=>f.type==='WEB_ONLINE_BOOKING_FOUND')!.excerpt,'www.planity.com');
});

test('hosting credits, social links, consent widgets and site builders are never the agency',()=>{
 const html=(footer:string)=>`<html><head><title>T</title></head><body><footer>${footer}</footer></body></html>`;
 const credit=(footer:string)=>detectAgencyCredit(load(html(footer)),'exemple.fr');
 assert.equal(credit('<p>Hébergé par <a href="https://www.ovhcloud.com">OVH</a></p>'),null);
 assert.equal(credit('<p>Hébergeur : <a href="https://www.o2switch.fr">o2switch</a></p>'),null);
 assert.equal(credit('<p>Site créé avec <a href="https://www.wix.com">Wix.com</a></p>'),null);
 assert.equal(credit('<p>Gestion des cookies par <a href="https://www.axeptio.eu">Axeptio</a></p>'),null);
 assert.equal(credit('<p><a href="https://www.instagram.com/x">Suivez-nous</a></p>'),null);
 // A bare outbound link (0.35) is never recorded: a wrong provider in a message is worse than none.
 assert.equal(credit('<p><a href="https://www.partenaire.fr">Notre partenaire</a></p>'),null);
 // A link to the site itself is not a credit.
 assert.equal(credit('<p>Site réalisé par <a href="https://www.exemple.fr/equipe">nous</a></p>'),null);
});

test('French and English credit wordings, and a descriptive anchor at 0.75',()=>{
 const credit=(footer:string)=>detectAgencyCredit(load(`<html><body><footer>${footer}</footer></body></html>`),'exemple.fr');
 assert.equal(credit('<p>Conception : <a href="https://studio-x.fr">Studio X</a></p>')!.confidence,.9);
 assert.equal(credit('<p>Création du site : <a href="https://studio-x.fr">Studio X</a></p>')!.confidence,.9);
 assert.equal(credit('<p>Site conçu par<br><a href="https://studio-x.fr">Studio X</a></p>')!.confidence,.9);
 assert.equal(credit('<p>Website by <a href="https://studio-x.com">Studio X</a></p>')!.confidence,.9);
 assert.equal(credit('<p><a href="https://studio-x.fr">Agence web Studio X</a></p>')!.confidence,.75);
 assert.equal(credit('<p><a href="https://studio-x.fr">Création site internet Pau</a></p>')!.confidence,.75);
});

test('copyright: the latest year of a range counts; a recent year, a future year or none says nothing',()=>{
 assert.equal(staleCopyright('© 2015 - 2026 Atelier',NOW),null);
 assert.equal(staleCopyright('© 2025 Atelier',NOW),null);
 assert.equal(staleCopyright('Copyright 2031 Atelier',NOW),null);
 assert.equal(staleCopyright('Fondée en 2009, notre entreprise',NOW),null);
 assert.equal(staleCopyright('© 2012-2019 Garage Martin',NOW)!.year,2019);
 assert.equal(staleCopyright('Copyright (c) 2016 Garage Martin',NOW)!.year,2016);
});

test('absence is read across every page: a quote form on page 2 cancels "no quote seen"',()=>{
 const contact='<html><head><title>Contact</title></head><body><a href="/devis">Demande de devis</a></body></html>';
 const facts=diagnoseWebPresence([page(PLOMBIER),page(contact,'https://www.dupuy-plomberie.fr/contact')],NOW);
 assert.ok(!facts.some(f=>f.type==='WEB_NO_QUOTE_REQUEST_SEEN'));
 const found=facts.find(f=>f.type==='WEB_QUOTE_REQUEST_FOUND')!;
 assert.equal(found.url,'https://www.dupuy-plomberie.fr/contact');assert.equal(found.title,'Contact');
 // And an absence says how many pages were read, and that it is not a proof.
 const booking=facts.find(f=>f.type==='WEB_NO_ONLINE_BOOKING_SEEN')!;
 assert.equal(booking.status,'INFERRED');assert.match(booking.claim,/2 pages lues/);assert.match(booking.claim,/pas une preuve/);
});

test('no hallucination: every OBSERVED excerpt is found again in its own page; absences are INFERRED',()=>{
 const pages=[page(PLOMBIER),page(MODERNE,'https://atelier-lumen.fr/')];
 for(const p of pages)for(const f of diagnoseWebPresence([p],NOW)){
  if(f.type==='WEB_NO_HTTPS')continue;
  if(f.status==='OBSERVED')assert.ok(isGrounded(f.excerpt,p.html),`${f.type}: « ${f.excerpt} » absent de la page`);
  else assert.equal(f.excerpt,load(p.html)('title').text().trim(),`${f.type}: an absence quotes the page title`);
  if(/_SEEN$|NO_MOBILE/.test(f.type))assert.equal(f.status,'INFERRED');
 }
});

test('isGrounded refuses a quote the page does not contain, even a near one',()=>{
 assert.equal(isGrounded('Site réalisé par Agence Pixel Basque',PLOMBIER),true);
 assert.equal(isGrounded('Site réalisé par Agence Pixel',PLOMBIER),true);
 assert.equal(isGrounded('Site réalisé par Pixel Basque',PLOMBIER),false);
 assert.equal(isGrounded('WordPress 6.4',PLOMBIER),false);
 assert.equal(isGrounded('   ',PLOMBIER),false);
 assert.ok(!visibleText(PLOMBIER).includes('frontend.min.js'));
});

test('a page without a <title> emits no absence fact: there would be nothing exact to quote',()=>{
 const facts=diagnoseWebPresence([page('<html><body><p>Bienvenue</p></body></html>')],NOW);
 assert.deepEqual(facts,[]);
});

test('HTTP-only home page is reported, with the page address as its source',()=>{
 const facts=diagnoseWebPresence([page(MODERNE,'http://atelier-lumen.fr/')],NOW);
 const f=facts.find(x=>x.type==='WEB_NO_HTTPS')!;assert.equal(f.excerpt,'http://atelier-lumen.fr/');assert.equal(f.status,'OBSERVED');
});

test('never more than MAX facts, and every type is a known one',()=>{
 const facts=diagnoseWebPresence([page(PLOMBIER,'http://www.dupuy-plomberie.fr/')],NOW);
 assert.ok(facts.length<=MAX_WEB_PRESENCE_FACTS);
 assert.ok(facts.every(f=>(WEB_PRESENCE_TYPES as readonly string[]).includes(f.type)));
});

test('stored as context only: criterion null, value null — never a proposal, never in the score',()=>{
 const obs=webPresenceObservations([page(PLOMBIER)],'official_website',NOW);
 assert.ok(obs.length>0);
 assert.ok(obs.every(o=>o.criterion===null&&o.value===null&&o.status!=='UNKNOWN'));
 assert.deepEqual(new EvidenceProposalService().propose(obs,DEFAULT_CRITERIA),[]);
 assert.equal(scoreProspect(DEFAULT_CRITERIA,[],NOW).score,0);
 // Same site, same facts, same hashes: analysing again does not duplicate rows.
 assert.deepEqual(webPresenceObservations([page(PLOMBIER)],'official_website',NOW).map(o=>o.content_hash),obs.map(o=>o.content_hash));
});

test('evidence review: a web presence row is a context card with its own title and its claim as the note',()=>{
 const o=webPresenceObservations([page(PLOMBIER)],'official_website',NOW).find(x=>x.observation_type==='WEB_AGENCY_CREDIT')!;
 const row:StoredObservation={...o,id:'o1',prospect_id:'p',organization_id:'a',evidence_id:null,review_status:'NOT_VERIFIED'};
 const fr=presentObservation(row,DEFAULT_CRITERIA,'fr');
 assert.equal(fr.kind,'context');assert.equal(fr.title,'Site : prestataire crédité');assert.equal(fr.note,o.claim);assert.equal(fr.criterion,null);
 const en=presentObservation(row,DEFAULT_CRITERIA,'en');
 assert.equal(en.title,'Website: credited provider');assert.match(en.note!,/never counted in the score/);
});

class Repo implements DiscoveryRepository {
 saved:Observation[]=[];
 async start(){return {id:'r',project_id:'p',provider:'fixture',status:'running',result_count:0,error_message:null}}
 async existing(){return []} async saveResults(){return []} async finish(){}
 async prospect(){return {id:'p',website:'https://www.dupuy-plomberie.fr/',organization_id:'a',project_id:'p'}}
 async projectCriteria(){return DEFAULT_CRITERIA} async consumeAnalysis(){}
 async saveObservations(_id:string,obs:Observation[]){this.saved=obs;return obs as never}
}

test('site analysis: diagnostic added on the official site from the pages already fetched — no extra request',async()=>{
 const r=new Repo();const fetched:string[]=[];
 const result=await new CompanyAnalysisService(r as never,async url=>{fetched.push(url);return {url,html:PLOMBIER}}).analyze_company('p');
 assert.deepEqual(fetched,['https://www.dupuy-plomberie.fr/']);
 assert.ok(r.saved.some(o=>o.observation_type==='WEB_AGENCY_CREDIT'));
 assert.equal(result.proposals,new EvidenceProposalService().propose(r.saved.filter(o=>!o.observation_type.startsWith('WEB_')),DEFAULT_CRITERIA).length);
});

test('site analysis: no diagnostic for a page that is not the organization’s own site',async()=>{
 const r=new Repo();
 await new CompanyAnalysisService(r as never,async url=>({url,html:PLOMBIER})).analyze_company('p','search_result');
 assert.ok(!r.saved.some(o=>o.observation_type.startsWith('WEB_')));
});

test('benign hosts match whole domain labels, never a substring (studio-x.com is not x.com)',async()=>{
 const {isBenignHost}=await import('../src/discovery/strategies/web-presence.ts');
 for(const h of ['x.com','www.facebook.com','fr-fr.facebook.com','ovhcloud.com','www.ovh.com','calendly.com','annuaire.pagesjaunes.fr','www.wix.com'])assert.equal(isBenignHost(h),true,h);
 for(const h of ['studio-x.com','studio-ovh-lovers.fr','agence-google-ads.fr','box.com','pixel-basque.fr','solocal.com'])assert.equal(isBenignHost(h),false,h);
});

test('one-line legal footer: the credit is the segment the link closes, not the hosting half of the line',()=>{
 const credit=(footer:string)=>detectAgencyCredit(load(`<html><body><footer>${footer}</footer></body></html>`),'exemple.fr');
 const html='<div>© 2026 Garage Martin · Hébergement : <a href="https://www.ovhcloud.com">OVH</a> · Réalisation : <a href="https://agence-ouest.fr">Agence Ouest</a></div>';
 const c=credit(html)!;assert.equal(c.excerpt,'Réalisation : Agence Ouest');assert.equal(c.confidence,.9);
 assert.ok(isGrounded(c.excerpt,`<html><body><footer>${html}</footer></body></html>`));
 // The credit word must sit in the link's own segment: a hosting segment never lends it.
 assert.equal(credit('<div>Site réalisé avec soin | Hébergé par <a href="https://hebergeur-x.fr">Hébergeur X</a></div>'),null);
 // A bare "Nos réalisations" elsewhere on the line does not turn a partner link into a credit.
 assert.equal(credit('<div>Nos réalisations · <a href="https://partenaire.fr">Partenaire</a></div>'),null);
});

test('a page drawn by JavaScript (almost no text) states no absence — only what is really there',()=>{
 const spa='<html><head><title>Garage Martin</title><script src="https://cdn.shopify.com/app.js"></script></head><body><div id="root"></div></body></html>';
 const facts=diagnoseWebPresence([page(spa,'https://garage-martin.fr/')],NOW);
 assert.deepEqual(types(facts),['WEB_CMS']);
});
