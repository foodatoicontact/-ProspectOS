'use client';
// Annonces à relire (migration 055, owner decision 25 nov. 2026): the « Ventes et cessions » notices that no rule of the
// automatic sort could classify (INDETERMINE). They are never proposed to a client, counted in public figures or delivered:
// the administrator reads each official notice by hand. Read-only here; the source opens the notice on bodacc.fr.
import {useEffect,useState} from 'react';
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
export type ReviewEvent={source_id:string;siren:string;name:string|null;published_on:string;department:string|null;commune:string|null;activity:string|null;source_url:string;sale_rule:string|null};
const RULE:Record<string,string>={no_rule:'aucune règle ne s’applique',text_head_office_move:'le texte ne parle que d’un transfert de siège'};
const dateFr=(iso:string)=>new Date(`${iso.slice(0,10)}T12:00:00Z`).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
export function EventReview({api}:{api:Api}){
 const [rows,setRows]=useState<ReviewEvent[]|null>(null);const [error,setError]=useState('');
 useEffect(()=>{api('leads/review').then((r:ReviewEvent[])=>setRows(r),(e:unknown)=>setError(e instanceof Error?e.message:'Lecture impossible pour le moment.'))},[api]);
 return <section className="pos-ded__card" aria-labelledby="pos-review-title" style={{marginTop:16}}>
  <div className="pos-ded__row"><h3 id="pos-review-title">Annonces à relire</h3>{rows&&<span className="pos-ded__pill">{rows.length}</span>}</div>
  <p className="pos-ded__muted">Ventes et cessions que le tri automatique n’a pas pu classer. Elles ne sont proposées à aucun client et ne comptent dans aucun chiffre : ouvrez l’annonce officielle pour décider.</p>
  {error&&<p className="pos-ded__note pos-ded__note--error" role="alert">{error}</p>}
  {rows&&!rows.length&&<p className="pos-ded__muted">Aucune annonce à relire.</p>}
  {rows&&rows.length>0&&<ul className="pos-ded__list" style={{gap:0}}>{rows.map(r=><li key={r.source_id}
   style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:10,alignItems:'start',padding:'10px 0',borderTop:'1px solid var(--pos-border)'}}>
   <span style={{minWidth:0}}><b>{r.name??r.siren}</b> <span className="pos-ded__meta">SIREN {r.siren}</span><br/>
    <span className="pos-ded__meta">{dateFr(r.published_on)} · {r.commune??''}{r.department?` (${r.department})`:''}{r.sale_rule?` · ${RULE[r.sale_rule]??r.sale_rule}`:''}</span></span>
   <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="pos-ded__btn">Annonce ↗</a></li>)}</ul>}
 </section>;
}
