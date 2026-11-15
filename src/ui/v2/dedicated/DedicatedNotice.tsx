'use client';
// Veille dédiée — the notice shown when the client signs in while something waits for them: a proposal to accept, a
// statement to validate. One tap opens the follow-up space. « Plus tard » hides it for this browser session only: it comes
// back at the next sign-in as long as the action is still pending (the counts come from the account answer).
import {useEffect,useState} from 'react';
import {noticeText} from '../../../dedicated/model.ts';
const KEY='pos-dedicated-notice-dismissed';
export function DedicatedNotice({proposals,statements,onOpen}:{proposals:number;statements:number;onOpen:()=>void}){
 const signature=`${proposals}-${statements}`;const [hidden,setHidden]=useState(true);
 useEffect(()=>{let dismissed:string|null=null;try{dismissed=sessionStorage.getItem(KEY)}catch{/* private mode: show it */}setHidden(dismissed===signature)},[signature]);
 const t=noticeText(proposals,statements);
 if(!t||hidden)return null;
 const hide=()=>{setHidden(true);try{sessionStorage.setItem(KEY,signature)}catch{/* nothing to keep */}};
 return <div role="status" aria-live="polite" style={{position:'fixed',top:76,left:12,right:12,zIndex:60,display:'flex',justifyContent:'flex-end',pointerEvents:'none'}}>
  <div style={{pointerEvents:'auto',maxWidth:420,width:'100%',background:'#0b0f24',color:'#eef0ff',borderRadius:16,padding:'14px 16px',boxShadow:'0 18px 50px rgba(11,15,36,.35)',
   borderLeft:'5px solid #6d5cf5',fontFamily:'inherit'}}>
   <p style={{margin:0,fontWeight:800,fontSize:16,lineHeight:1.3}}>{t.title}</p>
   <p style={{margin:'4px 0 12px',fontSize:14,lineHeight:1.45,color:'#c9cde6'}}>{t.text}</p>
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
    <button type="button" onClick={()=>{hide();onOpen()}} style={{font:'inherit',fontWeight:700,fontSize:14,border:0,borderRadius:999,padding:'9px 16px',minHeight:40,background:'#6d5cf5',color:'#fff',cursor:'pointer'}}>{t.action}</button>
    <button type="button" onClick={hide} style={{font:'inherit',fontWeight:600,fontSize:14,borderRadius:999,padding:'9px 14px',minHeight:40,background:'transparent',color:'#c9cde6',border:'1px solid rgba(255,255,255,.25)',cursor:'pointer'}}>Plus tard</button>
   </div>
  </div>
 </div>;
}
