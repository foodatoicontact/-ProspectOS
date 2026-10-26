'use client';
import {useEffect,useState} from 'react';
import {translate,type Locale,type TKey} from '../i18n';
// Self-Outreach — the human review. One card = COMPANY, CONTACT, ROLE, SIGNAL (date, age), FIT / INTENT / TIMING /
// EVIDENCE QUALITY / OUTREACH with their explanation, EVIDENCE and SOURCE LINKS, EMAIL and its PROVENANCE, the
// generated message. Actions: APPROVE, EDIT, REJECT — and, after sending, the outcome a person reads in the reply.
// Nothing here sends: an approved message waits for the server's send job (behind SELF_OUTREACH_SEND_ENABLED).
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
// Booking link and meetings (migration 037). New copy lives here, not in the frozen i18n files.
const BK={fr:{bookingTitle:'Lien de prise de rendez-vous',bookingHelp:'Envoyé uniquement dans la réponse à un prospect marqué POSITIVE, après votre validation.',
  bookingSave:'Enregistrer le lien',bookingNone:'Aucun lien : la réponse de rendez-vous ne peut pas être préparée.',prepareBooking:'Préparer la réponse avec le lien de RDV',
  meetings:'Rendez-vous',meetingAdd:'Enregistrer le RDV',meetingWhen:'Date et heure du rendez-vous',held:'Tenu',noShow:'Absent',cancel:'Annulé',
  SCHEDULED:'Planifié',HELD:'Tenu',NO_SHOW:'Absent',CANCELLED:'Annulé',mScheduled:'RDV planifiés',mHeld:'RDV tenus',m30:'30 derniers jours',m30sent:'envoyés',m30replied:'réponses',
  m30positive:'positives',m30booked:'RDV pris',m30held:'RDV tenus',bookingStatus:{NO_LINK:'Outcome enregistré. Ajoutez le lien de rendez-vous de la campagne pour préparer la réponse.',
   REFUSED:'Outcome enregistré. La réponse de rendez-vous n’a pas pu être préparée.',DRAFTED:'Réponse avec le lien de rendez-vous prête : relisez-la et validez-la.',ALREADY:'Une réponse de rendez-vous attend déjà votre validation.'} as Record<string,string>},
 en:{bookingTitle:'Booking link',bookingHelp:'Sent only in the reply to a prospect marked POSITIVE, after your approval.',
  bookingSave:'Save the link',bookingNone:'No link: the booking reply cannot be prepared.',prepareBooking:'Prepare the reply with the booking link',
  meetings:'Meetings',meetingAdd:'Record the meeting',meetingWhen:'Meeting date and time',held:'Held',noShow:'No-show',cancel:'Cancelled',
  SCHEDULED:'Scheduled',HELD:'Held',NO_SHOW:'No-show',CANCELLED:'Cancelled',mScheduled:'Meetings scheduled',mHeld:'Meetings held',m30:'Last 30 days',m30sent:'sent',m30replied:'replies',
  m30positive:'positive',m30booked:'booked',m30held:'held',bookingStatus:{NO_LINK:'Outcome saved. Add the campaign’s booking link to prepare the reply.',
   REFUSED:'Outcome saved. The booking reply could not be prepared.',DRAFTED:'Reply with the booking link ready: read it and approve it.',ALREADY:'A booking reply is already waiting for your approval.'} as Record<string,string>}} as const;
type BkKey=Exclude<keyof typeof BK.fr,'bookingStatus'>;
const bk=(l:Locale,k:BkKey)=>(BK[l==='en'?'en':'fr'][k]) as string;
type Meeting={id:string;scheduled_for:string;status:'SCHEDULED'|'HELD'|'NO_SHOW'|'CANCELLED'};
type Campaign={id:string;name:string;status:string;booking_url:string|null};
type Msg={id:string;sequence:number;kind:string;subject:string;generated_content:string;human_edit:string|null;final_content:string|null;review_status:string;send_status:string;sent_at:string|null;approved_at:string|null};
type Item={id:string;status:string;reply_status:string;outcome:string|null;signal_id:string;signal_type:string;signal_date:string|null;evidence_ids:string[];
 fit_score:number|null;intent_score:number;timing_score:number;evidence_quality_score:number;outreach_score:number;score_threshold:number;
 explanation:{lines?:{component:string;value:number;weight:number;why:string}[];gates?:string[]};demo_at:string|null;paid_at:string|null;
 prospects:{name:string}|null;outreach_meetings?:Meeting[];outreach_campaigns?:{booking_url:string|null}|null;outreach_contacts:{contact_name:string;contact_role:string;email:string;email_source:string;email_source_url:string|null;email_verified_at:string|null;role_source_url:string}|null;
 outreach_messages:Msg[]};
