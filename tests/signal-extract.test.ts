// Signal Engine S4 — deterministic extraction (src/signals/extract.ts). GO criterion of the plan: precision ≥ 90 % on a
// FR/EN corpus of 40+ cases. Fictional companies only; the corpus pins every type and the "no signal" answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {classifySignal,parseDay,mentionsCompany,extractPageItems,signalPageKind} from '../src/signals/extract.ts';
import {SIGNAL_TYPES} from '../src/signals/types.ts';

const NOW=new Date('2026-10-06T12:00:00Z');
const CORPUS:Array<[string,string|null]>=[
 ['Durand Logistique lève 12 millions d’euros pour accélérer son développement','funding'],
 ['Levée de fonds : Atelier Verdier boucle un tour de table de 3 M€','funding'],
 ['Nordflux raises $8M Series A to expand its platform','funding'],
 ['Série B de 20 M€ pour Calypso Énergie','funding'],
 ['Maison Berthier rachète son concurrent lyonnais','acquisition'],
 ['Acquisition : Groupe Ferrand acquiert la société Lumen','acquisition'],
 ['Helvia acquires a French analytics startup','acquisition'],
 ['Fusion annoncée entre Orvix et Delta Services','acquisition'],
 ['Martin Bâtiment nomme une nouvelle directrice financière','leadership_change'],
 ['Nomination : Claire Petit devient DSI de Sofinord','leadership_change'],
 ['Nouveau directeur commercial chez Alpes Industrie','leadership_change'],
 ['Brightline appoints a new Chief Technology Officer','leadership_change'],
 ['Paul Morel rejoint Kerlan en tant que directeur des opérations','leadership_change'],
 ['Kerlan recrute un responsable sécurité des systèmes d’information (H/F)','hiring_role'],
 ['Offre d’emploi : Développeur full stack — CDI — Toulouse','hiring_role'],
 ['Rejoignez-nous : chargé de clientèle en alternance','hiring_role'],
 ['Vertigo is hiring a Head of Data','hiring_role'],
 ['Technicien de maintenance F/H — CDD 6 mois','hiring_role'],
 ['Sofinord prévoit 40 recrutements en 2026','headcount_growth'],
 ['Calypso Énergie va recruter 25 techniciens cette année','headcount_growth'],
 ['Création d’emplois : 60 postes à pourvoir sur le nouveau site','headcount_growth'],
 ['Atelier Verdier ouvre une nouvelle agence à Bordeaux','new_site'],
 ['Inauguration de la nouvelle usine Ferrand à Valence','new_site'],
 ['Nouveaux locaux pour l’équipe nantaise','new_site'],
 ['Durand Logistique s’implante en Espagne','expansion'],
 ['Développement à l’international : Orvix vise l’Allemagne','expansion'],
 ['Nordflux expands to the UK market','expansion'],
 ['Kerlan obtient la certification ISO 27001','certification'],
 ['Formation Plus certifiée Qualiopi','certification'],
 ['Helvia is now SOC 2 certified','certification'],
 ['Partenariat stratégique entre Vertigo et un éditeur nantais','partnership'],
 ['Maison Berthier s’associe avec une coopérative locale','partnership'],
 ['Brightline partners with a European cloud provider','partnership'],
 ['Alpes Industrie lance une nouvelle gamme de capteurs','product_launch'],
 ['Orvix dévoile sa nouvelle application mobile','product_launch'],
 ['Calypso Énergie remporte le marché de la métropole','public_contract_won'],
 ['Sofinord attributaire du marché public de maintenance','public_contract_won'],
 ['Delta Services wins a public contract with the region','public_contract_won'],
 ['Kerlan migre son infrastructure vers le cloud','tech_change'],
 ['Martin Bâtiment déploie un nouvel ERP','tech_change'],
 ['Cyberattaque : Ferrand victime d’un rançongiciel','incident_cyber'],
 ['Fuite de données chez Lumen, les clients prévenus','incident_cyber'],
 ['Retrouvez Atelier Verdier au salon Batimat, stand B12','event'],
 ['Webinar : comment réduire vos coûts logistiques','event'],
 ['Nos valeurs : proximité, exigence et bienveillance',null],
 ['Mentions légales et politique de confidentialité',null],
 ['Découvrez nos réalisations en images',null],
 ['Contactez notre équipe commerciale',null],
];

