// Public registers of a prospect already in the list: the company register (API Recherche d'entreprises — INSEE Sirene
// and RNE, annuaire-entreprises.data.gouv.fr) and the public procurement awards (Données essentielles de la commande
// publique, consolidated on data.gouv.fr). Both Licence Ouverte 2.0. Evidence-first, like the website analysis:
//  - the company is identified by its SIREN — given by the person, read back from an earlier identification, or found
//    by an EXACT name match that leaves no doubt; anything else answers with candidates and a person chooses;
//  - every fact becomes an observation quoting the register's own fields, linked to the ICP criterion whose intent
//    names it (icp-intents.ts: headcount, public procurement, public reference, decision maker) or kept as context;
//  - nothing is VERIFIED here: each proposal waits for a human, exactly as a page excerpt does.
// Personal data: a non-diffusible company (statut_diffusion other than "O") yields neither its executives nor its
// address; an executive's date of birth is never read. Only fixed hosts are called, with bounded size and time.
import {createHash} from 'node:crypto';
import type {Criterion} from '../domain/core.ts';
import {ObservationSchema,type Observation} from './types.ts';
import {intentsForLabel,labelRange,normText} from './strategies/icp-intents.ts';
import {EMPLOYEE_BANDS} from './registry/admission.ts';
import {DEPARTMENTS} from './geo-fr.ts';

export const SIRENE_SEARCH='https://recherche-entreprises.api.gouv.fr/search';
export const SIRENE_PAGE=(siren:string)=>`https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`;
// DECP consolidées (data.gouv.fr dataset 608c055b35eb4e6ee20eb325, resource decp.csv) served by the tabular API. The
// resource is re-published regularly; when its id stops answering, it is looked up again from the dataset.
export const DECP_DATASET='https://www.data.gouv.fr/api/1/datasets/608c055b35eb4e6ee20eb325/';
export const DECP_RESOURCE_DEFAULT='22847056-61df-452d-837d-8b8ceadbfc52';
export const DECP_ROWS=(resource:string)=>`https://tabular-api.data.gouv.fr/api/resources/${resource}/data/`;
const SIRENE_TITLE='Registre des entreprises (INSEE Sirene / RNE)';
const DECP_TITLE='Données essentielles de la commande publique (data.gouv.fr)';
// The procurement API filters an unindexed column slowly: only the indexed exact SIRET is queried, with more time.
const REQUEST_TIMEOUT_MS=10000,DECP_TIMEOUT_MS=25000,MAX_RESPONSE_BYTES=2_000_000,DECP_PAGE=50,DECP_YEARS=5,AWARDS_PER_CRITERION=3,EXECUTIVES=2,CANDIDATES=5;
export const SIREN=/^\d{9}$/;

export class PublicRecordsError extends Error{candidates:RegistryCandidate[];constructor(code:string,candidates:RegistryCandidate[]=[]){super(code);this.candidates=candidates}}
export type RegistryCandidate={siren:string;name:string;city:string|null;naf:string|null};
type Fetch=typeof fetch;
type SireneDirigeant={type_dirigeant?:string|null;nom?:string|null;prenoms?:string|null;qualite?:string|null};
export type SireneCompany={siren:string;nom_complet?:string|null;nom_raison_sociale?:string|null;sigle?:string|null;statut_diffusion?:string|null;
 etat_administratif?:string|null;activite_principale?:string|null;date_creation?:string|null;tranche_effectif_salarie?:string|null;annee_tranche_effectif_salarie?:string|null;
 dirigeants?:SireneDirigeant[]|null;siege?:{siret?:string|null;adresse?:string|null;libelle_commune?:string|null;departement?:string|null;liste_enseignes?:string[]|null;nom_commercial?:string|null}|null};
export type DecpRow={uid?:string|null;titulaire_id?:string|null;titulaire_typeIdentifiant?:string|null;titulaire_nom?:string|null;acheteur_nom?:string|null;
 objet?:string|null;procedure?:string|null;dateNotification?:string|null;donneesActuelles?:boolean|null};