type Sig={id:string;title:string;excerpt:string;source_url:string;source_domain:string|null;event_date:string|null;published_at:string|null};
type Ev={id:string;criterion:string;excerpt:string;source_url:string};
const href=(u:string|null|undefined)=>{if(!u)return null;try{const x=new URL(u);return x.protocol==='https:'||x.protocol==='http:'?x.href:null}catch{return null}};
const daysSince=(iso:string|null,now:string)=>iso?Math.max(0,Math.floor((Date.parse(now)-Date.parse(iso))/86400000)):null;

function Card({item,sig,evidence,now,locale,busy,act}:{item:Item;sig:Sig|undefined;evidence:Ev[];now:string;locale:Locale;busy:boolean;act:(path:string,body:Record<string,unknown>)=>void}){
 const [when,setWhen]=useState('');
 const tr=(k:TKey)=>translate(locale,k);
 const msg=[...item.outreach_messages].sort((a,b)=>b.sequence-a.sequence).find(m=>m.review_status==='PENDING'&&m.send_status==='DRAFT')??[...item.outreach_messages].sort((a,b)=>b.sequence-a.sequence)[0];
 const [text,setText]=useState(msg?.human_edit??msg?.generated_content??'');
 const c=item.outreach_contacts;const date=sig?.event_date??sig?.published_at??item.signal_date;const age=daysSince(date,now);
 const reviewable=msg&&msg.review_status==='PENDING'&&msg.send_status==='DRAFT';
 return <article className="nba-card so-card" data-testid="so-card">
  <header><h3>{item.prospects?.name??'—'}</h3><span className="pill">{item.status}</span>{item.reply_status!=='NONE'&&<span className="pill">{tr('so.reply')} {item.reply_status}</span>}</header>
  <p><b>{tr('so.contact')}</b> {c?.contact_name} — {c?.contact_role} {href(c?.role_source_url)&&<a href={href(c?.role_source_url)!} target="_blank" rel="noreferrer">{tr('nba.openSource')} ↗</a>}</p>
  <p><b>{tr('so.email')}</b> {c?.email} · {tr('so.provenance')} {c?.email_source} {href(c?.email_source_url)&&<a href={href(c?.email_source_url)!} target="_blank" rel="noreferrer">{tr('nba.openSource')} ↗</a>} · {c?.email_verified_at?tr('so.emailVerified'):tr('so.emailNotVerified')}</p>
  <p><b>{tr('so.signal')}</b> {item.signal_type} · {date?date.slice(0,10):'—'}{age!==null?` (${tr('nba.daysAgo').replace('{n}',String(age))})`:''}</p>
  {sig&&<blockquote>« {sig.excerpt} » {href(sig.source_url)&&<a href={href(sig.source_url)!} target="_blank" rel="noreferrer">{sig.source_domain??tr('nba.openSource')} ↗</a>}</blockquote>}
  <p className="nba-chips">{([['FIT',item.fit_score??'—'],['INTENT',item.intent_score],['TIMING',item.timing_score],['EVIDENCE',item.evidence_quality_score],['OUTREACH',`${item.outreach_score} / ${item.score_threshold}`]] as [string,string|number][])
   .map(([k,v])=><span key={k} className="pill">{k} {v}</span>)}</p>
  <ul className="nba-statements">{(item.explanation.lines??[]).map(l=><li key={l.component}><b>{l.component.toUpperCase()}</b> {l.value} × {l.weight} — {l.why}</li>)}
   {(item.explanation.gates??[]).map(g=><li key={g} className="nba-unknown">{g}</li>)}</ul>
  {evidence.length>0&&<ul className="nba-statements">{evidence.map(e=><li key={e.id} className="nba-fact"><span className="pill">{tr('so.evidence')}</span> {e.excerpt} {href(e.source_url)&&<a href={href(e.source_url)!} target="_blank" rel="noreferrer">{tr('nba.openSource')} ↗</a>}</li>)}</ul>}
  {msg&&<div className="so-message"><p><b>{msg.subject}</b> <span className="pill">{msg.kind} · {msg.review_status} · {msg.send_status}</span></p>
   {reviewable?<textarea aria-label={tr('so.message')} value={text} onChange={e=>setText(e.target.value)} rows={12}/>:<pre>{msg.final_content??msg.generated_content}</pre>}
   {reviewable&&<div className="actions">
    <button className="primary" disabled={busy} onClick={()=>act(`self-outreach/messages/${msg.id}/review`,{decision:'APPROVE'})}>{tr('so.approve')}</button>
    <button disabled={busy||text===(msg.human_edit??msg.generated_content)} onClick={()=>act(`self-outreach/messages/${msg.id}/review`,{decision:'EDIT',content:text})}>{tr('so.saveEdit')}</button>
    <button disabled={busy} onClick={()=>act(`self-outreach/messages/${msg.id}/review`,{decision:'REJECT'})}>{tr('so.reject')}</button></div>}</div>}
  {(item.status==='SENT'||item.status==='REPLIED')&&<div className="actions">{['POSITIVE','NEUTRAL','OBJECTION','NOT_INTERESTED','UNSUBSCRIBE'].map(o=>
   <button key={o} disabled={busy||item.outcome===o} onClick={()=>act(`self-outreach/candidates/${item.id}/outcome`,{outcome:o})}>{o}</button>)}
   <button disabled={busy||!!item.demo_at} onClick={()=>act(`self-outreach/candidates/${item.id}/outcome`,{milestone:'DEMO'})}>DEMO</button>
   <button disabled={busy||!!item.paid_at} onClick={()=>act(`self-outreach/candidates/${item.id}/outcome`,{milestone:'PAID'})}>PAID</button></div>}
  {item.status==='REPLIED'&&item.reply_status==='REPLIED'&&item.outcome==='POSITIVE'&&!item.outreach_messages.some(m=>m.kind==='BOOKING'&&m.send_status!=='CANCELLED')&&<div className="actions">
   {item.outreach_campaigns?.booking_url?<button className="primary" disabled={busy} onClick={()=>act(`self-outreach/candidates/${item.id}/booking`,{})}>{bk(locale,'prepareBooking')}</button>
    :<p className="muted">{bk(locale,'bookingNone')}</p>}</div>}
  {item.reply_status==='REPLIED'&&<div className="so-meetings" data-testid="so-meetings"><p><b>{bk(locale,'meetings')}</b></p>
   {(item.outreach_meetings??[]).length>0&&<ul className="nba-statements">{[...(item.outreach_meetings??[])].sort((a,b)=>b.scheduled_for.localeCompare(a.scheduled_for)).map(mt=><li key={mt.id}>
    {new Date(mt.scheduled_for).toLocaleString(locale==='en'?'en-GB':'fr-FR',{dateStyle:'medium',timeStyle:'short'})} <span className="pill">{bk(locale,mt.status)}</span>
    {mt.status==='SCHEDULED'&&<>{Date.parse(mt.scheduled_for)<=Date.parse(now)&&<><button disabled={busy} onClick={()=>act(`self-outreach/meetings/${mt.id}/status`,{status:'HELD'})}>{bk(locale,'held')}</button>
     <button disabled={busy} onClick={()=>act(`self-outreach/meetings/${mt.id}/status`,{status:'NO_SHOW'})}>{bk(locale,'noShow')}</button></>}
     <button disabled={busy} onClick={()=>act(`self-outreach/meetings/${mt.id}/status`,{status:'CANCELLED'})}>{bk(locale,'cancel')}</button></>}</li>)}</ul>}
   {!(item.outreach_meetings??[]).some(mt=>mt.status==='SCHEDULED')&&<div className="actions"><input type="datetime-local" aria-label={bk(locale,'meetingWhen')} value={when} onChange={e=>setWhen(e.target.value)}/>
    <button disabled={busy||!when||Number.isNaN(Date.parse(when))} onClick={()=>{act(`self-outreach/candidates/${item.id}/meetings`,{scheduled_for:new Date(when).toISOString()});setWhen('')}}>{bk(locale,'meetingAdd')}</button></div>}
  </div>}
 </article>;
}


