// ICP match quality (src/discovery/strategies/match-context.ts): which sentence of a page really supports a criterion.
// 1. Better semantic correspondence: compound and inflected forms of the user's own values ("agro-alimentaire",
//    "restaurants", "transports routiers"), the best sentence of the page rather than the first one.
// 2. Guard against weak or out-of-context lexical matches: a menu, legal notices, a sentence about the SECTOR or about
//    the organization's CLIENTS / MEMBERS, a quotation, a general article. Rejected matches never become proposals;
//    the reviewer sees why. Deterministic: no model, no synonym the user did not write. Fictional companies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservationService} from '../src/discovery/observations.ts';
import {assessMatch,lineKind,findTermMatches} from '../src/discovery/strategies/match-context.ts';
import type {Criterion} from '../src/domain/core.ts';

const cat=(values:string[],extra:Record<string,unknown>={}):Criterion[]=>[{key:'target_fit',label:'Correspond à la cible définie',weight:100,rules:{type:'target_fit',config:{match:'any_defined',categories:values,...extra}}} as Criterion];
const need=(signals:string[]):Criterion[]=>[{key:'need_fit',label:'Besoin correspondant à l’offre',weight:100,rules:{type:'need_fit',config:{signals}}} as Criterion];
const page=(...lines:string[])=>`<title>x</title><main>${lines.map(l=>`<p>${l}</p>`).join('')}</main>`;
const extract=(html:string,criteria:Criterion[])=>new ObservationService().extract(html,'https://acme.example',criteria,'official_website',new Date('2026-10-06T12:00:00Z'));
const proposal=(o:ReturnType<typeof extract>,key:string)=>o.find(x=>x.criterion===key&&x.value===true);
const note=(o:ReturnType<typeof extract>,key:string)=>o.find(x=>x.criterion===key&&/OUT_OF_CONTEXT/.test(x.observation_type));

test('the Aria case: a sentence about the SECTOR is not the organization belonging to it',()=>{
 const o=extract(page('En participant à valoriser les initiatives des industries, l’ARIA contribue à valoriser une image positive du secteur agroalimentaire.'),cat(['agroalimentaire']));
 assert.equal(proposal(o,'target_fit'),undefined);
 assert.match(note(o,'target_fit')!.claim,/secteur/);
 assert.equal(note(o,'target_fit')!.value,null,'a note, never a value');
});

test('the organization itself: membership wording wins over the sector words around it',()=>{
 for(const line of ['Acteur du secteur agroalimentaire depuis 1990, nous transformons des fruits de la région.','Nous sommes une PME agroalimentaire familiale.',
  'Fabricant agroalimentaire spécialisé dans les plats cuisinés.','Notre entreprise agroalimentaire emploie 80 personnes.','Durand est une entreprise agro-alimentaire lyonnaise.']){
  assert.ok(proposal(extract(page(line),cat(['agroalimentaire'])),'target_fit'),line);
 }
});

test('clients, members, partners: the organization SERVES them, it is not one of them',()=>{
 for(const line of ['Nous accompagnons les entreprises de l’agroalimentaire dans leur transition énergétique.','Nos clients du secteur agroalimentaire nous font confiance.',
  'Une offre dédiée aux industriels de l’agroalimentaire.','L’association fédère 600 adhérents de l’industrie agroalimentaire.','Nous travaillons avec les plus grands noms de l’agroalimentaire.','Nous travaillons pour une entreprise agroalimentaire de la région.','Notre cliente, une PME agroalimentaire, a réduit ses coûts.']){
  const o=extract(page(line),cat(['agroalimentaire']));
  assert.equal(proposal(o,'target_fit'),undefined,line);assert.ok(note(o,'target_fit'),`explained: ${line}`);
 }
 // Same discipline for an organization type.
 const org=extract(page('Nous accompagnons les associations sportives dans leur gestion.'),cat([],{org_types:['association']}));
 assert.equal(proposal(org,'target_fit'),undefined);
});

test('menus, short titles, legal notices, cookie banners and quotations are not evidence',()=>{
 const cases=[page('Agroalimentaire'),page('Accueil | Agroalimentaire | BTP | Santé | Contact'),
  page('Mentions légales : site hébergé par une société agroalimentaire de services, 2 rue X, Roubaix.'),
  page('Nous utilisons des cookies. Partenaires agroalimentaire et publicité.'),
  page('« Le secteur agroalimentaire va mal », témoigne un dirigeant.')];
 for(const html of cases)assert.equal(proposal(extract(html,cat(['agroalimentaire'])),'target_fit'),undefined,html);
 assert.equal(lineKind('Accueil | Agroalimentaire | BTP | Santé | Contact'),'NAVIGATION');
 assert.equal(lineKind('© 2026 Acme — Tous droits réservés'),'LEGAL');
 assert.equal(lineKind('Nous sommes une PME agroalimentaire familiale.'),'CONTENT');
});

test('the best sentence, not the first: a later explicit sentence beats an earlier ambiguous one',()=>{
 const o=extract(page('Le secteur agroalimentaire traverse une période difficile.','Nous sommes un fabricant agroalimentaire installé à Valence.'),cat(['agroalimentaire']));
 assert.equal(proposal(o,'target_fit')!.source_excerpt,'Nous sommes un fabricant agroalimentaire installé à Valence.');
});

