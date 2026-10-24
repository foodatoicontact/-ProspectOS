'use client';
// Level-2 containers (ZF-UI0): same content, presentation adapted to the screen.
// - Sheet (mobile): a modal native <dialog> — top layer, inert page, focus kept inside, Esc / scrim / drag down closes,
//   focus returns to the opener.
// - ContextDrawer (desktop): a NON-modal panel that belongs to the workspace. Focus moves to its title on open, Esc
//   closes, focus returns to the opener — but it does not trap focus: the list next to it must stay reachable.
// - ContextPanel picks one of the two at the 1024 px breakpoint.
import {useEffect,useId,useLayoutEffect,useRef,useState,useSyncExternalStore,type KeyboardEvent as ReactKeyboardEvent,type MouseEvent as ReactMouseEvent,type PointerEvent as ReactPointerEvent,type ReactNode,type SyntheticEvent} from 'react';
import {Icon} from './primitives.tsx';
import type {Locale} from '../../i18n/locale.ts';

const CLOSE_LABEL:Record<Locale,{sheet:string;drawer:string}>={fr:{sheet:'Fermer',drawer:'Fermer le panneau'},en:{sheet:'Close',drawer:'Close panel'}};
const DRAG_CLOSE_PX=96;
const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function reducedMotion():boolean{
 try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches}catch{return true}
}
// Remember what had focus when a panel opens, give it back when it closes (if it is still in the document).
function useReturnFocus(open:boolean){
 const opener=useRef<HTMLElement|null>(null);
 useLayoutEffect(()=>{
  if(!open)return;
  opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  return ()=>{const el=opener.current;if(el&&el.isConnected)el.focus({preventScroll:true})};
 },[open]);
}

type PanelProps={open:boolean;onClose:()=>void;title:ReactNode;description?:ReactNode;children:ReactNode;footer?:ReactNode;locale?:Locale};

export function Sheet({open,onClose,title,description,children,footer,locale='fr'}:PanelProps){
 const ref=useRef<HTMLDialogElement>(null);
 const titleId=useId(),descId=useId();
 const [closing,setClosing]=useState(false);
 const [drag,setDrag]=useState(0);
 const dragStart=useRef<number|null>(null);
 const opener=useRef<HTMLElement|null>(null);

 // Focus goes back to the opener only once the dialog has left the top layer (before that, the page is inert).
 useEffect(()=>{
  const d=ref.current;if(!d)return;
  const finish=()=>{d.close();setClosing(false);const el=opener.current;opener.current=null;if(el&&el.isConnected)el.focus({preventScroll:true})};
  if(open){
   setClosing(false);setDrag(0);
   if(!d.open){opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;d.showModal()}
   return;
  }
  if(!d.open)return;
  if(reducedMotion()){finish();return}
  setClosing(true);
  const t=window.setTimeout(finish,200);
  return ()=>window.clearTimeout(t);
 },[open]);

 // Esc (native "cancel") and scrim clicks ask the owner to close: the dialog stays controlled by `open`.
 const onCancel=(e:SyntheticEvent)=>{e.preventDefault();onClose()};
 // A modal <dialog> makes the page inert but lets Tab leave for the browser chrome: wrap it inside the sheet.
 const onKeyDown=(e:ReactKeyboardEvent<HTMLDialogElement>)=>{
  if(e.key!=='Tab')return;
  const items=[...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el=>el.getClientRects().length>0);
  if(!items.length)return;
  const first=items[0]!,last=items[items.length-1]!,active=document.activeElement;
  if(e.shiftKey&&(active===first||!e.currentTarget.contains(active))){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&active===last){e.preventDefault();first.focus()}
 };
 const onScrim=(e:ReactMouseEvent<HTMLDialogElement>)=>{if(e.target===e.currentTarget)onClose()};
 const onDragStart=(e:ReactPointerEvent<HTMLDivElement>)=>{dragStart.current=e.clientY;e.currentTarget.setPointerCapture(e.pointerId)};
 const onDragMove=(e:ReactPointerEvent<HTMLDivElement>)=>{if(dragStart.current!==null)setDrag(Math.max(0,e.clientY-dragStart.current))};
 const onDragEnd=()=>{if(dragStart.current===null)return;dragStart.current=null;if(drag>DRAG_CLOSE_PX)onClose();else setDrag(0)};

 return <dialog ref={ref} className={`pos-sheet${closing?' is-closing':''}`} aria-labelledby={titleId} aria-describedby={description?descId:undefined}
  onCancel={onCancel} onClick={onScrim} onKeyDown={onKeyDown}>
  <div className="pos-sheet__panel pos-glass" style={drag?{transform:`translateY(${drag}px)`}:undefined}>
   <div className="pos-sheet__grab" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} aria-hidden="true">
    <span className="pos-sheet__handle"/>
   </div>
   <header className="pos-panel__header">
    <h2 id={titleId} className="pos-panel__title">{title}</h2>
    <button type="button" className="pos-iconbtn" onClick={onClose} aria-label={CLOSE_LABEL[locale].sheet}><Icon name="close" size={19}/></button>
   </header>
   {description&&<p id={descId} className="pos-panel__desc">{description}</p>}
   <div className="pos-panel__body">{children}</div>
   {footer&&<footer className="pos-panel__footer">{footer}</footer>}
  </div>
 </dialog>;
}

export function ContextDrawer({open,onClose,title,description,children,footer,locale='fr'}:PanelProps){
 const titleId=useId(),descId=useId();
 const heading=useRef<HTMLHeadingElement>(null);
 useReturnFocus(open);
 useEffect(()=>{if(open)heading.current?.focus({preventScroll:true})},[open]);
 if(!open)return null;
 return <aside className="pos-drawer" role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={description?descId:undefined}
  onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose()}}}>
  <header className="pos-panel__header pos-drawer__header">
   <h2 id={titleId} ref={heading} tabIndex={-1} className="pos-panel__title">{title}</h2>
   <button type="button" className="pos-iconbtn" onClick={onClose} aria-label={CLOSE_LABEL[locale].drawer}><Icon name="close" size={19}/></button>
  </header>
  {description&&<p id={descId} className="pos-panel__desc">{description}</p>}
  <div className="pos-panel__body">{children}</div>
  {footer&&<footer className="pos-panel__footer">{footer}</footer>}
 </aside>;
}

export const DESKTOP_QUERY='(min-width: 1024px)';
function subscribeDesktop(cb:()=>void){
 try{const mq=window.matchMedia(DESKTOP_QUERY);mq.addEventListener('change',cb);return ()=>mq.removeEventListener('change',cb)}catch{return ()=>{}}
}
// false on the server and during hydration; panels are closed on first render, so nothing visible depends on it.
export function useIsDesktop():boolean{
 return useSyncExternalStore(subscribeDesktop,()=>{try{return window.matchMedia(DESKTOP_QUERY).matches}catch{return false}},()=>false);
}
export function ContextPanel(props:PanelProps){
 return useIsDesktop()?<ContextDrawer {...props}/>:<Sheet {...props}/>;
}