// "Préparer un envoi" (POST self-outreach/projects/:id/prepare): a company with a VERIFIED signal, the contact (existing,
// or new with the provenance of the role and of the email), then the message is generated and goes to the review queue.
// Nothing here sends. Copy is local (the i18n files are frozen).
const PREP={fr:{open:'Préparer un envoi',close:'Fermer',loading:'Chargement des entreprises…',none:'Aucune entreprise de ce projet n’a encore de signal vérifié : vérifiez un signal pour pouvoir préparer un envoi.',
  company:'Entreprise',signal:'Signal vérifié',contact:'Contact',newContact:'Nouveau contact',name:'Nom et prénom',role:'Rôle',roleUrl:'Lien de la page où ce rôle est indiqué',
  email:'Email',source:'Où cet email est-il écrit ?',srcUrl:'Lien de cette page',excerpt:'Extrait de la page, avec l’email tel qu’il est écrit',submit:'Générer le message',
  active:'déjà en cours',review:'Message prêt : relisez-le dans la file ci-dessous.',qualified:'Gardé, mais pas en relecture : score {s} pour un seuil de {t}.',gates:'Bloqué :',
  sources:{company_website:'Site de l’entreprise',public_profile:'Profil public',public_document:'Document public',press:'Presse',direct_exchange:'Échange direct (la personne me l’a donné)'} as Record<string,string>},
 en:{open:'Prepare an email',close:'Close',loading:'Loading companies…',none:'No company of this project has a verified signal yet: verify a signal to prepare an email.',
  company:'Company',signal:'Verified signal',contact:'Contact',newContact:'New contact',name:'Full name',role:'Role',roleUrl:'Link to the page stating this role',
  email:'Email',source:'Where is this email written?',srcUrl:'Link to that page',excerpt:'Excerpt of the page, with the email as written',submit:'Generate the message',
  active:'already in progress',review:'Message ready: review it in the queue below.',qualified:'Kept, but not in review: score {s} for a threshold of {t}.',gates:'Blocked:',
  sources:{company_website:'Company website',public_profile:'Public profile',public_document:'Public document',press:'Press',direct_exchange:'Direct exchange (the person gave it to me)'} as Record<string,string>}} as const;
