// « Appels d'offres ouverts » — the panel's pure logic and texts (FR/EN), shared by the component and its tests.
import type {Locale} from '../i18n/locale.ts';
import type {Tender} from './boamp.ts';

export type TendersAnswer={tenders:Tender[];total:number;query:{keywords:string[];departments:string[]}};
export type ApiResult<T>={ok:true;data:T}|{ok:false;status:number;code?:string;error?:string};
type Fetcher=(input:string,init?:RequestInit)=>Promise<Response>;

export function tendersClient(token:string,fetcher:Fetcher=(i,init)=>fetch(i,init)){
 async function call<T>(query:string):Promise<ApiResult<T>>{
  let res:Response;
  try{res=await fetcher(`/api/v1/tenders${query}`,{headers:{Authorization:`Bearer ${token}`}})}catch{return {ok:false,status:0,code:'NETWORK'}}
  let data:unknown=null;try{data=await res.json()}catch{/* empty or not JSON */}
  if(res.ok)return {ok:true,data:data as T};
  const d=(data??{}) as {code?:string;error?:string};return {ok:false,status:res.status,code:d.code,error:d.error};
 }
 return {
  // No parameter: answers 404 TENDERS_DISABLED when the switch is off, 400 when it is on — the BOAMP is not called.
  probe:()=>call<never>(''),
  search:(keywords:string,departments:string)=>call<TendersAnswer>(`?${new URLSearchParams({keywords,departments})}`),
 };
}
// The panel exists only when the server says the feature is on (a 400 to the empty probe); never on 404 or a network error.
export const panelEnabled=(r:ApiResult<never>)=>!r.ok&&r.status===400;

const DAY=86_400_000;
export function daysLeft(deadline:string,now:number):number{return Math.max(0,Math.ceil((new Date(deadline).getTime()-now)/DAY))}
export function deadlineText(locale:Locale,deadline:string,now:number):string{
 const d=new Date(deadline);const n=daysLeft(deadline,now);
 const date=new Intl.DateTimeFormat(locale==='fr'?'fr-FR':'en-GB',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(d);
 const left=locale==='fr'?(n<=1?'dernier jour':`J-${n}`):(n<=1?'last day':`${n} days left`);
 return `${date} · ${left}`;
}
export const urgent=(deadline:string,now:number)=>daysLeft(deadline,now)<=7;

// The last search of a project, remembered in this browser only (a convenience; never needed to render).
const KEY=(projectId:string)=>`prospectos.tenders.${projectId}`;
export function loadLastSearch(projectId:string):{keywords:string;departments:string}|null{
 try{const v=JSON.parse(localStorage.getItem(KEY(projectId))??'null');return v&&typeof v.keywords==='string'&&typeof v.departments==='string'?v:null}catch{return null}
}
export function saveLastSearch(projectId:string,keywords:string,departments:string){try{localStorage.setItem(KEY(projectId),JSON.stringify({keywords,departments}))}catch{/* storage unavailable */}}

export const TENDERS_TEXT={
 fr:{title:'Appels d’offres ouverts',lead:'Les marchés publics auxquels vous pouvez encore répondre, publiés au BOAMP. Chaque ligne renvoie à l’avis officiel.',
  keywords:'Mots-clés (séparés par des virgules)',keywordsHint:'Un mot-clé est cherché dans l’objet de l’avis : « pierre » trouve aussi « Saint-Pierre ». Préférez des expressions précises.',
  keywordsPlaceholder:'nettoyage façade, graffitis, dallage',departments:'Départements',departmentsPlaceholder:'33, 40, 64',search:'Chercher',searching:'Recherche…',
  none:'Aucun appel d’offres ouvert pour ces mots-clés dans ces départements.',count:'{n} appel(s) d’offres ouvert(s)',more:'{total} au total : affinez vos mots-clés pour voir les autres.',
  deadline:'Réponse avant le',buyer:'Acheteur',open:'Voir l’avis officiel',source:'Source : BOAMP (DILA), avis publiés au Bulletin officiel des annonces des marchés publics.',network:'Connexion impossible. Vérifiez votre réseau et réessayez.'},
 en:{title:'Open public tenders',lead:'Public contracts you can still bid for, published in the BOAMP. Each line links to the official notice.',
  keywords:'Keywords (comma separated)',keywordsHint:'A keyword is searched in the notice subject: “pierre” also finds “Saint-Pierre”. Prefer precise phrases.',
  keywordsPlaceholder:'nettoyage façade, graffitis, dallage',departments:'Departments',departmentsPlaceholder:'33, 40, 64',search:'Search',searching:'Searching…',
  none:'No open tender for these keywords in these departments.',count:'{n} open tender(s)',more:'{total} in all: refine your keywords to see the others.',
  deadline:'Bid before',buyer:'Buyer',open:'Open the official notice',source:'Source: BOAMP (DILA), notices published in the official bulletin of public procurement.',network:'Cannot connect. Check your network and try again.'},
} as const;
export type TendersTextKey=keyof typeof TENDERS_TEXT.fr;
export function tendersText(locale:Locale,key:TendersTextKey,vars:Record<string,string|number>={}):string{
 return Object.entries(vars).reduce<string>((s,[k,v])=>s.replaceAll(`{${k}}`,String(v)),TENDERS_TEXT[locale==="en"?"en":"fr"][key]);
}