async function getJson(url:string,fetchImpl:Fetch,timeoutMs=REQUEST_TIMEOUT_MS):Promise<unknown>{
 let res:Response;
 try{res=await fetchImpl(url,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)})}catch{throw new PublicRecordsError('PUBLIC_RECORDS_UNAVAILABLE')}
 if(res.status===404)throw new PublicRecordsError('NOT_FOUND');
 if(!res.ok)throw new PublicRecordsError('PUBLIC_RECORDS_UNAVAILABLE');
 const reader=res.body?.getReader();if(!reader)throw new PublicRecordsError('PUBLIC_RECORDS_UNAVAILABLE');
 let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_RESPONSE_BYTES)throw new PublicRecordsError('PUBLIC_RECORDS_UNAVAILABLE');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw new PublicRecordsError('PUBLIC_RECORDS_UNAVAILABLE')}
}
// An answer without its results list is an unavailable register, never "no company".
const results=(data:unknown):SireneCompany[]=>{const r=(data as {results?:unknown})?.results;if(!Array.isArray(r))throw new PublicRecordsError('PUBLIC_RECORDS_UNAVAILABLE');return r.filter((c):c is SireneCompany=>!!c&&typeof (c as SireneCompany).siren==='string'&&SIREN.test((c as SireneCompany).siren))};
const nameOf=(c:SireneCompany)=>(c.nom_raison_sociale||c.nom_complet||c.siren).trim();
const candidateOf=(c:SireneCompany):RegistryCandidate=>({siren:c.siren,name:nameOf(c),city:c.statut_diffusion==='O'?c.siege?.libelle_commune??null:null,naf:c.activite_principale??null});
// Legal-form words never decide an identity: "SA La Garonne" is the same name as "SOC LA GARONNE" only to a person.
const LEGAL=/^(?:sa|sas|sasu|sarl|eurl|sci|scop|snc|soc|societe|ste|ets|etablissements|groupe)\s+|\s+(?:sa|sas|sasu|sarl|eurl|sci|scop|snc)$/g;
export const comparableName=(s:string)=>normText(s).replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim().replace(LEGAL,'').trim();
function namesOf(c:SireneCompany):string[]{return [c.nom_raison_sociale,c.nom_complet,c.sigle,c.siege?.nom_commercial,...(c.siege?.liste_enseignes??[])].filter((v):v is string=>!!v?.trim()).map(comparableName)}

// The SIREN of the prospect: the one given, else the one an earlier identification recorded, else a name match
// that is exact (legal form aside), unique, and in the prospect's city when one is known. Never a best guess.
export async function resolveCompany(input:{name:string;city:string|null;siren?:string|null;knownSiren?:string|null},fetchImpl:Fetch):Promise<SireneCompany>{
 const wanted=input.siren??input.knownSiren??null;
 if(wanted){
  if(!SIREN.test(wanted))throw new PublicRecordsError('INVALID_SIREN');
  const url=new URL(SIRENE_SEARCH);url.searchParams.set('q',wanted);url.searchParams.set('per_page','1');
  const hit=results(await getJson(url.href,fetchImpl)).find(c=>c.siren===wanted);
  if(!hit)throw new PublicRecordsError('COMPANY_NOT_FOUND');
  return hit;
 }
 const q=input.name.trim().slice(0,120);if(!q)throw new PublicRecordsError('REGISTRY_IDENTITY_REQUIRED');
 const url=new URL(SIRENE_SEARCH);url.searchParams.set('q',q);url.searchParams.set('per_page','10');url.searchParams.set('etat_administratif','A');
 const found=results(await getJson(url.href,fetchImpl));
 const target=comparableName(q),city=input.city?normText(input.city):'';
 const exact=found.filter(c=>target&&namesOf(c).includes(target)&&(!city||normText(c.siege?.libelle_commune??'')===city));
 if(exact.length===1)return exact[0];
 throw new PublicRecordsError('REGISTRY_IDENTITY_REQUIRED',(exact.length?exact:found).slice(0,CANDIDATES).map(candidateOf));
}

