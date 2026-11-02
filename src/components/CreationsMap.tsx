'use client';
// France map of the barometer (/creations-entreprises): one colour per metropolitan department, by quantile class of the
// month's figure — purchases of a business (reprises) or company creations, both from the BODACC totals already on the
// page. Hover or focus shows the department's two figures; every department is a real link to its own barometer page.
// The outlines (IGN Admin Express COG, Licence Ouverte, simplified by france-geojson) are a static file of the site,
// fetched once; until they arrive, and if they never do, the rest of the page (tables, links) carries the same numbers.
import Link from 'next/link';
import {useEffect,useMemo,useRef,useState} from 'react';
import {classOf,quantileBreaks} from './creations-map';

export type MapDepartment={code:string;name:string;slug:string;sales:number|null;creations:number};
type Geo={c:string;p:number[][][][]}[];
type Metric='sales'|'creations';
const GEO_URL='/geo/departements-metropole.json';
const STEPS=['#cde2fb','#9ec5f4','#6da7ec','#3987e5','#256abf','#104281'];
const nf=new Intl.NumberFormat('fr-FR');
const LABEL:Record<Metric,{button:string;unit:string}>={sales:{button:'Reprises de fonds',unit:'reprises'},creations:{button:'Créations d’entreprises',unit:'créations'}};

const CSS=`
.pos-map{display:grid;gap:12px}
.pos-map__switch{display:inline-flex;gap:4px;padding:4px;border:1px solid var(--pos-border);border-radius:999px;width:max-content;max-width:100%;background:var(--pos-surface-card)}
.pos-map__switch button{font:inherit;font-weight:600;font-size:14px;border:0;background:transparent;color:var(--pos-text-2);padding:8px 14px;border-radius:999px;cursor:pointer;min-height:40px}
.pos-map__switch button[aria-pressed="true"]{background:var(--pos-text-1);color:var(--pos-surface-card)}
.pos-map__switch button:focus-visible{outline:2px solid var(--pos-accent);outline-offset:2px}
.pos-map__frame{position:relative}
.pos-map__frame svg{width:100%;height:auto;display:block}
.pos-map__frame path{stroke:#fff;stroke-width:.6;transition:opacity .12s}
.pos-map__frame a:hover path,.pos-map__frame a:focus-visible path{stroke:#14181f;stroke-width:1.6}
.pos-map__frame a:focus-visible{outline:none}
.pos-map__tip{position:absolute;pointer-events:none;background:#14181f;color:#fff;padding:8px 10px;border-radius:8px;font-size:13px;line-height:1.35;min-width:160px;transform:translate(-50%,calc(-100% - 10px));font-variant-numeric:tabular-nums}
.pos-map__tip b{display:block;margin-bottom:2px}
.pos-map__legend{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:13px;color:var(--pos-text-2);font-variant-numeric:tabular-nums}
.pos-map__legend i{display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:6px;vertical-align:-2px}
.pos-map__loading{aspect-ratio:1/1;max-width:100%;display:grid;place-items:center;color:var(--pos-text-3);font-size:14px}
@media (prefers-reduced-motion:reduce){.pos-map__frame path{transition:none}}
`;

