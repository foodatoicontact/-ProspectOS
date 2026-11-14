// Propositions et devis de la veille dédiée (commercial/). Règles : aucun identifiant légal inventé, pas de devis tant que
// le vendeur n'est pas identifiable, numérotation sans trou ni doublon, mentions de paiement B2B, aucune donnée client dans git.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {calcul,clientIssues,devisRefusal,mergeVendeur,prochainNumero,renderHtml,PIED,type Client,type Vendeur} from '../commercial/devis.ts';

const root=new URL('..',import.meta.url);
const read=(p:string)=>readFileSync(new URL(p,root),'utf8');
const VENDEUR_VERSIONNE=JSON.parse(read('commercial/vendeur.json')) as Vendeur;
const EXEMPLE=JSON.parse(read('commercial/clients/exemple.json')) as Client;
const CONDITIONS=read('commercial/conditions-veille.md');
// Fictitious seller used by the tests only (never written to disk): an obviously fake SIREN.
const COMPLET:Vendeur={...VENDEUR_VERSIONNE,denomination:'Société Test',forme_juridique:'SAS',capital:'1 000 €',adresse:'1 rue du Test, 31000 Toulouse',
 siren:'000000000',rcs_ville:'Toulouse',tva:{regime:'franchise',numero:'',taux:20}};

test('versioned files: no legal identifier is filled in, the example client is fictitious',()=>{
 for(const k of ['denomination','forme_juridique','capital','adresse','siren','rcs_ville','iban','bic'] as const)assert.equal(VENDEUR_VERSIONNE[k],'',k);
 assert.equal(VENDEUR_VERSIONNE.tva.regime,'');assert.equal(VENDEUR_VERSIONNE.tva.numero,'');
 assert.equal(EXEMPLE.siren,'');assert.match(EXEMPLE.denomination,/Exemple/);assert.match(EXEMPLE._note as unknown as string,/FICTIF/);
 assert.deepEqual(clientIssues(EXEMPLE),[]);
});

test('devis: refused while the seller is not identifiable, with the list of missing fields',()=>{
 assert.deepEqual(devisRefusal(VENDEUR_VERSIONNE),['dénomination','SIREN','RCS (ville du greffe)','forme juridique','adresse','régime de TVA (« franchise » ou « assujetti »)']);
 assert.deepEqual(devisRefusal(COMPLET),[]);
 assert.deepEqual(devisRefusal({...COMPLET,capital:''}),['capital social (obligatoire pour une société)']);
 assert.deepEqual(devisRefusal({...COMPLET,forme_juridique:'Entrepreneur individuel',capital:''}),[],'no capital for a sole trader');
 assert.deepEqual(devisRefusal({...COMPLET,siren:'12345'}),['SIREN (9 chiffres attendus)']);
 assert.deepEqual(devisRefusal({...COMPLET,tva:{regime:'assujetti',numero:''}}),['numéro de TVA intracommunautaire']);
});

test('CLI: --mode devis exits with an explicit error and does not touch the counter',{skip:existsSync(new URL('commercial/vendeur.local.json',root))?'a local seller file is present':false},()=>{
 const counter=new URL('commercial/.compteur-devis.json',root);const before=existsSync(counter)?read('commercial/.compteur-devis.json'):null;
 const r=spawnSync(process.execPath,['--experimental-strip-types','commercial/cli.ts','--client','exemple','--mode','devis'],{cwd:root,encoding:'utf8'});
 assert.equal(r.status,1);
 assert.match(r.stderr,/devis impossible, informations du vendeur manquantes : dénomination, SIREN, RCS \(ville du greffe\), forme juridique, adresse, régime de TVA/);
 assert.match(r.stderr,/--mode proposition/);
 assert.equal(existsSync(counter)?read('commercial/.compteur-devis.json'):null,before);
 const bad=spawnSync(process.execPath,['--experimental-strip-types','commercial/cli.ts','--client','../etc','--mode','devis'],{cwd:root,encoding:'utf8'});
 assert.equal(bad.status,1);assert.match(bad.stderr,/slug invalide/);
});

test('amounts: one line per region × months, first month offered as a discount, franchise or VAT',()=>{
 const t=calcul(EXEMPLE,COMPLET);   // 2 régions × 149 € × 3 mois, 1 mois offert
 assert.deepEqual(t.lignes.map(l=>[l.libelle,l.quantite,l.unitaire,l.montant]),[
  ['Veille dédiée — Île-de-France',3,14900,44700],['Veille dédiée — Occitanie',3,14900,44700],['Premier mois offert',1,-29800,-29800]]);
 assert.equal(t.totalHT,59600);assert.equal(t.tva,0);assert.equal(t.totalTTC,59600);assert.equal(t.mentionTva,'TVA non applicable, art. 293 B du CGI');
 const tva=calcul(EXEMPLE,{...COMPLET,tva:{regime:'assujetti',numero:'FR00000000000',taux:20}});
 assert.equal(tva.mentionTva,null);assert.equal(tva.tva,11920);assert.equal(tva.totalTTC,71520);
 const annuel=calcul({...EXEMPLE,engagement:'annuel',regions:['Île-de-France'],mois_offerts:0},COMPLET);
 assert.deepEqual(annuel.lignes.map(l=>[l.libelle,l.montant]),[['Veille dédiée — Île-de-France',178800],['Engagement annuel : 2 mois offerts',-29800]]);
 assert.equal(annuel.totalHT,149000,'12 months billed 10');
 const cents=calcul({...EXEMPLE,prix_ht_par_region_par_mois:0.1,regions:['A'],nombre_mois:3,mois_offerts:0},COMPLET);assert.equal(cents.totalHT,30,'no floating-point drift');
 assert.ok(clientIssues({...EXEMPLE,engagement:'trimestriel' as 'mensuel'}).length>0);assert.ok(clientIssues({...EXEMPLE,regions:[]}).includes('regions'));
});

