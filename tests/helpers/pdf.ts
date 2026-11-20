// Minimal, valid PDF files built in memory for the ingestion tests: one Helvetica text line per page (or no text at all,
// like a scan). Byte offsets in the xref table are computed, so PDF.js reads them without repair.
export function buildPdf(pages:(string|null)[]):Uint8Array{
 const objects:string[]=[];
 const esc=(s:string)=>s.replace(/[\\()]/g,m=>'\\'+m);
 const kids:number[]=[];
 // 1 catalog, 2 pages, 3 font, then for each page: page object + content stream
 pages.forEach((text,i)=>{
  const pageId=4+i*2,contentId=5+i*2;kids.push(pageId);
  const stream=text===null?'q 0 0 0 rg 10 10 100 100 re f Q':`BT /F1 12 Tf 40 760 Td (${esc(text)}) Tj ET`;
  objects[pageId]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
  objects[contentId]=`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`;
 });
 objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
 objects[2]=`<< /Type /Pages /Kids [${kids.map(k=>`${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
 objects[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
 let out='%PDF-1.4\n';const offsets:number[]=[];
 for(let id=1;id<objects.length;id++){offsets[id]=Buffer.byteLength(out,'latin1');out+=`${id} 0 obj\n${objects[id]}\nendobj\n`}
 const xref=Buffer.byteLength(out,'latin1');
 out+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('');
 out+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return new Uint8Array(Buffer.from(out,'latin1'));
}
