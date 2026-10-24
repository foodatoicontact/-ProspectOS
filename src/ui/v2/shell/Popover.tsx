'use client';
// Desktop counterpart of Sheet for small menus (project, account): a non-modal panel anchored in the side navigation.
// Focus moves into it on open; Esc, a click outside or choosing an action closes it; focus returns to its trigger.
import {useEffect,useRef,type ReactNode,type RefObject} from 'react';

const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Popover({open,onClose,label,anchor,className,children}:{open:boolean;onClose:()=>void;label:string;
 anchor:RefObject<HTMLElement|null>;className?:string;children:ReactNode}){
 const ref=useRef<HTMLDivElement>(null);
 const close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  if(!open)return;
  const trigger=anchor.current;
  // Focus the current choice if there is one, else the first control.
  const el=ref.current;
  (el?.querySelector<HTMLElement>('[aria-current="true"]')??el?.querySelector<HTMLElement>(FOCUSABLE))?.focus({preventScroll:true});
  const outside=(e:PointerEvent)=>{const t=e.target as Node;if(!el?.contains(t)&&!trigger?.contains(t))close.current()};
  document.addEventListener('pointerdown',outside);
  return ()=>{
   document.removeEventListener('pointerdown',outside);
   // Back to the trigger only if focus was still inside (a click elsewhere keeps its own focus).
   if(trigger&&trigger.isConnected&&(!document.activeElement||document.activeElement===document.body||el?.contains(document.activeElement)))trigger.focus({preventScroll:true});
  };
 },[open,anchor]);
 if(!open)return null;
 return <div ref={ref} role="dialog" aria-modal="false" aria-label={label} className={`pos-popover pos-glass${className?` ${className}`:''}`}
  onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose()}}}>{children}</div>;
}