test('numbering: DEV-AAAA-NNNN, sequential per year',()=>{
 let c:Record<string,number>={};
 const a=prochainNumero(c,2026);assert.equal(a.numero,'DEV-2026-0001');c=a.compteur;
 const b=prochainNumero(c,2026);assert.equal(b.numero,'DEV-2026-0002');c=b.compteur;
 const d=prochainNumero(c,2027);assert.equal(d.numero,'DEV-2027-0001');assert.deepEqual(d.compteur,{2026:2,2027:1});
});

test('proposition: no number, no signature, « en cours d’immatriculation », non-contractual footer; annex attached',()=>{
 const h=renderHtml({mode:'proposition',vendeur:VENDEUR_VERSIONNE,client:EXEMPLE,date:'2026-11-14',conditions:CONDITIONS});
 assert.match(h,/<h1>Proposition commerciale<\/h1>/);assert.match(h,/Société en cours d’immatriculation/);
 assert.doesNotMatch(h,/N° DEV|Bon pour accord|SIREN \d/);
 assert.match(h,/Valable jusqu’au 14 décembre 2026 \(30 jours\)/);
 assert.equal(PIED.proposition,'Document non contractuel. Un devis vous sera adressé dès l’immatriculation finalisée.');
 for(const piece of ['Paiement par virement à 30 jours','trois fois le taux d’intérêt légal','indemnité forfaitaire pour frais de recouvrement de 40 €',
  'Aucun volume de fiches n’est garanti','TVA non applicable, art. 293 B du CGI','Total TTC','chaque lundi','Premier mois offert',
  'Conditions particulières de la veille dédiée','préavis de 30 jours','Licence d','tribunal de commerce de Toulouse','12 derniers mois','nom et la qualité des dirigeants'])
  assert.ok(h.includes(piece),piece);
 assert.doesNotMatch(h,/juriste/,'the reviewer note stays in the source file');
 assert.match(CONDITIONS,/^<!-- À faire relire par un juriste avant la première signature\. -->/);
});

test('devis: number, seller identity and « Bon pour accord »; the HTML escapes client text',()=>{
 const h=renderHtml({mode:'devis',vendeur:COMPLET,client:{...EXEMPLE,denomination:'A <b>&</b> B'},date:'2026-11-14',numero:'DEV-2026-0001',conditions:CONDITIONS});
 assert.match(h,/<h1>Devis<\/h1><p>N° DEV-2026-0001<\/p>/);assert.match(h,/Bon pour accord/);assert.doesNotMatch(h,/en cours d’immatriculation/);
 assert.match(h,/SAS au capital de 1 000 € · SIREN 000000000 · RCS Toulouse/);
 assert.ok(h.includes('A &lt;b&gt;&amp;&lt;/b&gt; B'));
 assert.equal(PIED.devis(COMPLET,'DEV-2026-0001'),'Société Test · SIREN 000000000 · RCS Toulouse · Devis DEV-2026-0001');
});

test('the seller file stays empty: a local file completes it without touching it',()=>{
 const m=mergeVendeur(VENDEUR_VERSIONNE,{siren:'000000000',iban:'FR76 0000',tva:{regime:'franchise'}});
 assert.equal(m.siren,'000000000');assert.equal(m.iban,'FR76 0000');assert.equal(m.tva.regime,'franchise');assert.equal(m.tva.taux,20);
 assert.equal(VENDEUR_VERSIONNE.siren,'');
});

test('git: client files, the local seller file, outputs and the counter are ignored; the example is versioned',()=>{
 const ignored=(p:string)=>spawnSync('git',['check-ignore','-q',p],{cwd:root}).status===0;
 for(const p of ['commercial/clients/alexandre.json','commercial/clients/sajil.json','commercial/vendeur.local.json','commercial/sortie/x.pdf','commercial/.compteur-devis.json'])assert.ok(ignored(p),p);
 for(const p of ['commercial/clients/exemple.json','commercial/vendeur.json','commercial/conditions-veille.md','commercial/devis.ts'])assert.ok(!ignored(p),p);
 assert.ok(execFileSync('git',['ls-files','commercial/clients'],{cwd:root,encoding:'utf8'}).trim().split('\n').every(f=>f===''||f==='commercial/clients/exemple.json'));
});
