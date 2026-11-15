import {winAnsi,pdfString} from './pdf.ts';
// The delivery PDF as it was sent, plus a watermark and the delivery number — nothing else. Done as an INCREMENTAL UPDATE:
// the original bytes are kept as they are (they are the exact prefix of the result) and new objects are appended after
// them: per page, a print-visible Stamp annotation whose appearance (its own resources: Helvetica, transparency) draws
// the watermark and a footer line, and a new version of the page object that lists it in /Annots. The page content
// streams are not touched. Supported: a classic cross-reference table (what Chromium/Skia writes); a PDF with an xref
// stream or object streams is refused (PDF_NOT_STAMPABLE) rather than rewritten.
const latin1=(b:Uint8Array)=>{let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode(...b.subarray(i,i+0x8000));return s};
export class PdfNotStampable extends Error{constructor(why:string){super(`PDF_NOT_STAMPABLE: ${why}`)}}
function lastObject(s:string,id:number):string{
 const re=new RegExp(`(?:^|[\\r\\n])${id} 0 obj\\s*([\\s\\S]*?)endobj`,'g');let m:RegExpExecArray|null,last:string|null=null;
 while((m=re.exec(s)))last=m[1]!;
 if(last===null)throw new PdfNotStampable(`object ${id} not found`);
 return last.trim();
}
const ref=(dict:string,key:string)=>{const m=new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict);return m?Number(m[1]):null};
function pageIds(s:string,node:number,seen=new Set<number>()):number[]{
 if(seen.has(node))throw new PdfNotStampable('page tree loop');seen.add(node);
 const d=lastObject(s,node);
 if(/\/Type\s*\/Page\b(?!s)/.test(d))return [node];
 const kids=/\/Kids\s*\[([^\]]*)\]/.exec(d);if(!kids)throw new PdfNotStampable('page tree without /Kids');
 return [...kids[1]!.matchAll(/(\d+)\s+0\s+R/g)].flatMap(k=>pageIds(s,Number(k[1]),seen));
}
export function stampPdf(original:Uint8Array,o:{watermark:string;footer:string}):Uint8Array{
 const s=latin1(original);
 if(!s.startsWith('%PDF-'))throw new PdfNotStampable('not a PDF');
 if(/\/Type\s*\/XRef\b|\/Type\s*\/ObjStm\b/.test(s))throw new PdfNotStampable('cross-reference stream');
 const tpos=s.lastIndexOf('trailer');const sx=/startxref\s+(\d+)\s+%%EOF\s*$/.exec(s);
 if(tpos<0||!sx)throw new PdfNotStampable('no trailer');
 const trailer=s.slice(tpos,s.lastIndexOf('startxref'));
 const size=Number(/\/Size\s+(\d+)/.exec(trailer)?.[1]);const root=ref(trailer,'Root');const info=ref(trailer,'Info');
 if(!size||!root)throw new PdfNotStampable('incomplete trailer');
 const pagesRoot=ref(lastObject(s,root),'Pages');if(!pagesRoot)throw new PdfNotStampable('no page tree');
 const pages=pageIds(s,pagesRoot);
 let next=size;const objs:[number,string][]=[];const add=(body:string)=>{const id=next++;objs.push([id,body]);return id};
 const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
 const fontB=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
 const faint=add('<< /Type /ExtGState /ca 0.13 /CA 0.13 >>');
 const forms=new Map<string,number>();
 for(const pid of pages){
  const d=lastObject(s,pid);
  const mb=/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(d);
  const [x0,y0,x1,y1]=mb?mb.slice(1).map(Number) as [number,number,number,number]:[0,0,595.28,841.89];
  const w=x1-x0,h=y1-y0,key=`${w}x${h}`;
  let form=forms.get(key);
  if(form===undefined){
   // The watermark runs along the diagonal and stays inside the page: about 0.55 em per character in Helvetica-Bold.
   const c=Math.SQRT1_2;const size=Math.max(10,Math.min(Math.round(Math.min(w,h)/14),Math.floor(0.8*w/(o.watermark.length*0.55*c))));
   const wm=pdfString(winAnsi(o.watermark));const ft=pdfString(winAnsi(o.footer));const est=o.watermark.length*size*0.55;
   const stream=[`q /GSw gs 0.357 0.357 0.839 rg BT /Fb ${size} Tf ${c.toFixed(4)} ${c.toFixed(4)} ${(-c).toFixed(4)} ${c.toFixed(4)} ${(w/2-est*c/2).toFixed(1)} ${(h/2-est*c/2).toFixed(1)} Tm (${wm}) Tj ET Q`,
    `q 0.48 0.50 0.59 rg BT /F 7 Tf 14 6 Td (${ft}) Tj ET Q`].join('\n');
   form=add(`<< /Type /XObject /Subtype /Form /BBox [0 0 ${w} ${h}] /Resources << /Font << /F ${font} 0 R /Fb ${fontB} 0 R >> /ExtGState << /GSw ${faint} 0 R >> >> /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
   forms.set(key,form);
  }
  const annot=add(`<< /Type /Annot /Subtype /Stamp /Rect [${x0} ${y0} ${x1} ${y1}] /F 132 /NM (prospectos-livraison) /Contents (${pdfString(winAnsi(o.watermark))}) /AP << /N ${form} 0 R >> >>`);
  let nd:string;
  const inline=/\/Annots\s*\[([^\]]*)\]/.exec(d);const indirect=ref(d,'Annots');
  if(inline)nd=d.replace(inline[0],`/Annots [${inline[1]!.trim()} ${annot} 0 R]`);
  else if(indirect!==null){const arr=lastObject(s,indirect).replace(/^\[|\]$/g,'').trim();objs.push([indirect,`[${arr} ${annot} 0 R]`]);nd=d}
  else nd=d.replace(/>>\s*$/,` /Annots [${annot} 0 R]>>`);
  objs.push([pid,nd]);
 }
 // Appended section: the objects, then a cross-reference subsection per object, then the trailer chained by /Prev.
 let tail=s.endsWith('\n')?'':'\n';const offsets:[number,number][]=[];
 for(const [id,body] of objs){offsets.push([id,original.length+tail.length]);tail+=`${id} 0 obj\n${body}\nendobj\n`}
 const xrefAt=original.length+tail.length;
 tail+='xref\n'+offsets.sort((a,b)=>a[0]-b[0]).map(([id,off])=>`${id} 1\n${String(off).padStart(10,'0')} 00000 n\r\n`).join('');
 tail+=`trailer\n<< /Size ${next} /Root ${root} 0 R${info?` /Info ${info} 0 R`:''} /Prev ${sx[1]} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
 const out=new Uint8Array(original.length+tail.length);out.set(original);
 for(let i=0;i<tail.length;i++)out[original.length+i]=tail.charCodeAt(i)&0xff;
 return out;
}
