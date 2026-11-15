// npm run livraison -- --livraison <nom>
// Lit commercial/livraisons/<nom>.json (ignoré par git, sauf l'exemple) et écrit dans commercial/sortie/ :
//   <nom>.html, <nom>.pdf (le PDF envoyé au client, même gabarit que les listes déjà livrées),
//   <nom>.import.json (à joindre, avec le PDF, à « Nouvelle livraison » de l'espace de suivi).
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {renderHtml,toImport,issues,type Livraison} from './livraison.ts';
import {LIVRAISON_CSS} from './livraison-style.ts';
const DIR=dirname(fileURLToPath(import.meta.url));
const arg=(k:string)=>{const i=process.argv.indexOf(`--${k}`);return i>0?process.argv[i+1]:undefined};
const nom=arg('livraison');
if(!nom||!/^[a-z0-9-]{1,80}$/.test(nom)){console.error('Usage : npm run livraison -- --livraison <nom> (fichier commercial/livraisons/<nom>.json)');process.exit(2)}
const file=join(DIR,'livraisons',`${nom}.json`);
if(!existsSync(file)){console.error(`Fichier introuvable : ${file}`);process.exit(2)}
const l=JSON.parse(readFileSync(file,'utf8')) as Livraison;
const p=issues(l);if(p.length){console.error(`Livraison refusée :\n- ${p.join('\n- ')}`);process.exit(1)}
const out=join(DIR,'sortie');mkdirSync(out,{recursive:true});
const html=join(out,`${nom}.html`),pdf=join(out,`${nom}.pdf`);
writeFileSync(html,renderHtml(l,LIVRAISON_CSS));
const {chromium}=createRequire(import.meta.url)('playwright') as {chromium:{launch():Promise<any>}};
const b=await chromium.launch();
try{
 const page=await b.newPage();await page.goto(pathToFileURL(html).href,{waitUntil:'load'});
 const opts={path:pdf,format:'A4',printBackground:true,preferCSSPageSize:true};
 try{await page.pdf({...opts,outline:true,tagged:true})}catch{await page.pdf(opts)}
}finally{await b.close()}
const imp=toImport(l);
writeFileSync(join(out,`${nom}.import.json`),JSON.stringify(imp,null,1));
const sha=createHash('sha256').update(readFileSync(pdf)).digest('hex');
console.log(`PDF : ${pdf}\nImport : ${join(out,`${nom}.import.json`)}\n${imp.items.length} fiches · SHA-256 du PDF ${sha}`);
