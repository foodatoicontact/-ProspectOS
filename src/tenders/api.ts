// GET /api/v1/tenders?keywords=…&departments=… — open public tenders from the BOAMP (boamp.ts), behind the
// TENDERS_ENABLED switch (off by default: the route answers 404 TENDERS_DISABLED before reading anything). An active
// entitlement is required; no quota unit is consumed (no AI, free official source) and nothing is written: the list is
// read-only, each line links to its official notice. docs/TENDERS.md.
import {parseTenderQuery,searchOpenTenders,TendersError,BOAMP_PROVENANCE,MAX_KEYWORDS,MAX_DEPARTMENTS} from './boamp.ts';

type Json=(data:unknown,status?:number)=>Response;
export const TENDERS_DISABLED='TENDERS_DISABLED';
export function tendersEnabled(env:Record<string,string|undefined>):boolean{
 const v=(env.TENDERS_ENABLED??'').trim().toLowerCase();
 return v==='true'||v==='1';
}
export type TendersDeps={enabled:boolean;requireEntitlement:()=>Promise<unknown>;fetch?:typeof fetch;now?:()=>Date;log?:(e:Record<string,string|number>)=>void};

const REFUSALS:Record<string,[string,number]>={
 KEYWORDS_REQUIRED:['Indiquez au moins un mot-clé (ex. « nettoyage façade »).',400],
 TOO_MANY_KEYWORDS:[`${MAX_KEYWORDS} mots-clés au maximum.`,400],
 KEYWORD_TOO_GENERIC:['Un mot-clé ne peut pas être fait que de petits mots (de, la, le, des, en, et…) : ajoutez un mot qui décrit le marché.',400],
 KEYWORD_INVALID:['Un mot-clé ne peut contenir que des lettres, des chiffres, des espaces, des apostrophes et des tirets (2 à 60 caractères).',400],
 DEPARTMENTS_REQUIRED:['Indiquez au moins un département (ex. 33).',400],
 TOO_MANY_DEPARTMENTS:[`${MAX_DEPARTMENTS} départements au maximum.`,400],
 DEPARTMENT_INVALID:['Département inconnu : utilisez son numéro (ex. 33, 2A, 974).',400],
 TENDERS_UNAVAILABLE:['Le BOAMP ne répond pas pour le moment. Réessayez dans un instant.',503],
};

export async function handleTenders(request:Request,path:string[],json:Json,deps:TendersDeps):Promise<Response|null>{
 if(path[0]!=='tenders')return null;
 if(!deps.enabled)return json({error:'Route ou action non disponible',code:TENDERS_DISABLED},404);
 if(path.length!==1||request.method!=='GET')return json({error:'Route ou action non disponible'},404);
 await deps.requireEntitlement();
 const url=new URL(request.url);
 try{
  const query=parseTenderQuery(url.searchParams.get('keywords')??'',url.searchParams.get('departments')??'');
  const {tenders,total,truncated}=await searchOpenTenders(query,{fetch:deps.fetch,now:deps.now?.()});
  deps.log?.({component:'tenders',event:'search',keywords:query.keywords.length,departments:query.departments.length,results:tenders.length});
  return json({tenders,total,truncated,query,provenance:BOAMP_PROVENANCE});
 }catch(e){
  if(!(e instanceof TendersError))throw e;
  const r=REFUSALS[e.message];if(!r)throw e;
  if(e.message==='TENDERS_UNAVAILABLE')deps.log?.({component:'tenders',event:'unavailable'});
  return json({error:r[0],code:e.message},r[1]);
 }
}
