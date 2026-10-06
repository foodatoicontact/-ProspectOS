'use client';
import {useState} from 'react';
import {type Locale,translate,type TKey} from '../i18n';
// ProspectOS Pro team in the account (migration 022). Display and intents only: every action goes through the
// page's handlers to /api/v1/account/team/*, where the database decides (owner, active team plan, 5 seats,
// confirmed matching e-mail). The invitation link is shown once, to be handed over by the owner; nothing is sent.
export type TeamMember={user_id:string;email:string|null;role:'owner'|'member';joined_at:string};
export type TeamView={organization_id:string;is_owner:boolean;max_seats:number;plan_active:boolean;pending:number|null;members:TeamMember[]};
export type TeamInvitation={id:string;email:string;expires_at:string};

export function TeamSection({locale,team,invitations,teamPlan,busy,link,onInvite,onRevoke,onRemove,onLeave}:{locale:Locale;team:TeamView|null;invitations:TeamInvitation[]|null;teamPlan:boolean;busy:boolean;link:{email:string;link:string}|null;onInvite:(email:string)=>void;onRevoke:(id:string)=>void;onRemove:(userId:string)=>void;onLeave:()=>void}){
 const tr=(k:TKey)=>translate(locale,k);
 const [email,setEmail]=useState('');const [copied,setCopied]=useState(false);
 if(!team)return null;
 const hasTeam=!team.is_owner||team.members.length>1||(team.pending??0)>0;
 if(team.is_owner&&!teamPlan&&!hasTeam)return <section className="team-section"><h3>{tr('team.title')}</h3><p className="muted">{tr('team.proOnly')}</p></section>;
 const seats=team.members.length+(team.pending??0);
 return <section className="team-section" aria-labelledby="team-title">
  <h3 id="team-title">{tr('team.title')} <span className="muted">{tr('team.seats').replace('{n}',String(seats)).replace('{max}',String(team.max_seats))}</span></h3>
  {!team.plan_active&&hasTeam&&<p className="note" role="status">{tr('team.readOnly')}</p>}
  {!team.is_owner&&<p className="muted">{tr('team.memberNote')}</p>}
  <ul className="team-members">{team.members.map(m=><li key={m.user_id}><span className="team-email">{m.email??'—'}</span><small className="muted">{tr(m.role==='owner'?'team.owner':'team.member')}</small>{team.is_owner&&m.role==='member'&&<button type="button" className="text-button" disabled={busy} onClick={()=>onRemove(m.user_id)}>{tr('team.remove')}</button>}</li>)}</ul>
  {team.is_owner&&invitations&&invitations.length>0&&<><h4>{tr('team.pending')}</h4><ul className="team-members">{invitations.map(i=><li key={i.id}><span className="team-email">{i.email}</span><button type="button" className="text-button" disabled={busy} onClick={()=>onRevoke(i.id)}>{tr('team.revoke')}</button></li>)}</ul></>}
  {team.is_owner&&teamPlan&&team.plan_active&&seats<team.max_seats&&<form className="team-invite" onSubmit={e=>{e.preventDefault();if(email.trim()){setCopied(false);onInvite(email.trim())}}}><h4>{tr('team.invite')}</h4><label>{tr('team.inviteEmail')}<input type="email" required maxLength={254} autoComplete="off" value={email} onChange={e=>setEmail(e.target.value)}/></label><button type="submit" disabled={busy}>{tr('team.inviteButton')}</button></form>}
  {link&&<div className="team-link" role="status"><p>{tr('team.inviteLink').replace('{email}',link.email)}</p><input readOnly value={link.link} aria-label={tr('team.copy')} onFocus={e=>e.currentTarget.select()}/><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(link.link);setCopied(true)}catch{/* the field stays selectable */}}}>{copied?tr('team.copied'):tr('team.copy')}</button></div>}
  {!team.is_owner&&<button type="button" disabled={busy} onClick={onLeave}>{tr('team.leave')}</button>}
 </section>;
}
