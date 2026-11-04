// ICP import, step 2A — turning what a person gives (pasted text, a PDF, a DOCX) into plain text for the extraction.
// docs/ICP_IMPORT.md. Read in memory, never stored, never executed:
//  - the file type comes from its first bytes (magic bytes), never from its name or the declared Content-Type;
//  - every size is bounded BEFORE the work it guards: the body (4 MiB), the DOCX archive (entries, decompressed bytes,
//    counted while inflating — a zip bomb is stopped mid-stream), the PDF (30 pages, a time limit);
//  - a PDF without a text layer (a scan) is refused with an explicit message — no OCR;
//  - nothing here calls the database, the quota or the AI: an unreadable file costs nothing.
import JSZip from 'jszip';

export const MAX_UPLOAD_BYTES=4*1024*1024; // 4 MiB — under Vercel's 4.5 MB request body limit, read raw (never base64)
export const MAX_TEXT_CHARS=50_000; // pasted text above this is refused; extracted text above it is cut, with a warning
export const MIN_TEXT_CHARS=30;
export const MAX_PDF_PAGES=30;
export const PDF_TIMEOUT_MS=15_000;
export const DOCX_MAX_ENTRIES=1_000;
export const DOCX_MAX_XML_BYTES=10*1024*1024; // word/document.xml, decompressed
export const SCANNED_PDF_MIN_CHARS=50; // fewer visible characters than this over the pages read = no text layer

export type IngestCode=
 |'FILE_EMPTY'|'FILE_TOO_LARGE'|'UNSUPPORTED_FILE'
 |'TEXT_TOO_SHORT'|'TEXT_TOO_LONG'
 |'PDF_SCANNED'|'PDF_UNREADABLE'|'PDF_ENCRYPTED'|'PDF_TIMEOUT'
 |'DOCX_UNREADABLE'|'DOCX_TOO_LARGE';
export type IngestWarning='TEXT_TRUNCATED'|'PDF_PAGES_TRUNCATED';
export class IngestError extends Error{
 readonly code:IngestCode;
 constructor(code:IngestCode){super(code);this.name='IngestError';this.code=code}
}
export type Ingested={sourceType:'PDF'|'DOCX'|'TEXT';text:string;warnings:IngestWarning[];pages?:number};

// The one answer a person reads for each refusal — what happened and what to do instead.
export const INGEST_MESSAGES:Record<IngestCode,string>={
 FILE_EMPTY:'Le fichier est vide.',
 FILE_TOO_LARGE:'Fichier trop volumineux (4 Mo maximum). Importez plutôt l’adresse de votre site, ou collez le texte de votre présentation.',
 UNSUPPORTED_FILE:'Format non reconnu : seuls les PDF et les documents Word (.docx) sont acceptés. Vous pouvez aussi coller le texte.',
 TEXT_TOO_SHORT:'Texte trop court pour décrire votre entreprise (30 caractères minimum).',
 TEXT_TOO_LONG:'Texte trop long (50 000 caractères maximum). Gardez la présentation de l’entreprise et de l’offre.',
 PDF_SCANNED:'Ce PDF ne contient pas de texte lisible (document scanné ou image). Collez le texte de votre présentation à la place.',
 PDF_UNREADABLE:'Ce PDF n’a pas pu être lu. Essayez un autre export, ou collez le texte.',
 PDF_ENCRYPTED:'Ce PDF est protégé par un mot de passe. Exportez-le sans protection, ou collez le texte.',
 PDF_TIMEOUT:'La lecture de ce PDF a pris trop de temps. Collez le texte de votre présentation à la place.',
 DOCX_UNREADABLE:'Ce document Word n’a pas pu être lu. Enregistrez-le à nouveau en .docx, ou collez le texte.',
 DOCX_TOO_LARGE:'Ce document Word est trop volumineux une fois décompressé. Collez le texte de votre présentation à la place.',
};

const startsWith=(b:Uint8Array,sig:number[])=>b.length>=sig.length&&sig.every((v,i)=>b[i]===v);
const PDF_MAGIC=[0x25,0x50,0x44,0x46,0x2d]; // %PDF-
const ZIP_MAGIC=[0x50,0x4b,0x03,0x04]; // PK\x03\x04 (a DOCX is a zip archive)
export function sniff(bytes:Uint8Array):'PDF'|'ZIP'|null{
 return startsWith(bytes,PDF_MAGIC)?'PDF':startsWith(bytes,ZIP_MAGIC)?'ZIP':null;
}

