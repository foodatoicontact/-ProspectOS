'use client';
// Cockpit administrateur — écran Pipeline (migration 060). The requests of the two public forms (« 3 prospects de votre zone »
// and « veille dédiée ») in six columns: Nouveau / Contacté / Démo / Devis / Signé / Perdu. On a computer a card is dragged
// to another column; on a phone (and with the keyboard everywhere) its status selector moves it. A move is shown at once,
// then confirmed by the server; a move made from a stale screen is refused there and the board is reloaded.
import {useCallback,useEffect,useRef,useState} from 'react';
import {Chip,ChipGroup} from '../primitives.tsx';
import {PIPELINE_STAGES,STAGE_LABEL,REQUEST_KIND_LABEL,byStage,withStage,clientDay as day,when,
 type PipelineBoard,type PipelineItem,type PipelineStage} from '../../../cockpit/model.ts';
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
type Filter='ALL'|'PROSPECTS'|'WATCH';

function Card({item,busy,onMove,onDragStart}:{item:PipelineItem;busy:boolean;onMove:(stage:PipelineStage)=>void;onDragStart:()=>void}){
 return <li className="pos-cockpit__card" draggable={!busy} onDragStart={e=>{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',item.id);onDragStart()}}>
  <span className="pos-ded__itemtop">
   <span className={`pos-cockpit__kind pos-cockpit__kind--${item.kind==='WATCH'?'accent':'neutral'}`}>{REQUEST_KIND_LABEL[item.kind]}</span>
   <time className="pos-cockpit__time" dateTime={item.created_at}>{day(item.created_at)}</time>
  </span>
  <span className="pos-ded__name">{item.company||item.activity}</span>
  <span className="pos-cockpit__summary">{item.activity}{item.target?` → ${item.target}`:''} · {item.department}</span>
  <a href={`mailto:${item.email}`} className="pos-cockpit__mail">{item.email}</a>
  {item.message&&<p className="pos-cockpit__summary pos-cockpit__notebody pos-cockpit__clamp">{item.message}</p>}
  {item.moved_at&&<span className="pos-ded__meta">Déplacée le {when(item.moved_at)}{item.moved_by?` · ${item.moved_by}`:''}</span>}
  <label className="pos-cockpit__stage">Statut
   <select value={item.stage} disabled={busy} onChange={e=>onMove(e.target.value as PipelineStage)}>
    {PIPELINE_STAGES.map(s=><option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
   </select>
  </label>
 </li>;
}

export function PipelineColumns({items,pending,onMove}:{items:PipelineItem[];pending:ReadonlySet<string>;onMove:(id:string,stage:PipelineStage)=>void}){
 const cols=byStage(items);const dragged=useRef<string|null>(null);const [over,setOver]=useState<PipelineStage|null>(null);
 return <div className="pos-cockpit__board">
  {PIPELINE_STAGES.map(stage=><section key={stage} aria-label={STAGE_LABEL[stage]}
   className={`pos-cockpit__col${over===stage?' pos-cockpit__col--over':''}`}
   onDragOver={e=>{if(!dragged.current)return;e.preventDefault();e.dataTransfer.dropEffect='move';if(over!==stage)setOver(stage)}}
   onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setOver(null)}}
   onDrop={e=>{e.preventDefault();setOver(null);const id=dragged.current??e.dataTransfer.getData('text/plain');dragged.current=null;
    const it=items.find(i=>i.id===id);if(it&&it.stage!==stage)onMove(id,stage)}}>
   <h3 className="pos-cockpit__colhead">{STAGE_LABEL[stage]} <b className="pos-chip__count">{cols[stage].length}</b></h3>
   {!cols[stage].length?<p className="pos-ded__muted pos-cockpit__empty">Aucune demande.</p>
    :<ul className="pos-ded__list">{cols[stage].map(i=><Card key={i.id} item={i} busy={pending.has(i.id)}
      onMove={s=>onMove(i.id,s)} onDragStart={()=>{dragged.current=i.id}}/>)}</ul>}
  </section>)}
 </div>;
}

export function CockpitPipeline({api}:{api:Api}){
 const [filter,setFilter]=useState<Filter>('ALL');
 const [items,setItems]=useState<PipelineItem[]>([]);const [total,setTotal]=useState(0);
 const [loaded,setLoaded]=useState(false);const [error,setError]=useState('');const [said,setSaid]=useState('');
 const [pending,setPending]=useState<Set<string>>(new Set());
 const seq=useRef(0);
 const load=useCallback(async(f:Filter)=>{const n=++seq.current;
  try{const d=await api(`cockpit/pipeline${f==='ALL'?'':`?kinds=${f}`}`) as PipelineBoard;if(n!==seq.current)return;setItems(d.items);setTotal(d.total);setError('')}
  catch(e){if(n===seq.current)setError(e instanceof Error?e.message:'Action impossible pour le moment.')}finally{if(n===seq.current)setLoaded(true)}},[api]);
 useEffect(()=>{load(filter)},[filter,load]);
 const move=async(id:string,stage:PipelineStage)=>{
  const before=items.find(i=>i.id===id);if(!before||pending.has(id))return;
  setItems(x=>withStage(x,id,{stage}));setPending(p=>new Set(p).add(id));setError('');
  try{const r=await api(`cockpit/pipeline/${id}`,'POST',{stage,version:before.version});
   setItems(x=>withStage(x,id,{stage:r.stage,version:r.version,moved_at:r.moved_at}));setSaid(`${before.company||before.activity} : ${STAGE_LABEL[stage as PipelineStage]}.`)}
  catch(e){setItems(x=>withStage(x,id,{stage:before.stage}));setError(e instanceof Error?e.message:'Action impossible pour le moment.');load(filter)}
  finally{setPending(p=>{const n=new Set(p);n.delete(id);return n})}
 };
 return <div className="pos-ded pos-cockpit pos-cockpit--wide">
  <h2>Pipeline</h2>
  <ChipGroup label="Formulaire d’origine">
   {(['ALL','PROSPECTS','WATCH'] as const).map(f=><Chip key={f} pressed={filter===f} onPressedChange={()=>setFilter(f)}>
    {f==='ALL'?'Toutes les demandes':REQUEST_KIND_LABEL[f]}</Chip>)}
  </ChipGroup>
  <p className="pos-ded__muted">{loaded?`${total} demande${total>1?'s':''}${total>items.length?` · les ${items.length} plus récentes`:''} · supprimées 12 mois après leur envoi`:'Chargement…'}</p>
  <p className="pos-ded__meta pos-cockpit__hint">Glissez une carte vers une autre colonne, ou changez son statut.</p>
  {error&&<p className="pos-ded__note pos-ded__note--error" role="alert">{error}</p>}
  <p className="pos-cockpit__sr" role="status" aria-live="polite">{said}</p>
  {loaded&&<PipelineColumns items={items} pending={pending} onMove={move}/>}
 </div>;
}
