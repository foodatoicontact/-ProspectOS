// Cockpit administrateur — notifications push (migration 056, docs/ADMIN_COCKPIT.md). Channel: ntfy (owner decision,
// 26 nov. 2026): the server POSTs a short text to a secret topic, the administrator's phone shows it.
//   NTFY_TOPIC  required — a long random topic name (at least 16 characters), kept secret: whoever knows it reads the messages
//   NTFY_URL    optional — the ntfy server (default https://ntfy.sh); https only
//   NTFY_TOKEN  optional — an access token when the topic is protected
// Nothing personal ever leaves ProspectOS: a message says WHAT happened (a kind) and links to the cockpit, never a name, an
// e-mail or an amount — those stay behind the administrator's login. Without NTFY_TOPIC nothing is sent and the queue waits.
export type PushKind='WATCH_REQUEST'|'PAYMENT_FAILED'|'CANCELLATION'|'COMMISSION_DUE';
export const PUSH_KINDS:readonly PushKind[]=['WATCH_REQUEST','PAYMENT_FAILED','CANCELLATION','COMMISSION_DUE'];
export type PushConfig={url:string;topic:string;token:string|null};
type Env=Record<string,string|undefined>;

export function pushConfig(env:Env):PushConfig|null{
 const topic=(env.NTFY_TOPIC??'').trim();
 if(!/^[A-Za-z0-9_-]{16,64}$/.test(topic))return null;
 const raw=(env.NTFY_URL??'https://ntfy.sh').trim().replace(/\/+$/,'');
 let url:URL;try{url=new URL(raw)}catch{return null}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return null;
 const token=(env.NTFY_TOKEN??'').trim();
 return {url:url.origin+url.pathname.replace(/\/+$/,''),topic,token:token&&/^[A-Za-z0-9_.-]{8,200}$/.test(token)?token:null};
}

const TEXT:Record<PushKind,{title:string;body:string;tags:string;priority:string}>={
 WATCH_REQUEST:{title:'Demande de veille',body:'Une nouvelle demande de devis de veille dédiée est arrivée.',tags:'inbox_tray',priority:'high'},
 PAYMENT_FAILED:{title:'Paiement échoué',body:'Un paiement d’abonnement a échoué.',tags:'warning',priority:'high'},
 CANCELLATION:{title:'Résiliation',body:'Un abonnement a été résilié ou prendra fin à son échéance.',tags:'wave',priority:'default'},
 COMMISSION_DUE:{title:'Commission à verser',body:'Un relevé partenaire atteint le seuil de paiement.',tags:'moneybag',priority:'default'},
};
// The exact request sent for one event. ASCII-only headers (ntfy reads the title from a header): accents are removed there.
export function pushRequest(cfg:PushConfig,kind:PushKind,cockpitUrl:string):{url:string;init:RequestInit}{
 const t=TEXT[kind];
 const ascii=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’]/g,"'").replace(/[^\x20-\x7e]/g,'');
 const headers:Record<string,string>={'Content-Type':'text/plain; charset=utf-8',Title:ascii(`ProspectOS - ${t.title}`),Tags:t.tags,Priority:t.priority,Click:cockpitUrl};
 if(cfg.token)headers.Authorization=`Bearer ${cfg.token}`;
 return {url:`${cfg.url}/${cfg.topic}`,init:{method:'POST',headers,body:`${t.body} Ouvrez le cockpit pour le détail.`,redirect:'error'}};
}

export type PushDeps={rpc:(fn:string,args:Record<string,unknown>)=>Promise<unknown>;fetch:typeof fetch;config:PushConfig|null;cockpitUrl:string;timeoutMs?:number};
// Claims the pending notifications and sends each one; a failure is retried at the next dispatch (up to 5 attempts in all).
// Never throws: a push is a convenience, the feed is the record.
export async function dispatchAdminPush(d:PushDeps):Promise<{sent:number;failed:number;skipped?:string}>{
 if(!d.config)return {sent:0,failed:0,skipped:'PUSH_NOT_CONFIGURED'};
 let claimed:unknown;
 try{claimed=await d.rpc('claim_admin_push',{p_limit:20})}catch{return {sent:0,failed:0,skipped:'QUEUE_UNAVAILABLE'}}
 let sent=0,failed=0;
 for(const row of Array.isArray(claimed)?claimed as {id:number;kind:string}[]:[]){
  if(!PUSH_KINDS.includes(row.kind as PushKind))continue;
  const {url,init}=pushRequest(d.config,row.kind as PushKind,d.cockpitUrl);
  let ok=false;
  try{const res=await d.fetch(url,{...init,signal:AbortSignal.timeout(d.timeoutMs??5000)});ok=res.ok}catch{ok=false}
  try{await d.rpc('finish_admin_push',{p_event_id:row.id,p_sent:ok})}catch{}
  if(ok)sent++;else failed++;
 }
 return {sent,failed};
}