// Public procurement awards held by the company's head office (titulaire_id is that SIRET; its 9 first digits must be
// the SIREN). Awards held by another establishment of the company are not read (the API only filters the exact SIRET
// fast enough). Several rows of one contract (amendments, re-publications) count once: the current one, by uid.
export async function fetchAwards(siren:string,siret:string,fetchImpl:Fetch,now=new Date()):Promise<{rows:DecpRow[];url:string}>{
 if(!SIREN.test(siren)||!/^\d{14}$/.test(siret)||!siret.startsWith(siren))throw new PublicRecordsError('PUBLIC_RECORDS_UNAVAILABLE');
 const query=(resource:string)=>{const u=new URL(DECP_ROWS(resource));u.searchParams.set('titulaire_id__exact',siret);u.searchParams.set('dateNotification__sort','desc');u.searchParams.set('page_size',String(DECP_PAGE));return u.href};
 let url=query(DECP_RESOURCE_DEFAULT),data:unknown;
 try{data=await getJson(url,fetchImpl,DECP_TIMEOUT_MS)}catch(e){
  if(!(e instanceof PublicRecordsError&&e.message==='NOT_FOUND'))throw e;
  const ds=await getJson(DECP_DATASET,fetchImpl) as {resources?:Array<{id?:string;title?:string;format?:string}>};
  const resource=ds.resources?.find(r=>r.title==='decp.csv'&&r.format==='csv')?.id;
  if(!resource||!/^[0-9a-f-]{36}$/.test(resource))throw new PublicRecordsError('PUBLIC_RECORDS_UNAVAILABLE');
  url=query(resource);data=await getJson(url,fetchImpl,DECP_TIMEOUT_MS);
 }
 // An answer without its rows is not "no contract": it is an unavailable source (never reported as zero awards).
 const raw=(data as {data?:unknown})?.data;if(!Array.isArray(raw))throw new PublicRecordsError('PUBLIC_RECORDS_UNAVAILABLE');const since=new Date(now);since.setFullYear(since.getFullYear()-DECP_YEARS);
 const byUid=new Map<string,DecpRow>();
 for(const r of raw as DecpRow[]){
  const id=(r.titulaire_id??'').replace(/\s/g,'');
  if(!id.startsWith(siren)||!/^\d{9}(\d{5})?$/.test(id)||!r.uid||!r.dateNotification||!r.acheteur_nom||!r.objet)continue;
  if(!(new Date(r.dateNotification)>=since))continue;
  const prev=byUid.get(r.uid);if(!prev||(r.donneesActuelles&&!prev.donneesActuelles)||(r.dateNotification>(prev.dateNotification??'')))byUid.set(r.uid,r);
 }
 // One contract can also be published by two entities of the same buyer ("COMMUNE DE MURET (MAIRIE)" and
 // "… (ASSAINISSEMENT)"): the same object counts once, its latest notification kept.
 const byObject=new Map<string,DecpRow>();
 for(const r of [...byUid.values()].sort((a,b)=>(b.dateNotification??'').localeCompare(a.dateNotification??'')))if(!byObject.has(normText(r.objet!)))byObject.set(normText(r.objet!),r);
 return {rows:[...byObject.values()],url};
}

const clip=(s:string,n:number)=>s.length<=n?s:s.slice(0,n-1).trimEnd()+'…';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const short=(s:string)=>hash(s).slice(0,12);
const department=(code:string|null|undefined)=>DEPARTMENTS.find(d=>d.code===code);
const withIntent=(criteria:Criterion[],id:string)=>criteria.filter(c=>intentsForLabel(c.label).some(i=>i.id===id));
// Executives a decision-maker criterion can use: natural persons holding a management office (a board member or an
// auditor is not one), highest office first.
const OFFICE=[/president(?! du conseil de surveillance)/,/gerant/,/directeur general/,/directrice generale/,/president du conseil/,/directeur|directrice/];
const officeRank=(q:string)=>{const n=normText(q);const i=OFFICE.findIndex(r=>r.test(n));return i<0?OFFICE.length:i};