// Plain text for the model: Unicode-normalized, control characters removed (tab and line breaks kept), blank runs
// collapsed. Never interpreted — markup and instructions inside stay inert characters.
export function cleanText(raw:string):string{
 return raw.normalize('NFC').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g,'')
  .replace(/[ \t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function bounded(text:string,warnings:IngestWarning[]):string{
 if(text.length<=MAX_TEXT_CHARS)return text;
 warnings.push('TEXT_TRUNCATED');
 return text.slice(0,MAX_TEXT_CHARS);
}

export function ingestText(raw:unknown):Ingested{
 if(typeof raw!=='string')throw new IngestError('TEXT_TOO_SHORT');
 if(raw.length>MAX_TEXT_CHARS*2)throw new IngestError('TEXT_TOO_LONG'); // before any work on an absurd input
 const text=cleanText(raw);
 if(text.length<MIN_TEXT_CHARS)throw new IngestError('TEXT_TOO_SHORT');
 if(text.length>MAX_TEXT_CHARS)throw new IngestError('TEXT_TOO_LONG');
 return {sourceType:'TEXT',text,warnings:[]};
}

export async function ingestFile(bytes:Uint8Array,options?:{pdfTimeoutMs?:number}):Promise<Ingested>{
 if(bytes.byteLength===0)throw new IngestError('FILE_EMPTY');
 if(bytes.byteLength>MAX_UPLOAD_BYTES)throw new IngestError('FILE_TOO_LARGE');
 const kind=sniff(bytes);
 if(kind==='PDF')return ingestPdf(bytes,options?.pdfTimeoutMs??PDF_TIMEOUT_MS);
 if(kind==='ZIP')return ingestDocx(bytes);
 throw new IngestError('UNSUPPORTED_FILE');
}

// ---------- DOCX ----------
const XML_ENTITIES:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:'\''};
function decodeXml(s:string):string{
 return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g,(_,e:string)=>{
  if(e[0]!=='#')return XML_ENTITIES[e]!;
  const cp=e[1]==='x'||e[1]==='X'?Number.parseInt(e.slice(2),16):Number.parseInt(e.slice(1),10);
  return cp>0&&cp<=0x10FFFF?String.fromCodePoint(cp):'';
 });
}
// The visible text of word/document.xml: runs (<w:t>), tabs, line breaks, one line per paragraph. Nothing else is read
// (no macros, no embedded objects, no external relationships).
export function docxXmlToText(xml:string):string{
 const out:string[]=[];
 for(const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\/>/g)){
  if(m[1]!==undefined)out.push(decodeXml(m[1]));
  else if(m[0]==='<w:tab/>')out.push('\t');
  else out.push('\n');
 }
 return out.join('');
}
// Inflates one entry while counting: past the cap the stream is paused and the read refused — the archive's own
// declared sizes are never trusted.
function inflateBounded(file:JSZip.JSZipObject,cap:number):Promise<Uint8Array>{
 return new Promise((resolve,reject)=>{
  const chunks:Uint8Array[]=[];let total=0;let done=false;
  type Helper={on(e:'data',cb:(c:Uint8Array)=>void):Helper;on(e:'end',cb:()=>void):Helper;on(e:'error',cb:(e:unknown)=>void):Helper;pause():Helper;resume():Helper};
  const stream=(file as unknown as {internalStream(t:'uint8array'):Helper}).internalStream('uint8array');
  stream.on('data',chunk=>{
   if(done)return;
   total+=chunk.byteLength;
   if(total>cap){done=true;stream.pause();reject(new IngestError('DOCX_TOO_LARGE'));return}
   chunks.push(chunk);
  }).on('error',()=>{if(!done){done=true;reject(new IngestError('DOCX_UNREADABLE'))}})
   .on('end',()=>{if(done)return;done=true;const out=new Uint8Array(total);let at=0;for(const c of chunks){out.set(c,at);at+=c.byteLength}resolve(out)});
  stream.resume();
 });
}
async function ingestDocx(bytes:Uint8Array):Promise<Ingested>{
 let zip:JSZip;
 try{zip=await JSZip.loadAsync(bytes,{checkCRC32:false})}catch{throw new IngestError('DOCX_UNREADABLE')}
 if(Object.keys(zip.files).length>DOCX_MAX_ENTRIES)throw new IngestError('DOCX_TOO_LARGE');
 const document=zip.file('word/document.xml');
 if(!document||!zip.file('[Content_Types].xml'))throw new IngestError('UNSUPPORTED_FILE'); // a zip, but not a Word document
 const xml=new TextDecoder('utf-8',{fatal:false}).decode(await inflateBounded(document,DOCX_MAX_XML_BYTES));
 const warnings:IngestWarning[]=[];
 const text=bounded(cleanText(docxXmlToText(xml)),warnings);
 if(text.length<MIN_TEXT_CHARS)throw new IngestError('TEXT_TOO_SHORT');
 return {sourceType:'DOCX',text,warnings};
}

