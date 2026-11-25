// What a BODACC « Ventes et cessions » notice announces (src/domain/bodacc-purchase.ts), the ONE rule used by the reprises
// search, the signals, the national collection and the published figures (owner decision, 25 nov. 2026). Categories and
// origins below are the wordings of real notices (26 Oct.–24 Nov. 2026); amounts are fictional, no company is named.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {purchaseOf,buyerSiren,postalCodeOf,purchaseKey,saleCategory,fundsOrigin} from '../src/domain/bodacc-purchase.ts';
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const acte=(categorieVente:string,descriptif='')=>JSON.stringify({descriptif,vente:{categorieVente}});
const etab=(origineFonds?:string,codePostal='31000')=>JSON.stringify({etablissement:{origineFonds,adresse:{codePostal}}});
const BUY="Achat d'un fonds par une personne morale (insertion provisoire)",START="Mise en activité d'une société suite à achat",
 OTHER="Autre achat, apport, attribution (immatriculation d'une personne morale, uniquement)",CONTRIB="Apport d'un établissement principal (immatriculation d'une personne morale, uniquement)";

test('purchases: the category of a purchase, the company created to buy, the catch-all when the origin says « achat »',()=>{
 for(const c of [BUY,"Achat d'un fonds par une personne physique (insertion provisoire)","Achat d’un établissement secondaire ou complémentaire par une personne morale","Achat d'un fonds par le locataire-gérant personne morale",START])
  assert.deepEqual(purchaseOf(acte(c),etab('Achat au prix stipulé de 50000,00 euros.')),{purchase:true},c);
 assert.deepEqual(purchaseOf(acte(START),undefined),{purchase:true},'the start of a company bought for is a purchase even without an origin');
 for(const o of ['Etablissement principal acquis par achat au prix stipulé de 80000,00 euros.','Nouvelle branche d\'activité. Fonds acquis par achat au prix stipulé de 10000,00 euros','Achat'])
  assert.deepEqual(purchaseOf(acte(OTHER),etab(o)),{purchase:true},o);
});

test('not purchases: contributions, mergers, donations — whatever the category when the origin says so — and forced sales',()=>{
 for(const o of [undefined,'','Apport fusion','Fonds acquis par donation'])assert.deepEqual(purchaseOf(acte(OTHER),etab(o)),{purchase:false,reason:'NOT_A_PURCHASE'},String(o));
 assert.deepEqual(purchaseOf(acte(CONTRIB),etab()),{purchase:false,reason:'NOT_A_PURCHASE'});
 for(const o of ['Etablissement principal acquis par apport au montant évalué à 125417,00 euros.','Apport partiel d\'actif 151632 eur',"Apport d'exploitation individuelle au montant évalué à 135000,00 euros"])
  assert.deepEqual(purchaseOf(acte(BUY),etab(o)),{purchase:false,reason:'NOT_A_PURCHASE'},`an « Achat » whose origin is a contribution: ${o}`);
 assert.deepEqual(purchaseOf(acte(START),etab('Apport fusion')),{purchase:false,reason:'NOT_A_PURCHASE'});
 assert.deepEqual(purchaseOf(acte(BUY),etab('Achat au prix stipulé de 20000 euros, cession ordonnée par le juge-commissaire dans le cadre de la liquidation judiciaire.')),{purchase:false,reason:'FORCED_SALE'});
 assert.deepEqual(purchaseOf(acte(BUY),etab('Achat dans le cadre d\'un plan de cession.')),{purchase:false,reason:'FORCED_SALE'});
 for(const bad of [null,undefined,'{oops',JSON.stringify({vente:{}}),JSON.stringify({})])assert.deepEqual(purchaseOf(bad,etab('Achat')),{purchase:false,reason:'NOT_A_PURCHASE'},String(bad));
});

test('the act\'s free text is never read: it names sellers and private persons',()=>{
 assert.deepEqual(purchaseOf(acte(OTHER,'Monsieur Jean VENDEUR a vendu son fonds au prix de 90000 euros (achat).'),etab(undefined)),{purchase:false,reason:'NOT_A_PURCHASE'});
 assert.deepEqual(purchaseOf(acte(BUY,'Apport fusion, liquidation judiciaire'),etab('Achat')),{purchase:true});
 assert.doesNotMatch(read('src/domain/bodacc-purchase.ts').replace(/^\s*\/\/.*$/gm,''),/descriptif/,'no code reads the descriptif');
 assert.equal(saleCategory(acte(BUY,'X')),BUY);assert.equal(fundsOrigin(etab('Achat  au prix')),'achat au prix');
});

test('a purchase announced twice is one: same register number, same postal code',()=>{
 assert.equal(buyerSiren(['900 000 001','900000001','832478069']),'900000001');
 assert.equal(buyerSiren("['900 000 001', '900000001']"),'900000001');
 assert.equal(buyerSiren(['pas de numéro']),null);assert.equal(buyerSiren(undefined),null);
 assert.equal(postalCodeOf(etab('Achat','35000')),'35000');assert.equal(postalCodeOf(etab('Achat','x')),null);assert.equal(postalCodeOf(null),null);
 assert.equal(purchaseKey('900000001','35000'),'900000001:35000');assert.equal(purchaseKey(null,'35000'),null,'no register number: never merged');
});

test('one rule everywhere: the search, the signals, the collection and the figures all call it',()=>{
 for(const f of ['src/discovery/providers/bodacc-sales.ts','src/signals/providers/bodacc.ts','src/collect/bodacc.ts','src/domain/company-creations.ts'])
  assert.match(read(f),/from '(?:\.\.\/)*(?:\.\/|domain\/|\.\.\/domain\/)?bodacc-purchase\.ts'/,f);
 assert.doesNotMatch(read('src/signals/providers/bodacc.ts'),/if\(\/vente\|cession\/\.test\(family\)\)return \{type:'acquisition'/,'a sale is never a « rachat » without the rule');
});