test('compound and inflected forms of the user’s own value; never a fragment, never a synonym',()=>{
 assert.ok(proposal(extract(page('Nous sommes une entreprise agro-alimentaire.'),cat(['agroalimentaire'])),'target_fit'),'hyphenated compound');
 assert.ok(proposal(extract(page('Nous sommes une entreprise agroalimentaire.'),cat(['agro-alimentaire'])),'target_fit'),'and the other way round');
 assert.ok(proposal(extract(page('Nous gérons trois restaurants à Lyon.'),cat(['restaurant'])),'target_fit'),'plural');
 assert.ok(proposal(extract(page('Spécialiste des transports routiers frigorifiques.'),cat(['transport routier'])),'target_fit'),'multi-word, inflected');
 assert.equal(proposal(extract(page('Notre restaurant propose un barbecue chaque week-end.'),cat(['bar'])),'target_fit'),undefined,'never a fragment');
 assert.equal(proposal(extract(page('Nous sommes une entreprise de logistique.'),cat(['transport routier'])),'target_fit'),undefined,'never a synonym');
 assert.equal(proposal(extract(page('Le transport de nos produits se fait par voie routière ou fluviale.'),cat(['transport routier'])),'target_fit'),undefined,'two words far apart in another sense');
 assert.deepEqual(findTermMatches(['Nous gérons trois restaurants.'],'restaurant').map(m=>m.kind),['inflected']);
});

test('locations: an address is the organization’s own; a hosting provider’s address is not',()=>{
 const loc=(lines:string[])=>extract(page(...lines),cat([],{locations:['Roubaix']}));
 assert.ok(proposal(loc(['Acme — 12 rue des Arts, 59100 Roubaix']),'target_fit'),'own address');
 assert.equal(proposal(loc(['Hébergeur : OVH SAS, 2 rue Kellermann, 59100 Roubaix']),'target_fit'),undefined,'hosting provider');
});

test('need signals: a general article, a menu or a question title is not a need; an explicit sentence is',()=>{
 const n=need(['cybersécurité']);
 for(const line of ['Cybersécurité','Les 5 tendances de la cybersécurité en 2026','Comment renforcer sa cybersécurité ?','Webinaire : la cybersécurité pour les PME'])
  assert.equal(proposal(extract(page(line),n),'need_fit'),undefined,line);
 assert.ok(proposal(extract(page('Nous renforçons notre cybersécurité après un audit cette année.'),n),'need_fit'));
 // Existing behavior kept: what the prospect itself offers can be the need signal the user chose.
 assert.ok(proposal(extract(page('Nous proposons la prise de rendez-vous en ligne pour nos clients.'),need(['prise de rendez-vous en ligne'])),'need_fit'));
});

test('assessMatch explains every decision with a code',()=>{
 assert.deepEqual(assessMatch('L’ARIA contribue à valoriser une image positive du secteur agroalimentaire.','agroalimentaire','categories'),{accepted:false,code:'SECTOR_MENTION'});
 assert.deepEqual(assessMatch('Nos clients du secteur agroalimentaire nous font confiance.','agroalimentaire','categories'),{accepted:false,code:'SERVED_NOT_SELF'});
 assert.deepEqual(assessMatch('Nous sommes une PME agroalimentaire.','agroalimentaire','categories'),{accepted:true,code:'SELF',score:1});
 assert.deepEqual(assessMatch('Plats cuisinés agroalimentaire, livraison en 48 h.','agroalimentaire','categories'),{accepted:true,code:'NEUTRAL',score:0.7});
});

test('weak keyword hint: one shared word in a menu or legal line is not even a hint any more',()=>{
 const criteria:Criterion[]=[{key:'qualite',label:'Démarche qualité certifiée',weight:100}];
 const o=extract(page('Qualité','Politique qualité et cookies : mentions légales'),criteria);
 assert.ok(!o.some(x=>x.observation_type==='GENERIC_KEYWORD_MATCH'),'nothing from a heading or legal text');
 const ok=extract(page('Notre démarche qualité est certifiée ISO 9001 depuis 2019.'),criteria);
 assert.ok(ok.some(x=>x.criterion==='qualite'&&x.value!==true),'still never a proposal from a keyword');
});

test('review: a refused match is shown as such, with its reason (FR) or a translated note (EN), never as a proposal',async()=>{
 const {presentObservation}=await import('../src/components/evidence-presentation.ts');
 const o=extract(page('L’ARIA contribue à valoriser une image positive du secteur agroalimentaire.'),cat(['agroalimentaire'])).find(x=>x.observation_type==='TARGET_FIT_OUT_OF_CONTEXT')!;
 const row={...o,id:'r',prospect_id:'p',organization_id:'o',evidence_id:null,review_status:'NOT_VERIFIED'} as any;
 const fr=presentObservation(row,cat(['agroalimentaire']),'fr');assert.equal(fr.kind,'context');assert.equal(fr.title,'Correspondance écartée (hors contexte)');assert.match(fr.note!,/secteur/);
 const en=presentObservation(row,cat(['agroalimentaire']),'en');assert.equal(en.title,'Match set aside (out of context)');assert.doesNotMatch(en.note!,/secteur/);
});