type Src={prospect:{id:string;name:string;website:string|null};signals:{id:string;title:string;excerpt:string;source_domain:string|null;event_date:string|null;published_at:string|null}[];
 contacts:{id:string;contact_name:string;contact_role:string;email:string}[];active:boolean};
function PrepareOutreach({projectId,api,locale,onDone}:{projectId:string;api:Api;locale:Locale;onDone:()=>void}){
 const t=PREP[locale==='en'?'en':'fr'];
 const [open,setOpen]=useState(false);const [items,setItems]=useState<Src[]|null>(null);const [busy,setBusy]=useState(false);const [msg,setMsg]=useState('');const [err,setErr]=useState('');
 const [pid,setPid]=useState('');const [sid,setSid]=useState('');const [cid,setCid]=useState('new');
 const [f,setF]=useState({contact_name:'',contact_role:'',role_source_url:'',email:'',email_source:'company_website',email_source_url:'',email_source_excerpt:''});
 const show=async()=>{setOpen(true);setErr('');try{setItems((await api(`self-outreach/projects/${projectId}/sources`))?.items??[])}catch(e){setErr(String((e as Error).message))}};
 const cur=items?.find(i=>i.prospect.id===pid);
 const submit=async()=>{setBusy(true);setErr('');setMsg('');
  try{
   const body:Record<string,unknown>={signal_id:sid};
   if(cid!=='new')body.contact_id=cid;
   else body.contact={prospect_id:pid,...f,email_source_url:f.email_source==='direct_exchange'?null:f.email_source_url,email_source_excerpt:f.email_source==='direct_exchange'?null:f.email_source_excerpt};
   const r=await api(`self-outreach/projects/${projectId}/prepare`,'POST',body);
   const st=r?.candidate?.status;const sc=r?.score;
   setMsg(st==='NEEDS_REVIEW'?t.review:t.qualified.replace('{s}',String(sc?.outreach??'—')).replace('{t}',String(sc?.threshold??'—'))+(sc?.gates?.length?` ${t.gates} ${sc.gates.join(', ')}`:''));
   onDone();
  }catch(e){setErr(String((e as Error).message))}finally{setBusy(false)}};
 const set=(k:keyof typeof f)=>(e:{target:{value:string}})=>setF({...f,[k]:e.target.value});
 const ready=!!pid&&!!sid&&(cid!=='new'||(f.contact_name&&f.contact_role&&f.role_source_url&&f.email&&(f.email_source==='direct_exchange'||(f.email_source_url&&f.email_source_excerpt))));
 if(!open)return <div className="actions"><button className="primary" onClick={show}>{t.open}</button></div>;
 return <div className="so-prepare" data-testid="so-prepare">
  <div className="actions"><b>{t.open}</b><button onClick={()=>{setOpen(false);setMsg('');setErr('')}}>{t.close}</button></div>
  {err&&<p className="error" role="alert">{err}</p>}{msg&&<p className="muted" role="status">{msg}</p>}
  {!items?<p>{t.loading}</p>:items.length===0?<p className="muted">{t.none}</p>:<>
   <label>{t.company} <select value={pid} onChange={e=>{setPid(e.target.value);setSid('');setCid('new')}}><option value=""></option>
    {items.map(i=><option key={i.prospect.id} value={i.prospect.id}>{i.prospect.name}{i.active?` (${t.active})`:''}</option>)}</select></label>
   {cur&&<fieldset><legend>{t.signal}</legend>{cur.signals.map(sg=><label key={sg.id} className="so-signal"><input type="radio" name="so-signal" checked={sid===sg.id} onChange={()=>setSid(sg.id)}/>
    {' '}<b>{sg.title}</b> — « {sg.excerpt.slice(0,180)} » {sg.source_domain??''} {(sg.event_date??sg.published_at??'').slice(0,10)}</label>)}</fieldset>}
   {cur&&<label>{t.contact} <select value={cid} onChange={e=>setCid(e.target.value)}><option value="new">{t.newContact}</option>
    {cur.contacts.map(c=><option key={c.id} value={c.id}>{c.contact_name} — {c.contact_role} — {c.email}</option>)}</select></label>}
   {cur&&cid==='new'&&<div className="so-contact-form">
    <input placeholder={t.name} aria-label={t.name} value={f.contact_name} onChange={set('contact_name')}/>
    <input placeholder={t.role} aria-label={t.role} value={f.contact_role} onChange={set('contact_role')}/>
    <input type="url" placeholder={t.roleUrl} aria-label={t.roleUrl} value={f.role_source_url} onChange={set('role_source_url')}/>
    <input type="email" placeholder={t.email} aria-label={t.email} value={f.email} onChange={set('email')}/>
    <label>{t.source} <select value={f.email_source} onChange={set('email_source')}>{Object.entries(t.sources).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    {f.email_source!=='direct_exchange'&&<><input type="url" placeholder={t.srcUrl} aria-label={t.srcUrl} value={f.email_source_url} onChange={set('email_source_url')}/>
     <textarea placeholder={t.excerpt} aria-label={t.excerpt} rows={3} value={f.email_source_excerpt} onChange={set('email_source_excerpt')}/></>}
   </div>}
   <div className="actions"><button className="primary" disabled={busy||!ready} onClick={submit}>{t.submit}</button></div>
  </>}
 </div>;
}

// The funnel counters of outreach_metrics, with their labels (never the raw keys on screen).
const METRICS:readonly [string,TKey][]=[['qualified','so.metric.qualified'],['needs_review','so.metric.needsReview'],['approved','so.metric.approved'],['sent','so.metric.sent'],
 ['replied','so.metric.replied'],['positive','so.metric.positive'],['demo','so.metric.demo'],['paid','so.metric.paid']];

export function SelfOutreachPanel({projectId,api,locale}:{projectId:string;api:Api;locale:Locale}){
 const tr=(k:TKey)=>translate(locale,k);
 const [data,setData]=useState<{items:Item[];signals:Sig[];evidence:Ev[];now:string}|null>(null);
 const [metrics,setMetrics]=useState<Record<string,unknown>|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [campaigns,setCampaigns]=useState<Campaign[]>([]);const [links,setLinks]=useState<Record<string,string>>({});
 const load=async()=>{try{setData(await api(`self-outreach/projects/${projectId}/queue`));setMetrics(await api(`self-outreach/projects/${projectId}/metrics`));
  const c=(await api(`self-outreach/projects/${projectId}/campaigns`))?.items??[];setCampaigns(c);setLinks(Object.fromEntries(c.map((x:Campaign)=>[x.id,x.booking_url??''])));setError('')}catch(e){setError(String((e as Error).message))}};
 useEffect(()=>{void load()},[projectId]);// eslint-disable-line react-hooks/exhaustive-deps
 const act=async(path:string,body:Record<string,unknown>)=>{setBusy(true);setNotice('');try{const r=await api(path,'POST',body);
  const st=(r as {booking?:{status?:string}}|null)?.booking?.status;if(st)setNotice(BK[locale==='en'?'en':'fr'].bookingStatus[st]??'');await load()}catch(e){setError(String((e as Error).message))}finally{setBusy(false)}};
 const m=metrics as {meetings?:Record<string,number>;last_30_days?:Record<string,number>}|null;
 return <section className="panel" data-testid="self-outreach">
  <h2>{tr('so.title')}</h2><p className="muted">{tr('so.subtitle')}</p>
  {error&&<p className="error" role="alert">{error}</p>}
  <PrepareOutreach projectId={projectId} api={api} locale={locale} onDone={()=>{void load()}}/>
  {notice&&<p className="muted" role="status">{notice}</p>}
  {metrics&&<p className="nba-chips">{METRICS.map(([k,label])=><span key={k} className="pill">{tr(label)} {String(metrics[k]??0)}</span>)}
   <span className="pill">{bk(locale,'mScheduled')} {String(m?.meetings?.scheduled??0)}</span><span className="pill">{bk(locale,'mHeld')} {String(m?.meetings?.held??0)}</span></p>}
  {m?.last_30_days&&<p className="nba-chips" data-testid="so-last-30"><b>{bk(locale,'m30')}</b>{(['sent','replied','positive','booked','held'] as const).map(k=>
   <span key={k} className="pill">{String(m.last_30_days?.[k==='booked'?'meetings_booked':k==='held'?'meetings_held':k]??0)} {bk(locale,`m30${k}` as BkKey)}</span>)}</p>}
  {campaigns.length>0&&<div className="so-booking" data-testid="so-booking"><p><b>{bk(locale,'bookingTitle')}</b> <span className="muted">{bk(locale,'bookingHelp')}</span></p>
   {campaigns.map(c=><div key={c.id} className="actions"><span>{c.name}</span><input type="url" inputMode="url" placeholder="https://" aria-label={`${bk(locale,'bookingTitle')} — ${c.name}`}
    value={links[c.id]??''} onChange={e=>setLinks({...links,[c.id]:e.target.value})}/>
    <button disabled={busy||(links[c.id]??'')===(c.booking_url??'')} onClick={()=>act(`self-outreach/campaigns/${c.id}/booking`,{booking_url:(links[c.id]??'').trim()||null})}>{bk(locale,'bookingSave')}</button></div>)}</div>}
  {/* A refused or failed load shows its message only, never a loader that never ends. */}
  {!data?(error?null:<p>{tr('so.loading')}</p>):data.items.length===0?<p>{tr('so.empty')}</p>:
   data.items.map(i=><Card key={i.id} item={i} sig={data.signals.find(s=>s.id===i.signal_id)} evidence={data.evidence.filter(e=>(i.evidence_ids??[]).includes(e.id))} now={data.now} locale={locale} busy={busy} act={act}/>)}
 </section>;
}