export function registryObservations(company:SireneCompany,awards:{rows:DecpRow[];url:string},criteria:Criterion[],now=new Date()):Observation[]{
 const collected=now.toISOString(),expires=new Date(+now+90*86400000).toISOString();
 const diffusible=company.statut_diffusion==='O';
 const make=(source:'sirene'|'decp',type:string,criterion:string|null,value:boolean|null,excerpt:string,claim:string,confidence:number)=>ObservationSchema.parse({
  criterion,observation_type:clip(type,60),claim:clip(claim,1000),value,status:'OBSERVED',source_url:source==='sirene'?SIRENE_PAGE(company.siren):awards.url,
  source_title:source==='sirene'?SIRENE_TITLE:DECP_TITLE,source_excerpt:clip(excerpt,500),source_type:'public_directory',confidence,collected_at:collected,expires_at:expires,content_hash:hash(`${type}|${excerpt}`).slice(0,64)});
 const out:Observation[]=[];
 const dep=department(company.siege?.departement);
 // Identity (context): what the register says this company is. The SIREN is read back from this row's source URL.
 const identity=[nameOf(company),`SIREN ${company.siren}`,company.etat_administratif==='A'?'entreprise active':'entreprise cessée',
  company.activite_principale?`activité principale (NAF) ${company.activite_principale}`:'',company.date_creation?`créée le ${company.date_creation}`:''].filter(Boolean).join(' · ');
 out.push(make('sirene','REGISTRY_IDENTITY',null,null,identity,'Identité au registre des entreprises',.9));
 if(diffusible&&company.siege?.adresse)out.push(make('sirene','REGISTRY_HEADQUARTERS',null,null,`Siège : ${company.siege.adresse}${dep?` (${dep.name}, ${dep.region})`:''}`,'Adresse du siège au registre',.9));
 // Headcount: the INSEE band, compared WHOLE to the range the criterion states. Inside → met; outside → not met;
 // straddling the range, unknown band or no range → context only (never decided from half a band).
 const band=EMPLOYEE_BANDS[company.tranche_effectif_salarie??''];
 if(band&&band[1]>0){
  const excerpt=`Tranche d'effectif salarié (INSEE${company.annee_tranche_effectif_salarie?`, ${company.annee_tranche_effectif_salarie}`:''}) : ${band[0]===band[1]?band[0]:`${band[0]} à ${band[1]}`} salariés`;
  const targets=withIntent(criteria,'HEADCOUNT');let placed=false;
  for(const c of targets){
   const range=labelRange(normText(c.label));if(!range)continue;
   const inside=band[0]>=range.min&&band[1]<=range.max,outside=band[1]<range.min||band[0]>range.max;
   if(!inside&&!outside)continue;
   out.push(make('sirene',`REGISTRY_HEADCOUNT:${c.key}`,c.key,inside,excerpt,inside?'Effectif au registre dans la fourchette du critère':'Effectif au registre hors de la fourchette du critère',.8));placed=true;
  }
  if(!placed)out.push(make('sirene','REGISTRY_HEADCOUNT',null,null,excerpt,'Effectif au registre',.8));
 }
 // Executives (diffusible companies only; natural persons; the date of birth is never read).
 if(diffusible){
  const people=(company.dirigeants??[]).filter(d=>d.type_dirigeant==='personne physique'&&d.nom&&d.qualite&&officeRank(d.qualite)<OFFICE.length).sort((a,b)=>officeRank(a.qualite!)-officeRank(b.qualite!)).slice(0,EXECUTIVES);
  const targets=withIntent(criteria,'DECISION_MAKER');
  for(const d of people){
   const excerpt=`${d.qualite} : ${[d.prenoms,d.nom].filter(Boolean).join(' ')}`;
   if(targets.length)for(const c of targets)out.push(make('sirene',`REGISTRY_EXECUTIVE:${c.key}:${short(excerpt)}`,c.key,true,excerpt,'Dirigeant inscrit au registre des entreprises',.7));
   else out.push(make('sirene',`REGISTRY_EXECUTIVE:${short(excerpt)}`,null,null,excerpt,'Dirigeant inscrit au registre des entreprises',.7));
  }
 }
 // Public procurement: each award is a dated, official fact. A criterion about tenders gets the latest awards; a
 // criterion about public references gets the latest award of each distinct buyer. The amount is never quoted (it is
 // the whole contract's, often shared between several holders or lots).
 const award=(r:DecpRow)=>`Marché public notifié le ${r.dateNotification} · acheteur : ${r.acheteur_nom} · objet : ${r.objet}${r.procedure?` · procédure : ${r.procedure}`:''} · titulaire : ${r.titulaire_nom??nameOf(company)} (${r.titulaire_typeIdentifiant??'SIRET'} ${r.titulaire_id})`;
 const tenders=withIntent(criteria,'PUBLIC_PROCUREMENT'),references=withIntent(criteria,'PUBLIC_REFERENCE');
 for(const c of tenders)for(const r of awards.rows.slice(0,AWARDS_PER_CRITERION))out.push(make('decp',`DECP_AWARD:${c.key}:${short(r.uid!)}`,c.key,true,award(r),'Marché public attribué à cette entreprise (données officielles de la commande publique)',.85));
 const buyers=new Map<string,DecpRow>();for(const r of awards.rows)if(!buyers.has(normText(r.acheteur_nom!)))buyers.set(normText(r.acheteur_nom!),r);
 for(const c of references)for(const r of [...buyers.values()].slice(0,AWARDS_PER_CRITERION))out.push(make('decp',`DECP_BUYER:${c.key}:${short(r.uid!)}`,c.key,true,award(r),'Référence avec un acheteur public : marché attribué (données officielles de la commande publique)',.85));
 if(awards.rows.length){
  const last=awards.rows[0],first=awards.rows[awards.rows.length-1];
  out.push(make('decp','DECP_SUMMARY',null,null,`${awards.rows.length} marché${awards.rows.length>1?'s':''} public${awards.rows.length>1?'s':''} distinct${awards.rows.length>1?'s':''} attribué${awards.rows.length>1?'s':''} au SIRET du siège entre le ${first.dateNotification} et le ${last.dateNotification}, auprès de ${buyers.size} acheteur${buyers.size>1?'s':''} public${buyers.size>1?'s':''}`,'Historique des marchés publics',.85));
 }
 return out;
}