// Equirectangular projection corrected at 46.5°N, fitted to the outlines' bounds.
function project(geo:Geo){
 const K=Math.cos(46.5*Math.PI/180);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const f of geo)for(const poly of f.p)for(const ring of poly)for(const [x,y] of ring){const X=x*K,Y=-y;if(X<minX)minX=X;if(X>maxX)maxX=X;if(Y<minY)minY=Y;if(Y>maxY)maxY=Y}
 const W=1000,pad=8,sc=(W-2*pad)/(maxX-minX),H=Math.round((maxY-minY)*sc+2*pad);
 const pt=([x,y]:number[])=>`${((x!*K-minX)*sc+pad).toFixed(1)},${((-y!-minY)*sc+pad).toFixed(1)}`;
 return {W,H,paths:geo.map(f=>({code:f.c,d:f.p.map(poly=>poly.map(r=>'M'+r.map(pt).join('L')+'Z').join('')).join('')}))};
}
export function CreationsMap({departments,month}:{departments:MapDepartment[];month:string}){
 const hasSales=departments.some(d=>d.sales!==null);
 const [metric,setMetric]=useState<Metric>(hasSales?'sales':'creations');
 const [geo,setGeo]=useState<Geo|null>(null);const [failed,setFailed]=useState(false);
 const [tip,setTip]=useState<{code:string;x:number;y:number}|null>(null);
 const frame=useRef<HTMLDivElement>(null);
 useEffect(()=>{let live=true;fetch(GEO_URL).then(r=>{if(!r.ok)throw Error();return r.json()}).then(g=>{if(live)setGeo(g as Geo)}).catch(()=>{if(live)setFailed(true)});return()=>{live=false}},[]);
 const byCode=useMemo(()=>new Map(departments.map(d=>[d.code,d])),[departments]);
 const shape=useMemo(()=>geo?project(geo):null,[geo]);
 const value=(d:MapDepartment)=>metric==='sales'?d.sales??0:d.creations;
 const metro=shape?shape.paths.map(p=>byCode.get(p.code)).filter((d):d is MapDepartment=>!!d):[];
 const breaks=quantileBreaks(metro.map(value));
 const lows=[0,...breaks],highs=[...breaks.map(b=>b-1),null];
 if(failed)return null;
 function place(code:string,clientX?:number,clientY?:number,el?:Element){
  const box=frame.current?.getBoundingClientRect();if(!box)return;
  let x:number,y:number;
  if(clientX!==undefined&&clientY!==undefined){x=clientX-box.left;y=clientY-box.top}
  else{const b=el!.getBoundingClientRect();x=b.left+b.width/2-box.left;y=b.top-box.top}
  setTip({code,x:Math.min(Math.max(x,90),box.width-90),y:Math.max(y,64)});
 }
 const current=tip?byCode.get(tip.code):null;
 return <div className="pos-map">
  <style href="pos-map" precedence="default">{CSS}</style>
  {hasSales&&<div className="pos-map__switch" role="group" aria-label="Chiffre affiché sur la carte">
   {(['sales','creations'] as const).map(m=><button key={m} type="button" aria-pressed={metric===m} onClick={()=>setMetric(m)}>{LABEL[m].button}</button>)}
  </div>}
  <div className="pos-map__frame" ref={frame}>
   {shape?<svg viewBox={`0 0 ${shape.W} ${shape.H}`} role="img" aria-label={`Carte de France des ${LABEL[metric].unit} par département, ${month}`}>
    {shape.paths.map(p=>{const d=byCode.get(p.code);if(!d)return null;
     return <Link key={p.code} href={`/creations-entreprises/${d.slug}`} aria-label={`${d.name} (${d.code}) : ${nf.format(value(d))} ${LABEL[metric].unit}`}
      onMouseMove={e=>place(p.code,e.clientX,e.clientY)} onMouseLeave={()=>setTip(null)} onFocus={e=>place(p.code,undefined,undefined,e.currentTarget)} onBlur={()=>setTip(null)}>
      <path d={p.d} fill={STEPS[classOf(value(d),breaks)]}/></Link>})}
   </svg>:<div className="pos-map__loading">Chargement de la carte…</div>}
   {current&&tip&&<div className="pos-map__tip" style={{left:tip.x,top:tip.y}} role="status">
    <b>{current.name} ({current.code})</b>
    {current.sales!==null&&<>{nf.format(current.sales)} reprises de fonds<br/></>}{nf.format(current.creations)} créations
   </div>}
  </div>
  {shape&&<div className="pos-map__legend">
   {/* A class two equal breaks leave empty (many departments with the same figure) is not listed. */}
   {STEPS.map((c,i)=>highs[i]!==null&&highs[i]!<lows[i]!?null:<span key={c}><i style={{background:c}}/>{highs[i]===null?`${nf.format(lows[i]!)} et +`:lows[i]===highs[i]?nf.format(lows[i]!):`${nf.format(lows[i]!)} à ${nf.format(highs[i]!)}`}</span>)}
   <span>{LABEL[metric].unit} par département, {month}</span>
  </div>}
 </div>;
}
