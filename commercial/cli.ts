// npm run devis -- --client <slug> [--mode proposition|devis] [--date AAAA-MM-JJ]
// Lit commercial/vendeur.json (+ vendeur.local.json, ignoré par git) et commercial/clients/<slug>.json (ignoré par git),
// écrit le PDF dans commercial/sortie/ (ignoré par git). En mode devis, refuse tant que le vendeur n'est pas identifiable,
// et n'incrémente le compteur (commercial/.compteur-devis.json, ignoré) qu'une fois le PDF produit.
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {clientIssues,devisRefusal,mergeVendeur,prochainNumero,renderHtml,PIED,esc,type Client,type Mode,type Vendeur} from './devis.ts';

const DIR=dirname(fileURLToPath(import.meta.url));
const arg=(k:string)=>{const i=process.argv.indexOf(`--${k}`);return i>0?process.argv[i+1]:undefined};
const fail=(msg:string):never=>{console.error(`Erreur : ${msg}`);process.exit(1)};
const slug=arg('client')??fail('indiquez --client <slug> (fichier commercial/clients/<slug>.json)');
if(!/^[a-z0-9-]{1,60}$/.test(slug))fail('slug invalide (minuscules, chiffres et tirets)');
const mode=(arg('mode')??'proposition') as Mode;
if(mode!=='proposition'&&mode!=='devis')fail('--mode doit valoir « proposition » ou « devis »');
const date=arg('date')??new Date().toISOString().slice(0,10);
if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('--date au format AAAA-MM-JJ');

const json=<T>(p:string):T=>JSON.parse(readFileSync(p,'utf8')) as T;
const local=join(DIR,'vendeur.local.json');
const vendeur:Vendeur=mergeVendeur(json<Vendeur>(join(DIR,'vendeur.json')),existsSync(local)?json<Partial<Vendeur>>(local):null);
const clientPath=join(DIR,'clients',`${slug}.json`);
if(!existsSync(clientPath))fail(`fichier client introuvable : commercial/clients/${slug}.json (copiez exemple.json)`);
const client=json<Client>(clientPath);
const issues=clientIssues(client);if(issues.length)fail(`fiche client incomplète : ${issues.join(', ')}`);

let numero:string|null=null;let compteur:Record<string,number>|null=null;
const compteurPath=join(DIR,'.compteur-devis.json');
if(mode==='devis'){
 const missing=devisRefusal(vendeur);
 if(missing.length)fail(`devis impossible, informations du vendeur manquantes : ${missing.join(', ')}.\nRenseignez-les dans commercial/vendeur.local.json, ou générez une proposition (--mode proposition).`);
 ({numero,compteur}=prochainNumero(existsSync(compteurPath)?json<Record<string,number>>(compteurPath):{},Number(date.slice(0,4))));
}

const html=renderHtml({mode,vendeur,client,date,numero,conditions:readFileSync(join(DIR,'conditions-veille.md'),'utf8')});
const out=join(DIR,'sortie');mkdirSync(out,{recursive:true});
const file=join(out,`${mode==='devis'?numero:`proposition-${slug}-${date}`}.pdf`);
const pied=mode==='devis'?PIED.devis(vendeur,numero!):PIED.proposition;
// Playwright (déjà présent dans l'environnement de développement) : chargé seulement ici, jamais par le site.
const {chromium}=createRequire(import.meta.url)('playwright') as {chromium:{launch():Promise<any>}};
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.setContent(html,{waitUntil:'load'});
 await page.pdf({path:file,format:'A4',printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',
  footerTemplate:`<div style="width:100%;font-size:7pt;color:#6b7090;padding:0 16mm;display:flex;justify-content:space-between;font-family:system-ui,sans-serif"><span>${esc(pied)}</span><span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
  margin:{top:'16mm',bottom:'20mm',left:'16mm',right:'16mm'}});
}finally{await browser.close()}
if(compteur)writeFileSync(compteurPath,JSON.stringify(compteur,null,1));
console.log(`${mode==='devis'?`Devis ${numero}`:'Proposition'} : ${file}`);
