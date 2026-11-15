'use client';
// Veille dédiée — the two screens wired to the API (src/dedicated/api.ts), as the signed-in user. Every refusal is the
// server's sentence; after each change the data is read again (the database is the source of truth).
import {useCallback,useEffect,useState} from 'react';
import {parisDate} from '../../../dedicated/model.ts';
import {DedicatedClientView,DedicatedAdminView,type ClientData,type HistoryEntry,type StatusChange,type AdminView,type OrgHit} from './DedicatedViews.tsx';
// A PDF chosen by the administrator → base64 for the JSON body (the server recomputes its SHA-256 from the bytes).
async function fileBase64(f:File):Promise<string>{const b=new Uint8Array(await f.arrayBuffer());let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode(...b.subarray(i,i+0x8000));return btoa(s)}
const pdfName=(f:File)=>(f.name.normalize('NFD').replace(/[^A-Za-z0-9._ -]/g,'').replace(/\.pdf$/i,'').slice(0,100)||'proposition')+'.pdf';
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
const message=(e:unknown)=>e instanceof Error&&e.message?e.message:'Action impossible pour le moment.';

export function DedicatedClient({api,token}:{api:Api;token:string}){
 const [data,setData]=useState<ClientData|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const load=useCallback(async()=>{try{setData(await api('dedicated'));setError('')}catch(e){setError(message(e))}},[api]);
 useEffect(()=>{load()},[load]);
 const run=async(fn:()=>Promise<void>,done:string)=>{setBusy(true);setError('');setNotice('');try{await fn();setNotice(done);await load()}catch(e){setError(message(e))}finally{setBusy(false)}};
 const onExport=async(contractId:string,deliveryId:string|null,format:'csv'|'pdf')=>run(async()=>{
  const q=new URLSearchParams({contract_id:contractId,format,...(deliveryId?{delivery_id:deliveryId}:{})});
  const res=await fetch(`/api/v1/dedicated/export?${q}`,{headers:{Authorization:`Bearer ${token}`}});
  if(!res.ok){let m='Export impossible pour le moment.';try{m=(await res.json()).error??m}catch{}throw Error(m)}
  const name=/filename="([^"]+)"/.exec(res.headers.get('content-disposition')??'')?.[1]??`veille.${format}`;
  const url=URL.createObjectURL(await res.blob());const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 },'Export téléchargé et inscrit au journal.');
 if(!data)return <div className="pos-ded">{error?<p className="pos-ded__note pos-ded__note--error" role="alert">{error}</p>:<p className="pos-ded__muted">Chargement…</p>}</div>;
 const onReadProposal=(contractId:string)=>run(async()=>{
  const res=await fetch(`/api/v1/dedicated/proposals/${contractId}/pdf`,{headers:{Authorization:`Bearer ${token}`}});
  if(!res.ok)throw Error('Proposition indisponible pour le moment.');
  const url=URL.createObjectURL(await res.blob());window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000);
 },'');
 return <DedicatedClientView data={data} today={parisDate(new Date())} busy={busy} error={error} notice={notice}
  onReadProposal={onReadProposal}
  onAccept={(contractId,sha256)=>run(async()=>{await api(`dedicated/proposals/${contractId}/accept`,'POST',{sha256})},'Proposition acceptée : votre espace de suivi est ouvert. Un e-mail de confirmation vous est envoyé.')}
  onValidate={id=>run(async()=>{await api(`dedicated/statements/${id}/validate`,'POST',{attestation:(data as ClientData&{attestation?:string}).attestation})},'Relevé validé. Merci.')}
  onOpen={async id=>((await api(`dedicated/items/${id}/open`,'POST',{})).history as HistoryEntry[])}
  onStatus={(id,c:StatusChange)=>run(async()=>{await api(`dedicated/items/${id}/status`,'POST',c)},'Statut enregistré.')}
  onExport={onExport}/>;
}

export function DedicatedAdmin({api}:{api:Api}){
 const [rows,setRows]=useState<AdminView[]|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const load=useCallback(async()=>{try{setRows(await api('dedicated/admin'));setError('')}catch(e){setError(message(e))}},[api]);
 useEffect(()=>{load()},[load]);
 const run=async(fn:()=>Promise<string>)=>{setBusy(true);setError('');setNotice('');try{setNotice(await fn());await load()}catch(e){setError(message(e))}finally{setBusy(false)}};
 if(!rows)return <div className="pos-ded">{error?<p className="pos-ded__note pos-ded__note--error" role="alert">{error}</p>:<p className="pos-ded__muted">Chargement…</p>}</div>;
 return <DedicatedAdminView rows={rows} busy={busy} error={error} notice={notice}
  onDelivery={(contract_id,scope,lines)=>run(async()=>{const r=await api('dedicated/admin/deliveries','POST',{contract_id,scope,lines});
   return `Livraison n° ${r.number} créée : ${r.items} fiche${r.items>1?'s':''}${r.skipped_sirens?.length?` (${r.skipped_sirens.length} déjà livrée${r.skipped_sirens.length>1?'s':''}, ignorée${r.skipped_sirens.length>1?'s':''})`:''}.`})}
  onSearch={async q=>{try{return (await api(`dedicated/admin/organizations?q=${encodeURIComponent(q)}`)) as OrgHit[]}catch{return []}}}
  onPropose={n=>run(async()=>{const {file,...rest}=n;await api('dedicated/admin/proposals','POST',{...rest,file_name:pdfName(file),pdf_base64:await fileBase64(file)});
   return `Veille proposée : le client la voit dans son espace avec le bouton « J’accepte la proposition ».`})}
  onReplace={(id,file)=>run(async()=>{const r=await api(`dedicated/admin/contracts/${id}/proposal`,'POST',{file_name:pdfName(file),pdf_base64:await fileBase64(file)});return `Version ${r.version} jointe.`})}
  onTerminate={id=>run(async()=>{const r=await api(`dedicated/admin/contracts/${id}/terminate`,'POST',{});return `Veille résiliée. Accès client en lecture et mise à jour des statuts jusqu’au ${new Date(r.access_until).toLocaleDateString('fr-FR')}.`})}/>;
}
