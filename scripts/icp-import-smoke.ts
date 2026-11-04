// ICP import — real smoke test, run by an operator by hand (docs/ICP_IMPORT.md §Smoke test). One real structureIcp call
// on a local file (text, PDF or DOCX), printed: the profile, each value with its source and confidence, the missing
// questions, the real token usage and its cost. Nothing is written to icp_imports or any profile; nothing is sent.
//
// The same allow-list as the operator's other runs (docs/SELF_OUTREACH.md §8): the organization passed with --org must be
// in SELF_OUTREACH_ORG_IDS — ProspectOS's own organization, never a customer's. Its BYOK key is NOT used: the platform's
// own AI_PROVIDER / AI_MODEL / AI_API_KEY pay. When the server's Supabase variables are present, the cost is read from the
// pricing table (resolve_provider_cost); the run itself is not written to the cost ledger (it belongs to no user).
//
// Run:  node --experimental-strip-types scripts/icp-import-smoke.ts --org <uuid> [--show-raw] <file.txt|file.pdf|file.docx>
//   --show-raw: on a failure, print the model's raw answer of each call. For the public test documents of
//   tests/fixtures/icp/ only — this operator script is the one place that may show it; the application never does.
//   or, without a computer: GitHub → Actions → « ICP import smoke test » → Run workflow (.github/workflows/icp-import-smoke.yml).
import {readFile} from 'node:fs/promises';
import {ingestFile,ingestText,IngestError,INGEST_MESSAGES,sniff,type Ingested} from '../src/icp-import/ingest.ts';
import {structureIcp,StructureIcpError,ICP_MAX_TOKENS,type IcpUsage} from '../src/server/ai.ts';
import {missingQuestions} from '../src/domain/icp/missing.ts';
import {countByCategory} from '../src/domain/icp/normalize.ts';
import {selfOutreachOrganizations} from '../src/self-outreach/config.ts';

const args=process.argv.slice(2);
const at=args.indexOf('--org');const org=(at>=0?args[at+1]:'')?.trim().toLowerCase()??'';
const showRaw=args.includes('--show-raw');
const file=args.filter((a,i)=>a!=='--org'&&a!=='--show-raw'&&i!==at+1)[0];
const raws:string[]=[];
const stop=(message:string):never=>{console.error(message);process.exit(1)};
if(!file||!/^[0-9a-f-]{36}$/.test(org))stop('Usage : node --experimental-strip-types scripts/icp-import-smoke.ts --org <uuid> <fichier>');
if(!selfOutreachOrganizations(process.env).includes(org))stop('Refusé : cette organisation n’est pas dans SELF_OUTREACH_ORG_IDS (liste opérateur).');
if(!process.env.AI_PROVIDER||!process.env.AI_MODEL||!process.env.AI_API_KEY)stop('AI_PROVIDER, AI_MODEL et AI_API_KEY sont requis (clé de la plateforme).');

let ingested:Ingested;
try{
 const bytes=new Uint8Array(await readFile(file!));
 ingested=sniff(bytes)?await ingestFile(bytes):ingestText(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}catch(e){stop(e instanceof IngestError?`Fichier refusé (${e.code}) : ${INGEST_MESSAGES[e.code]}`:`Lecture impossible : ${(e as Error).message}`)}
console.log(`■ Document : ${ingested!.sourceType}, ${ingested!.text.length} caractères${ingested!.pages?`, ${ingested!.pages} pages lues`:''}${ingested!.warnings.length?`, avertissements ${ingested!.warnings.join(', ')}`:''}`);

async function cost(usage:IcpUsage){
 if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY){
  // Without the database (the GitHub Actions run): the tariff given by the operator, in USD per million tokens.
  const pin=Number(process.env.ICP_SMOKE_PRICE_INPUT_PER_MTOK),pout=Number(process.env.ICP_SMOKE_PRICE_OUTPUT_PER_MTOK);
  if(Number.isFinite(pin)&&pin>=0&&Number.isFinite(pout)&&pout>=0&&process.env.ICP_SMOKE_PRICE_INPUT_PER_MTOK&&process.env.ICP_SMOKE_PRICE_OUTPUT_PER_MTOK){
   const usd=(usage.input_tokens*pin+usage.output_tokens*pout)/1e6;
   console.log(`■ Coût : ${usd.toFixed(4)} $ au tarif fourni (${pin} $ / ${pout} $ par million de tokens en entrée / sortie), ${usage.attempts.length} appel(s)`);
  }else console.log('■ Coût : non calculé (ni variables Supabase ni tarif fourni — tokens ci-dessus)');
  return;
 }
 const [{createAdminClient},{resolveCost,costFromTokens}]=await Promise.all([import('../src/server/admin-client.ts'),import('../src/server/pricing.ts')]);
 let micros=0;let priced=true;
 for(const a of usage.attempts){
  if(a.input_tokens===null||a.output_tokens===null){priced=false;continue}
  const c=await resolveCost(createAdminClient(),usage.provider,'offer_analysis',usage.model,costFromTokens(a.input_tokens,a.output_tokens));
  if(c)micros+=c.estimatedCostMicros;else priced=false;
 }
 console.log(`■ Coût : ${priced?'':'au moins '}${(micros/1e6).toFixed(4)} $ (table de prix, ${usage.attempts.length} appel(s))`);
}

