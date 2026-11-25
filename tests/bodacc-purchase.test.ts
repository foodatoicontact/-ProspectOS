// What a BODACC « Ventes et cessions » notice announces (src/domain/bodacc-purchase.ts), the ONE sort used by the reprises
// search, the signals, the national collection and the published figures (owner decisions, 25 nov. 2026). Categories,
// origins and act wordings below follow real notices (26 Oct.–24 Nov. 2026); every name, address and amount is fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifySale,purchaseOf,buyerSiren,postalCodeOf,dedupePurchases,saleCategory,fundsOrigin,SALE_RULES,SALE_KINDS,DUPLICATE_WINDOW_DAYS} from '../src/domain/bodacc-purchase.ts';
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const acte=(categorieVente:string,descriptif='')=>JSON.stringify({descriptif,vente:{categorieVente}});
const etab=(origineFonds?:string,codePostal='31000')=>JSON.stringify({etablissement:{origineFonds,adresse:{codePostal}}});
const BUY="Achat d'un fonds par une personne morale (insertion provisoire)",START="Mise en activité d'une société suite à achat",
 OTHER="Autre achat, apport, attribution (immatriculation d'une personne morale, uniquement)",CONTRIB="Apport d'un établissement principal (immatriculation d'une personne morale, uniquement)",
 BUY_SITE="Achat d'un établissement principal par une personne morale (immatriculation)";
// A fictional seller, a private person: their name must never come out of the sort.
const SELLER='Monsieur Jean EXEMPLE-VENDEUR, demeurant 1 rue des Lilas 31000 Toulouse';

test('purchases: category of a purchase, the company created to buy, the catch-all when the origin or the act says « sold »',()=>{
 for(const c of [BUY,"Achat d'un fonds par une personne physique (insertion provisoire)","Achat d’un établissement secondaire ou complémentaire par une personne morale","Achat d'un fonds par le locataire-gérant personne morale"])
  assert.deepEqual(classifySale(acte(c),etab('Achat au prix stipulé de 50000,00 euros.')),{kind:'PURCHASE',rule:'category_purchase'},c);
 assert.deepEqual(classifySale(acte(START),undefined),{kind:'PURCHASE',rule:'start_after_purchase'});
 for(const o of ['Etablissement principal acquis par achat au prix stipulé de 80000,00 euros.','Nouvelle branche d\'activité. Fonds acquis par achat au prix stipulé de 10000,00 euros','Achat'])
  assert.deepEqual(classifySale(acte(OTHER),etab(o)),{kind:'PURCHASE',rule:'origin_purchase'},o);
 // Owner decision (25 nov. 2026): with no origin, the act's text decides — read in memory by fixed patterns.
 for(const t of [`Suivant acte du 30/09/2026, la société EXEMPLE SAS a cédé à la société REPRENEUR SAS le fonds de commerce de rôtisserie.`,
  `Par acte notarié du 08/12/2023, adresse du fonds vendu 2 rue de la République 45270 Bellegarde.`,
  `Acte SSP du 28/04/2025. Adresse de l'ancien propriétaire : 2 avenue de l'Industrie 69960 Corbas. Les oppositions seront reçues au lieu du fonds cédé.`,
  `Suivant acte du 13.10.2026. Domicile ancien propriétaire : 119 rue X 37000 Tours. Domicile nouveau propriétaire : 18 avenue Y 37540 Saint-Cyr.`,
  `${SELLER}, a cédé à la société REPRENEUR le fonds.`])
  assert.deepEqual(classifySale(acte(OTHER,t),etab(undefined)),{kind:'PURCHASE',rule:'text_sale'},t.slice(0,40));
});

test('not purchases: contributions, mergers, cross-border transformations, head-office moves — and the reasons kept',()=>{
 assert.deepEqual(classifySale(acte(CONTRIB),etab()),{kind:'CONTRIBUTION',rule:'category_contribution'});
 for(const o of ['Etablissement principal acquis par apport au montant évalué à 125417,00 euros.','Apport partiel d\'actif 151632 eur'])
  assert.deepEqual(classifySale(acte(BUY),etab(o)),{kind:'CONTRIBUTION',rule:'origin_contribution'},`an « Achat » whose origin is a contribution: ${o}`);
 assert.deepEqual(classifySale(acte(OTHER),etab('Apport fusion')),{kind:'MERGER',rule:'origin_merger'});
 assert.deepEqual(classifySale(acte(OTHER,'Fusion-absorption de la société EXEMPLE par la société ABSORBANTE, qui lui a cédé à titre universel…'),etab(undefined)),{kind:'MERGER',rule:'text_merger'},'a restructuring first, even when its notice says « cédé »');
 assert.deepEqual(classifySale(acte(OTHER,'Avis au Bodacc relatif au projet de transformation transfrontalière : transfert du siège au Luxembourg.'),etab(undefined)),{kind:'MERGER',rule:'text_merger'});
 assert.deepEqual(classifySale(acte(OTHER,'Apport en nature du fonds de commerce à la société EXEMPLE.'),etab(undefined)),{kind:'CONTRIBUTION',rule:'text_contribution'});
 assert.deepEqual(classifySale(acte(BUY_SITE,'Immatriculation d\'une personne morale suite au transfert du siège hors ressort'),etab(undefined)),{kind:'UNDETERMINED',rule:'text_head_office_move'});
 assert.deepEqual(classifySale(acte(OTHER,'Modification de l\'activité.'),etab(undefined)),{kind:'UNDETERMINED',rule:'no_rule'});
 for(const bad of [null,undefined,'{oops',JSON.stringify({vente:{}}),JSON.stringify({})])assert.deepEqual(classifySale(bad,etab('Achat')),{kind:'UNDETERMINED',rule:'no_rule'},String(bad));
});

