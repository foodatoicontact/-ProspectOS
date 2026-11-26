'use client';
// Cockpit administrateur — écran Fil (migration 056). Read-only: the events of the feed, newest first, filtered by group of
// kinds and by Paris dates, by pages of 50. Every line is resolved by the database from its source at read time.
import {Chip,ChipGroup} from '../primitives.tsx';
import {FEED_GROUPS,KIND_LABEL,KIND_TONE,eventSummary,stripeLink,when,type FeedEvent} from '../../../cockpit/model.ts';

export type FeedFilters={groups:string[];from:string;to:string};
export function CockpitFeed(p:{events:FeedEvent[];hasMore:boolean;filters:FeedFilters;busy:boolean;
 onFilters:(f:FeedFilters)=>void;onMore:()=>void}){
 const f=p.filters;
 const toggle=(key:string)=>p.onFilters({...f,groups:f.groups.includes(key)?f.groups.filter(g=>g!==key):[...f.groups,key]});
 return <div className="pos-ded pos-cockpit">
  <h2>Fil</h2>
  <div className="pos-cockpit__filters">
   <ChipGroup label="Types d’événements">
    {FEED_GROUPS.map(g=><Chip key={g.key} pressed={f.groups.includes(g.key)} onPressedChange={()=>toggle(g.key)}>{g.label}</Chip>)}
   </ChipGroup>
   <div className="pos-ded__form pos-cockpit__dates">
    <label>Du<input type="date" value={f.from} max={f.to||undefined} onChange={e=>p.onFilters({...f,from:e.target.value})}/></label>
    <label>Au<input type="date" value={f.to} min={f.from||undefined} onChange={e=>p.onFilters({...f,to:e.target.value})}/></label>
   </div>
   {(f.groups.length>0||f.from||f.to)&&<div className="pos-ded__actions">
    <button type="button" className="pos-ded__btn" onClick={()=>p.onFilters({groups:[],from:'',to:''})}>Effacer les filtres</button></div>}
  </div>
  {!p.events.length&&!p.busy&&<p className="pos-ded__muted">Aucun événement pour ces filtres.</p>}
  <ul className="pos-ded__list" aria-label="Événements">
   {p.events.map(e=>{const link=stripeLink(e);return <li key={e.id} className="pos-cockpit__event">
    <div className="pos-ded__itemtop">
     <span className={`pos-cockpit__kind pos-cockpit__kind--${KIND_TONE[e.kind]}`}>{KIND_LABEL[e.kind]}</span>
     <time className="pos-cockpit__time" dateTime={e.occurred_at}>{when(e.occurred_at)}</time>
    </div>
    <p className="pos-cockpit__summary">{eventSummary(e)}</p>
    {link&&<a href={link} target="_blank" rel="noreferrer">Voir l’événement dans Stripe</a>}
   </li>})}
  </ul>
  {p.hasMore&&<div className="pos-ded__actions"><button type="button" className="pos-ded__btn" disabled={p.busy} onClick={p.onMore}>{p.busy?'Chargement…':'Plus d’événements'}</button></div>}
 </div>;
}