test('corpus FR/EN: ≥ 40 cases, every type covered, precision ≥ 90 % (plan GO criterion)',()=>{
 assert.ok(CORPUS.length>=40);
 assert.deepEqual(new Set(CORPUS.map(c=>c[1]).filter(Boolean)),new Set(SIGNAL_TYPES),'every signal type is in the corpus');
 const wrong=CORPUS.filter(([text,expected])=>classifySignal(text)!==expected).map(([text,expected])=>`${expected} ≠ ${classifySignal(text)} : ${text}`);
 const precision=(CORPUS.length-wrong.length)/CORPUS.length;
 assert.ok(precision>=0.9,`precision ${precision}\n${wrong.join('\n')}`);
 assert.deepEqual(wrong,[],'and no known miss is left unexplained');
});

test('dates: ISO, French, English, numeric, relative; impossible or unreadable dates are null',()=>{
 assert.equal(parseDay('2026-03-12T10:00:00+01:00',NOW),'2026-03-12');
 assert.equal(parseDay('Publié le 12 mars 2026',NOW),'2026-03-12');
 assert.equal(parseDay('1er octobre 2026',NOW),'2026-10-01');
 assert.equal(parseDay('le 3 févr. 2026',NOW),'2026-02-03');
 assert.equal(parseDay('12/03/2026',NOW),'2026-03-12','day first, French order');
 assert.equal(parseDay('March 12, 2026',NOW),'2026-03-12');
 assert.equal(parseDay('il y a 3 jours',NOW),'2026-10-03');
 assert.equal(parseDay('2 weeks ago',NOW),'2026-09-22');
 assert.equal(parseDay('hier',NOW),'2026-10-05');
 assert.equal(parseDay('31/02/2026',NOW),null);
 assert.equal(parseDay('bientôt',NOW),null);
 assert.equal(parseDay(null,NOW),null);
});

test('company named by whole words only; legal forms ignored; a name inside another word never matches',()=>{
 assert.equal(mentionsCompany('ACME recrute un RSSI','Acme SAS'),true);
 assert.equal(mentionsCompany('Les équipes d’Atelier Verdier ouvrent','atelier verdier'),true);
 assert.equal(mentionsCompany('Acmeo lève 3 M€','Acme'),false);
 assert.equal(mentionsCompany('outil acme-tools pour les PME','Acme Tools Group'),true,'punctuation is a separator');
 assert.equal(mentionsCompany('Nothing here','A'),false,'a one-letter name never matches');
});

test('page items: JSON-LD JobPosting (expired ads dropped) and articles, <time> news, careers listing with strong markers only',()=>{
 const html=`<html><head><script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@graph':[
  {'@type':'JobPosting',title:'Responsable cybersécurité (H/F)',datePosted:'2026-09-30',description:'<p>Pilotez la sécurité.</p>',validThrough:'2026-12-31'},
  {'@type':'JobPosting',title:'Comptable',datePosted:'2026-01-10',validThrough:'2026-02-01'},
  {'@type':'NewsArticle',headline:'Kerlan obtient la certification ISO 27001',datePublished:'2026-09-15T09:00:00+02:00'},
 ]})}</script></head><body>
  <article><h3>Kerlan ouvre une nouvelle agence à Lille</h3><time datetime="2026-09-20">20 septembre 2026</time></article>
  <ul><li><a href="/jobs/1">Technicien support F/H - CDI</a></li><li><a href="/equipe">Notre équipe</a></li></ul>
 </body></html>`;
 const items=extractPageItems(html,{careersPage:true,now:NOW});
 assert.deepEqual(items.map(i=>[i.kind,i.source,i.title]),[
  ['job','json_ld','Responsable cybersécurité (H/F)'],
  ['news','json_ld','Kerlan obtient la certification ISO 27001'],
  ['news','time','Kerlan ouvre une nouvelle agence à Lille'],
  ['job','listing','Technicien support F/H - CDI'],
 ]);
 assert.equal(items[0].published_at,'2026-09-30T00:00:00.000Z');
 assert.match(items[0].excerpt,/Pilotez la sécurité/,'the excerpt is the page’s own text, tags removed');
 assert.equal(items[3].published_at,null,'a listed ad without a date stays undated (observed only)');
 assert.equal(extractPageItems(html,{careersPage:false,now:NOW}).some(i=>i.source==='listing'),false,'listing heuristics only on a careers page');
});

test('signal pages: careers and news links recognized by path or text; anything else ignored',()=>{
 assert.equal(signalPageKind('https://acme.example/carrieres','Nous rejoindre'),'careers');
 assert.equal(signalPageKind('https://acme.example/fr/actualites/','Actus'),'news');
 assert.equal(signalPageKind('https://acme.example/p/12','Espace presse'),'news');
 assert.equal(signalPageKind('https://acme.example/contact','Contact'),null);
});

test('purity: no model, no network, no clock read',async()=>{
 const src=await readFile(new URL('../src/signals/extract.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/fetch\(|anthropic|openai|Math\.random|Date\.now\(\)|new Date\(\)/);
});