test('court-ordered sales: from the origin or from the act; a pharmacy\'s « livres d\'ordonnances » is not one',()=>{
 assert.deepEqual(classifySale(acte(BUY),etab('Achat au prix stipulé de 20000 euros, cession ordonnée par le juge-commissaire.')),{kind:'FORCED_SALE',rule:'origin_forced'});
 for(const t of ['Les créanciers ayant déjà été invités à déclarer leurs créances dans le cadre de la procédure de liquidation judiciaire, il ne pourra être formé d\'opposition.',
  'S\'agissant d\'une cession en application des articles L.642-19 et s. du Code de commerce, il n\'y a pas lieu à opposition.',
  'La SELARL EXEMPLE, mandataire judiciaire à la liquidation judiciaire simplifiée de la société X, a cédé le fonds.'])
  assert.deepEqual(classifySale(acte(BUY,t),etab('Achat au prix stipulé de 41000,00 euros.')),{kind:'FORCED_SALE',rule:'text_forced'},t.slice(0,40));
 assert.deepEqual(classifySale(acte(BUY,'… ainsi que les livres d\'ordonnances et autres documents de l\'officine.'),etab('Achat au prix stipulé de 1575000,00 euros.')),{kind:'PURCHASE',rule:'category_purchase'});
 assert.deepEqual(purchaseOf(acte(BUY,'liquidation judiciaire'),etab('Achat')),{purchase:false,reason:'FORCED_SALE',kind:'FORCED_SALE',rule:'text_forced'});
 assert.deepEqual(purchaseOf(acte(CONTRIB),etab()),{purchase:false,reason:'NOT_A_PURCHASE',kind:'CONTRIBUTION',rule:'category_contribution'});
 assert.deepEqual(purchaseOf(acte(START),etab()),{purchase:true,rule:'start_after_purchase'});
});

test('the act\'s text never comes out: a verdict is two constants, nothing of the text is exported, returned or logged',()=>{
 const texts=[`${SELLER} a cédé à la société REPRENEUR le fonds de commerce.`,`${SELLER}, liquidation judiciaire.`,`${SELLER}, apport.`,`${SELLER}, fusion.`,SELLER];
 for(const t of texts)for(const c of [BUY,START,OTHER,CONTRIB,BUY_SITE]){
  const v=classifySale(acte(c,t),etab(undefined)),p=purchaseOf(acte(c,t),etab(undefined));
  assert.deepEqual(Object.keys(v).sort(),['kind','rule']);
  assert.ok((SALE_KINDS as readonly string[]).includes(v.kind)&&(SALE_RULES as readonly string[]).includes(v.rule));
  assert.doesNotMatch(JSON.stringify([v,p]),/EXEMPLE|VENDEUR|Lilas|Jean|demeurant/i);
 }
 const src=read('src/domain/bodacc-purchase.ts').replace(/^\s*\/\/.*$/gm,'');
 assert.doesNotMatch(src,/console\.|throw |Error\(/,'no log and no error can carry the text');
 assert.doesNotMatch(src,/export function actText|export const actText/,'the text reader stays private');
 assert.doesNotMatch(src,/fetch\(|anthropic|openai|model/i,'fixed patterns only: no AI call per notice');
 assert.equal(saleCategory(acte(BUY,'X')),BUY);assert.equal(fundsOrigin(etab('Achat  au prix')),'achat au prix');
});

test('one buyer is one reprise within 30 days; no register number, never merged',()=>{
 assert.equal(DUPLICATE_WINDOW_DAYS,30);
 assert.equal(buyerSiren(['900 000 001','900000001','832478069']),'900000001');
 assert.equal(buyerSiren("['900 000 001', '900000001']"),'900000001');
 assert.equal(buyerSiren(['pas de numéro']),null);assert.equal(buyerSiren(undefined),null);
 assert.equal(postalCodeOf(etab('Achat','35000')),'35000');assert.equal(postalCodeOf(null),null);
 const n=(id:string,siren:string|null,day:string)=>({id,siren,day});
 const kept=dedupePurchases([n('a','900000001','2026-11-10'),n('b','900000001','2026-10-20'),n('c','900000001','2026-11-25'),n('d',null,'2026-11-10'),n('e',null,'2026-11-10'),n('f','900000002','2026-11-10')],x=>x.siren,x=>x.day);
 assert.deepEqual(kept.map(x=>x.id),['b','c','d','e','f'],'b (20 oct.) comes first; a (10 nov., 21 days later) is the same reprise; c (25 nov., 36 days) is a new one; no SIREN is never merged');
});

test('one rule everywhere: the search, the signals, the collection and the figures all call it',()=>{
 for(const f of ['src/discovery/providers/bodacc-sales.ts','src/signals/providers/bodacc.ts','src/collect/bodacc.ts','src/domain/company-creations.ts'])
  assert.match(read(f),/from '(?:\.\.\/)*(?:\.\/|domain\/|\.\.\/domain\/)?bodacc-purchase\.ts'/,f);
 assert.doesNotMatch(read('src/signals/providers/bodacc.ts'),/if\(\/vente\|cession\/\.test\(family\)\)return \{type:'acquisition'/,'a sale is never a « rachat » without the rule');
});