// ---------- PDF ----------
type PdfPage={getTextContent():Promise<{items:unknown[]}>};
type PdfDocument={numPages:number;getPage(n:number):Promise<PdfPage>;loadingTask:{destroy():Promise<void>}};
async function readPdf(bytes:Uint8Array,signal:{aborted:boolean},deadline:number):Promise<{text:string;pages:number;truncated:boolean}>{
 const {getDocumentProxy}=await import('unpdf');
 let doc:PdfDocument;
 try{
  // Text only: no font face is loaded, no system font is read, XFA forms stay off. The pinned PDF.js build has no
  // font-to-code compilation path at all (no eval / new Function — the CVE-2024-4367 class), checked when pinning.
  doc=await getDocumentProxy(bytes.slice(),{disableFontFace:true,useSystemFonts:false,enableXfa:false,stopAtErrors:false,verbosity:0}) as unknown as PdfDocument;
 }catch(e){
  if((e as {name?:string})?.name==='PasswordException')throw new IngestError('PDF_ENCRYPTED');
  throw new IngestError('PDF_UNREADABLE');
 }
 try{
  const pages=Math.min(doc.numPages,MAX_PDF_PAGES);const parts:string[]=[];
  for(let n=1;n<=pages;n++){
   if(signal.aborted||Date.now()>=deadline)throw new IngestError('PDF_TIMEOUT'); // checked between pages too
   const content=await (await doc.getPage(n)).getTextContent();
   parts.push(content.items.map(i=>{const it=i as {str?:unknown;hasEOL?:unknown};return (typeof it.str==='string'?it.str:'')+(it.hasEOL===true?'\n':'')}).join(''));
  }
  return {text:parts.join('\n\n'),pages,truncated:doc.numPages>MAX_PDF_PAGES};
 }catch(e){
  if(e instanceof IngestError)throw e;
  throw new IngestError('PDF_UNREADABLE');
 }finally{
  await doc.loadingTask.destroy().catch(()=>{});
 }
}
async function ingestPdf(bytes:Uint8Array,timeoutMs:number):Promise<Ingested>{
 const signal={aborted:false};let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{signal.aborted=true;reject(new IngestError('PDF_TIMEOUT'))},timeoutMs)});
 let read:{text:string;pages:number;truncated:boolean};
 try{read=await Promise.race([readPdf(bytes,signal,Date.now()+timeoutMs),timeout])}finally{clearTimeout(timer)}
 const warnings:IngestWarning[]=read.truncated?['PDF_PAGES_TRUNCATED']:[];
 const text=cleanText(read.text);
 if(text.replace(/\s/g,'').length<SCANNED_PDF_MIN_CHARS)throw new IngestError('PDF_SCANNED');
 return {sourceType:'PDF',text:bounded(text,warnings),warnings,pages:read.pages};
}

// ---------- request body ----------
// The raw body of an upload, read chunk by chunk and stopped one byte past the limit — the whole stream is never
// buffered first. A declared Content-Length above the limit is refused before reading anything.
export async function readBoundedBody(request:Request,maxBytes:number):Promise<Uint8Array>{
 const declared=request.headers.get('content-length');
 if(declared!==null&&/^\d+$/.test(declared)&&Number(declared)>maxBytes)throw new IngestError('FILE_TOO_LARGE');
 if(!request.body)return new Uint8Array(0);
 const reader=request.body.getReader();const chunks:Uint8Array[]=[];let total=0;
 for(;;){
  const {done,value}=await reader.read();
  if(done)break;
  total+=value.byteLength;
  if(total>maxBytes){await reader.cancel().catch(()=>{});throw new IngestError('FILE_TOO_LARGE')}
  chunks.push(value);
 }
 const out=new Uint8Array(total);let at=0;for(const c of chunks){out.set(c,at);at+=c.byteLength}
 return out;
}

// What the import row says about the file: its name as the person's browser gave it, reduced to a short label.
// Never a path, never used to decide the type.
export function sourceLabel(rawName:string|null,sourceType:'PDF'|'DOCX'|'TEXT'):string{
 let name='';
 if(rawName){try{name=decodeURIComponent(rawName)}catch{name=rawName}}
 name=name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001F\u007F]/g,'').trim().slice(0,200);
 return name||(sourceType==='TEXT'?'Texte collé':sourceType==='PDF'?'document.pdf':'document.docx');
}
