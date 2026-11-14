// Propositions et devis de la veille dédiée (commercial/). Règles : aucun identifiant légal inventé, pas de devis tant que
// le vendeur n'est pas identifiable, numérotation sans trou ni doublon, mentions de paiement B2B, aucune donnée client dans git.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {ajouterMois,calcul,clientIssues,devisRefusal,mergeVendeur,prochainNumero,renderHtml,PIED,type Client,type Vendeur} from '../commercial/devis.ts';

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
  'Aucun volume de fiches n’est garanti','TVA non applicable, art. 293 B du CGI','Total TTC','chaque lundi','Période d’essai offerte, hors engagement',
  'Conditions particulières de la veille dédiée','préavis de 30 jours','Licence d','tribunal de commerce de Toulouse','12 derniers mois','nom et la qualité des dirigeants',
  'Formule choisie','Mensuelle : sans durée minimale','Fin de la première période'])
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

// ------------------------------------------------------------------ cas demandés explicitement (point 5 du cahier des charges)
test('devis refused when ONLY the SIREN is empty, from the command line too',()=>{
 assert.deepEqual(devisRefusal({...COMPLET,siren:''}),['SIREN']);
 assert.deepEqual(devisRefusal({...COMPLET,siren:'   '}),['SIREN']);
});


test('no data from exemple.json outside commercial/, and the generator is not part of the application build',()=>{
 const ex=JSON.parse(read('commercial/clients/exemple.json')) as Client;
 const needles=[ex.denomination,ex.adresse,ex.contact.nom];
 const files=execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'}).split('\n').filter(f=>f&&!f.startsWith('commercial/')&&/\.(ts|tsx|mjs|js|json|md|sql|txt|css|html)$/.test(f));
 assert.ok(files.length>100);
 for(const f of files){const t=read(f);for(const n of needles)assert.ok(!t.includes(n),`${f} contains « ${n} » from exemple.json`)}
 for(const f of files.filter(f=>/^(app|src)\//.test(f)))assert.doesNotMatch(read(f),/from ['"][^'"]*commercial\/|require\(['"][^'"]*commercial\//,`${f} imports the generator`);
 const pkg=JSON.parse(read('package.json')) as {scripts:Record<string,string>};
 assert.equal(pkg.scripts.devis,'node --experimental-strip-types commercial/cli.ts');
 for(const k of ['build','start','dev'])assert.doesNotMatch(pkg.scripts[k]??'',/commercial|devis/,k);
});

// ------------------------------------------------------------------ remises exclusives : essai avant le contrat, puis formule
const DEUX={...EXEMPLE,regions:['Île-de-France','Occitanie'],prix_ht_par_region_par_mois:149,essai_mois:1,date_debut:'2026-12-01'};
test('monthly, 2 regions, with a trial: trial 0 € before the start date, then 298 € per month',()=>{
 const t=calcul({...DEUX,engagement:'mensuel',nombre_mois:1},COMPLET);
 assert.deepEqual(t.lignes.map(l=>[l.libelle,l.quantite,l.unitaire,l.montant]),[
  ['Période d’essai offerte, hors engagement — Île-de-France, Occitanie',1,0,0],
  ['Veille dédiée — Île-de-France',1,14900,14900],['Veille dédiée — Occitanie',1,14900,14900]]);
 assert.equal(t.lignes[0]!.periode,'du 1er novembre 2026 au 30 novembre 2026','the trial is dated BEFORE date_debut');
 assert.deepEqual(t.essai,{debut:'2026-11-01',fin:'2026-11-30'});
 assert.equal(t.totalHT,29800);assert.ok(t.lignes.every(l=>l.montant>=0),'no discount inside the billed period');
 assert.deepEqual(t.engagement,{formule:'Mensuelle : sans durée minimale, reconduite chaque mois',debut:'2026-12-01',fin:'2026-12-31',moisFactures:1});
 assert.equal(calcul({...DEUX,engagement:'mensuel',nombre_mois:3},COMPLET).totalHT,89400,'3 billed months, the trial does not reduce them');
});
test('annual, 2 regions, with a trial: trial 0 €, then 2 980 € HT for 12 months from the start date',()=>{
 const t=calcul({...DEUX,engagement:'annuel'},COMPLET);
 assert.deepEqual(t.lignes.map(l=>[l.libelle,l.montant]),[['Période d’essai offerte, hors engagement — Île-de-France, Occitanie',0],
  ['Veille dédiée — Île-de-France',178800],['Veille dédiée — Occitanie',178800],['Formule annuelle : 12 mois facturés 10',-59600]]);
 assert.equal(t.totalHT,298000);
 assert.deepEqual(t.engagement,{formule:'Annuelle : engagement ferme de 12 mois, 12 mois facturés 10',debut:'2026-12-01',fin:'2027-11-30',moisFactures:10});
 assert.equal(calcul({...DEUX,engagement:'annuel',essai_mois:0},COMPLET).totalHT,298000,'the trial never changes the annual price');
 assert.ok(t.lignes.filter(l=>l.montant<0).length===1,'one discount only inside the contract');
});
test('a cumulation of discounts is refused: generation fails',()=>{
 for(const engagement of ['annuel','mensuel'] as const){
  const cumul={...DEUX,engagement,mois_offerts:1};
  assert.match(clientIssues(cumul).join(' '),/cumul de remises interdit/);
  assert.throws(()=>calcul(cumul,COMPLET),/CUMUL_INTERDIT/);
  assert.throws(()=>renderHtml({mode:'proposition',vendeur:VENDEUR_VERSIONNE,client:cumul,date:'2026-11-14',conditions:CONDITIONS}),/CUMUL_INTERDIT/);
 }
 assert.ok(clientIssues({...DEUX,essai_mois:-1}).some(x=>x.startsWith('essai_mois')));
 assert.equal('mois_offerts' in EXEMPLE,false,'the example uses the trial, not a discount');
});
test('VAT: franchise mention or 20 % on the amount after the trial',()=>{
 const f=calcul({...DEUX,engagement:'mensuel'},COMPLET);assert.equal(f.mentionTva,'TVA non applicable, art. 293 B du CGI');assert.equal(f.totalTTC,29800);
 const a=calcul({...DEUX,engagement:'annuel'},{...COMPLET,tva:{regime:'assujetti',numero:'FR00000000000',taux:20}});
 assert.equal(a.mentionTva,null);assert.equal(a.tva,59600);assert.equal(a.totalTTC,357600);
});
test('dates: months added with the day clamped, contract end the day before the anniversary',()=>{
 assert.equal(ajouterMois('2026-01-31',1),'2026-02-28');assert.equal(ajouterMois('2026-12-01',-1),'2026-11-01');assert.equal(ajouterMois('2026-12-01',12),'2027-12-01');
});
test('annex and quote: monthly free to leave with 30 days notice; annual firm 12 months, serious breach after 15 days, tacit 12-month renewal',()=>{
 for(const piece of ['Période d\'essai : lorsque le devis en prévoit une, elle précède le contrat. Elle est offerte, n\'est pas facturée et n\'engage pas le client.',
  'Le client peut le résilier à tout moment, par écrit (e-mail compris), avec un préavis de 30 jours, sans frais.',
  'durée ferme de 12 mois','Il ne peut pas être résilié avant son terme, sauf manquement grave du vendeur à ses obligations, non corrigé dans les 15 jours suivant une mise en demeure écrite.',
  'il se renouvelle automatiquement pour une nouvelle période de 12 mois, sauf résiliation par écrit au plus tard 30 jours avant l\'échéance'])
  assert.ok(CONDITIONS.includes(piece),piece);
 const h=renderHtml({mode:'devis',vendeur:COMPLET,client:{...DEUX,engagement:'annuel'},date:'2026-11-14',numero:'DEV-2026-0001',conditions:CONDITIONS});
 assert.match(h,/Formule choisie<\/td><td><b>Annuelle : engagement ferme de 12 mois, 12 mois facturés 10<\/b>/);
 assert.match(h,/Fin de l’engagement<\/td><td><b>30 novembre 2027<\/b> — puis reconduction tacite par période de 12 mois/);
 assert.match(h,/Période d’essai<\/td><td>Du 1er novembre 2026 au 30 novembre 2026 : offerte, hors engagement/);
});