// The SIREN an earlier identification of this prospect recorded (the identity row's own source URL). Two different
// SIRENs recorded (the person chose another company since) are not decided here: the person is asked again.
export function knownSirenOf(observations:Array<{observation_type:string;source_url:string}>):string|null{
 const prefix=SIRENE_PAGE('');
 const sirens=new Set(observations.filter(o=>o.observation_type==='REGISTRY_IDENTITY'&&o.source_url.startsWith(prefix)).map(o=>o.source_url.slice(prefix.length)).filter(s=>SIREN.test(s)));
 return sirens.size===1?[...sirens][0]:null;
}

export type PublicRecordsRepository={
 prospectIdentity(id:string):Promise<{id:string;project_id:string;name:string;city:string|null}>;
 storedObservations(id:string):Promise<Array<{observation_type:string;source_url:string}>>;
 projectCriteria(projectId:string):Promise<Criterion[]>;
 consumeAnalysis(id:string):Promise<void>;
 saveObservations(id:string,observations:Observation[]):Promise<unknown[]>;
 // Fills the prospect's city only while it is still empty (the repository's own condition): never overwrites one.
 fillProspectCity?(id:string,city:string):Promise<void>;
};
// The town the card may show from the register: the headquarters' commune, with its department, for a company whose
// data is public (statut_diffusion 'O') only — a non-diffusible company's address is never shown (GDPR).
export function registryCity(company:SireneCompany):string|null{
 if(company.statut_diffusion!=='O')return null;
 const commune=(company.siege?.libelle_commune??'').replace(/\s+/g,' ').trim();if(commune.length<2||commune.length>80)return null;
 const dep=department(company.siege?.departement);
 return dep?`${commune} (${dep.name})`:commune;
}
// Identify, then read both registers, then save. The plan unit is reserved only once the company is identified
// (a question back to the person costs nothing); a register that fails after that releases it (route: releaseOnFailure).
// The procurement data is optional: when it cannot be read, the company register's facts are still saved.
export async function enrichFromPublicRecords(d:{repo:PublicRecordsRepository;prospectId:string;siren?:string|null;fetch?:Fetch;now?:Date;log?:(e:Record<string,string|number|null>)=>void}){
 const fetchImpl=d.fetch??fetch,now=d.now??new Date(),start=Date.now();
 const p=await d.repo.prospectIdentity(d.prospectId);
 const known=d.siren?null:knownSirenOf(await d.repo.storedObservations(d.prospectId));
 const company=await resolveCompany({name:p.name,city:p.city,siren:d.siren,knownSiren:known},fetchImpl);
 const criteria=await d.repo.projectCriteria(p.project_id);
 await d.repo.consumeAnalysis(d.prospectId);
 let awards={rows:[] as DecpRow[],url:DECP_ROWS(DECP_RESOURCE_DEFAULT)},procurement:'ok'|'unavailable'='ok';
 const siret=company.siege?.siret??'';
 if(/^\d{14}$/.test(siret))try{awards=await fetchAwards(company.siren,siret,fetchImpl,now)}catch{procurement='unavailable'}
 else procurement='unavailable';
 const observations=registryObservations(company,awards,criteria,now);
 const saved=await d.repo.saveObservations(d.prospectId,observations);
 // "Localisation à confirmer" on a card whose own site publishes no full postal address: the identified company's
 // headquarters commune (the REGISTRY_HEADQUARTERS row just saved is its source). Best effort, empty city only.
 const city=!p.city?.trim()?registryCity(company):null;let cityFilled=0;
 if(city&&d.repo.fillProspectCity){try{await d.repo.fillProspectCity(d.prospectId,city);cityFilled=1}catch{/* The facts are saved; the card keeps "à confirmer". */}}
 d.log?.({provider:'public_records',duration_ms:Date.now()-start,observations:observations.length,awards:awards.rows.length,procurement,city_filled:cityFilled});
 return {company:candidateOf(company),observations:saved,awards:awards.rows.length,procurement};
}