// The model actually configured for this run (AI_MODEL), shown before anything else.
console.log(`■ Modèle : ${process.env.AI_MODEL} (${process.env.AI_PROVIDER})`);
const started=Date.now();
try{
 const {profile,dropped,unverified,fixes,usage}=await structureIcp(ingested!.text,{onRaw:(n,raw)=>{raws[n-1]=raw}});
 console.log(`■ Réponse en ${((Date.now()-started)/1000).toFixed(1)} s, ${usage.attempts.length} appel(s), ${usage.input_tokens} tokens en entrée, ${usage.output_tokens} en sortie (par appel : ${usage.attempts.map(a=>`${a.input_tokens}/${a.output_tokens}`).join(', ')} ; plafond de sortie ${ICP_MAX_TOKENS}) (${usage.provider} ${usage.model})`);
 console.log('■ Valeurs extraites (confiance — valeur — source)');
 const walk=(n:unknown,path:string)=>{
  if(Array.isArray(n)){n.forEach((v,i)=>walk(v,`${path}[${i}]`));return}
  if(n&&typeof n==='object'){
   const o=n as Record<string,unknown>;
   if('confidence' in o&&'source' in o){if(o.value!==null)console.log(`  ${Number(o.confidence).toFixed(2)}  ${path} = ${JSON.stringify(o.value)}\n        « ${o.source} »`);return}
   for(const [k,v] of Object.entries(o))walk(v,path?`${path}.${k}`:k);
  }
 };
 walk(profile,'');
 const counts=countByCategory(fixes,unverified);
 console.log(`■ Décompte : ${counts.source_too_long} source(s) trop longue(s), ${counts.source_not_in_document} source(s) absente(s) du document, ${counts.value_too_long} valeur(s) trop longue(s), ${counts.ape_codes_ignored} segment(s) avec codes APE ignorés, ${counts.list_item_wrong_shape} élément(s) de liste mal enveloppé(s), ${counts.other} autre(s)`);
 if(fixes.length){console.log(`■ Corrections de normalisation (${fixes.length}) :`);for(const f of fixes)console.log(`  ${f.code}  ${f.path}  (${f.reason})${f.rule?` — ${f.rule}`:''}${f.excerpt!==undefined?`\n        « ${f.excerpt} »`:''}`)}
 else console.log('■ Aucune correction de normalisation.');
 const noSource=dropped.filter(d=>!unverified.includes(d));
 if(noSource.length)console.log(`■ Valeurs écartées faute de source : ${noSource.join(', ')}`);
 if(unverified.length)console.log(`■ Valeurs écartées, source absente du document : ${unverified.join(', ')}`);
 else console.log('■ Toutes les sources sont des passages du document.');
 console.log('■ Questions manquantes');for(const q of missingQuestions(profile,dropped))console.log(`  - ${q.question}`);
 console.log('■ Profil complet (brouillon, non enregistré)');console.log(JSON.stringify(profile,null,1));
 await cost(usage);
}catch(e){
 if(e instanceof StructureIcpError){const u=e.usage;const last=u?.attempts.at(-1)?.output_tokens??null;
  console.error(`■ Échec : ${e.code}${u?` — modèle ${u.model}, ${u.attempts.length} appel(s) facturé(s), ${u.input_tokens} tokens en entrée, ${u.output_tokens} en sortie${last!==null?` (dernier appel : ${last} en sortie / plafond ${ICP_MAX_TOKENS}${last>=ICP_MAX_TOKENS?' — sortie au plafond':''})`:''}`:''}`);
  if(showRaw)raws.forEach((raw,k)=>{console.error(`■ Réponse brute, appel ${k+1} (--show-raw, document de test public) :`);console.error(raw)});
  if(e.usage)await cost(e.usage);process.exit(2)}
 throw e;
}
