import {STATUS_LABEL,dateFr,type ExportRow} from './model.ts';
// A dependency-free PDF of an export (A4 landscape, Helvetica, WinAnsi): one block per company with the delivery number,
// the item reference, the SIREN, the official source and its link. Text only — no image, no script, no form, no link
// annotation; characters outside WinAnsi become "?".
const WIN:Record<string,number>={'€':0x80,'‚':0x82,'„':0x84,'…':0x85,'‘':0x91,'’':0x92,'“':0x93,'”':0x94,'•':0x95,'–':0x96,'—':0x97,'œ':0x9c,'Œ':0x8c,'Ÿ':0x9f,' ':0x20,' ':0x20};
function winAnsi(s:string):number[]{
 const out:number[]=[];
 for(const ch of s){const c=ch.codePointAt(0)!;
  if(WIN[ch]!==undefined)out.push(WIN[ch]);else if(c>=0x20&&c<0x7f)out.push(c);else if(c>=0xa0&&c<=0xff)out.push(c);else out.push(0x3f);}
 return out;
}
const esc=(bytes:number[])=>bytes.map(b=>b===0x28||b===0x29||b===0x5c?`\\${String.fromCharCode(b)}`:b<0x20||b>0x7e?`\\${b.toString(8).padStart(3,'0')}`:String.fromCharCode(b)).join('');
const clip=(s:string,n:number)=>s.length>n?`${s.slice(0,n-1)}…`:s;
type Line={x:number;size:number;bold?:boolean;text:string};
type Placed=Line&{y:number};

export function exportPdf(o:{title:string;subtitle:string;rows:ExportRow[];generatedAt:Date}):Uint8Array{
 const W=842,H=595,M=36,LH=12;
 const pages:Placed[][]=[];let page:Placed[]=[];let y=H-M;
 const header=():Line[][]=>[[{x:M,size:14,bold:true,text:o.title}],[{x:M,size:9,text:o.subtitle}],[{x:M,size:8,text:`Export du ${dateFr(o.generatedAt.toISOString())} — ${o.rows.length} fiche${o.rows.length>1?'s':''}. Chaque ligne porte le numéro de livraison et l’identifiant de la fiche.`}]];
 const push=(block:Line[][])=>{if(y-block.length*LH<M+LH){pages.push(page);page=[];y=H-M}for(const l of block){for(const x of l)page.push({...x,y});y-=LH}};
 push(header());y-=LH/2;
 for(const r of o.rows){
  push([[{x:M,size:9,bold:true,text:`Liv. ${r.delivery_number} · ${r.reference}`},{x:M+110,size:9,bold:true,text:clip(r.name,60)},{x:M+470,size:9,text:`SIREN ${r.siren}`},{x:M+580,size:9,text:clip(r.city??'—',24)},{x:M+700,size:9,text:STATUS_LABEL[r.status]}],
   [{x:M+110,size:8,text:`${clip(r.source_label,48)} — livrée le ${dateFr(r.delivered_on)}`}],
   [{x:M+110,size:7,text:clip(r.source_url,150)}]]);
  y-=LH/3;
 }
 pages.push(page);
 const objects:string[]=[];
 const add=(s:string)=>{objects.push(s);return objects.length};
 const catalog=add(''),pagesObj=add(''),font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
 const kids:number[]=[];
 pages.forEach((p,n)=>{
  const ops=p.map(l=>`BT /${l.bold?'F2':'F1'} ${l.size} Tf ${l.x} ${l.y} Td (${esc(winAnsi(l.text))}) Tj ET`);
  ops.push(`BT /F1 7 Tf ${W-M-60} ${M/2} Td (${esc(winAnsi(`Page ${n+1} / ${pages.length}`))}) Tj ET`);
  const stream=ops.join('\n');
  const content=add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
 });
 objects[catalog-1]=`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
 objects[pagesObj-1]=`<< /Type /Pages /Kids [${kids.map(k=>`${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
 let body='%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';const offsets:number[]=[];
 objects.forEach((obj,i)=>{offsets.push(body.length);body+=`${i+1} 0 obj\n${obj}\nendobj\n`});
 const xref=body.length;
 body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(x=>`${String(x).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 // Every character of `body` is a single byte (WinAnsi bytes were escaped to ASCII), so latin1 keeps the offsets exact.
 return Uint8Array.from(body,c=>c.charCodeAt(0)&0xff);
}
