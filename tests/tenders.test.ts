// Open public tenders from the BOAMP (src/tenders/boamp.ts, src/tenders/api.ts): a read-only list of opportunities,
// behind TENDERS_ENABLED. The fixture is a real BOAMP answer (public notice fields only, fetched 2026-11-09).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseTenderQuery,tendersUrl,toTender,searchOpenTenders,TendersError,BOAMP_RECORDS,TENDERS_LIMIT} from '../src/tenders/boamp.ts';
import {handleTenders,tendersEnabled,TENDERS_DISABLED,type TendersDeps} from '../src/tenders/api.ts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/tenders/boamp-open-gironde.json',import.meta.url),'utf8'));
const NOW=new Date('2026-11-09T09:00:00Z');
const json=(v:unknown,status=200)=>Response.json(v,{status});
const ok=(body:unknown)=>async()=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
const refusal=(f:()=>unknown,code:string)=>assert.throws(f,(e:unknown)=>e instanceof TendersError&&e.message===code,code);

test('query — keywords and departments are cleaned, deduplicated and bounded',()=>{
 assert.deepEqual(parseTenderQuery(' graffiti ,  Façade  pierre, GRAFFITI ,','33, 2a,33 ,974'),{keywords:['graffiti','Façade pierre'],departments:['33','2A','974']});
 refusal(()=>parseTenderQuery('',''),'KEYWORDS_REQUIRED');
 refusal(()=>parseTenderQuery('a,b,c,d,e,f'.split(',').map(x=>x+'x').join(','),'33'),'TOO_MANY_KEYWORDS');
 refusal(()=>parseTenderQuery('graffiti','00'),'DEPARTMENT_INVALID');
 refusal(()=>parseTenderQuery('graffiti','75,99'),'DEPARTMENT_INVALID');
 refusal(()=>parseTenderQuery('graffiti',''),'DEPARTMENTS_REQUIRED');
 refusal(()=>parseTenderQuery('graffiti','01,02,03,04,05,06,07,08,09,10,11,12,13,14'),'TOO_MANY_DEPARTMENTS');
 refusal(()=>parseTenderQuery('x','33'),'KEYWORD_INVALID');
 refusal(()=>parseTenderQuery('a'.repeat(61),'33'),'KEYWORD_INVALID');
});

test('query — nothing typed can change the BOAMP query: quotes, parentheses, operators are refused',()=>{
 for(const bad of ['graffiti")) or (nature="ATTRIBUTION','pierre" or 1=1','façade\\','dallage;','x*','#tag','(test)','a"b','search(objet,"x")'])
  refusal(()=>parseTenderQuery(bad,'33'),'KEYWORD_INVALID');
 // and again where the text is built, even if a caller skips parseTenderQuery
 refusal(()=>tendersUrl({keywords:['a" or "1'],departments:['33']},NOW),'KEYWORD_INVALID');
 refusal(()=>tendersUrl({keywords:['graffiti'],departments:['33") or ("1']},NOW),'DEPARTMENT_INVALID');
});

test('query — fixed host and fields: open notices only, no contact block, deadline after today, at most 50',()=>{
 const u=tendersUrl(parseTenderQuery('graffiti, l’enduit','33,40'),NOW);
 assert.equal(`${u.origin}${u.pathname}`,BOAMP_RECORDS);
 assert.equal(u.searchParams.get('where'),`nature="APPEL_OFFRE" and datelimitereponse>date'2026-11-09' and (search(objet,"graffiti") or search(objet,"l'enduit")) and (code_departement="33" or code_departement="40")`);
 assert.equal(u.searchParams.get('select'),'idweb,objet,code_departement,dateparution,datelimitereponse,nomacheteur,nature,type_marche,descripteur_libelle,procedure_libelle,url_avis');
 assert.ok(!/donnees|gestion|titulaire/.test(u.searchParams.get('select')!),'never the contact or award blocks');
 assert.equal(u.searchParams.get('order_by'),'datelimitereponse asc');
 assert.equal(u.searchParams.get('limit'),String(TENDERS_LIMIT));
});

test('notices — the real answer: every open notice is kept, with its official link and deadline',()=>{
 const t=fixture.results.map((r:unknown)=>toTender(r,NOW)).filter(Boolean);
 assert.equal(t.length,6);
 const g=t.find((x:{id:string})=>x.id==='26-102913');
 assert.deepEqual(g,{id:'26-102913',subject:'Fourniture de produits et matériels spécifiques pour enlèvement des graffitis et protection des supports - Bordeaux Métropole',
  buyer:'Bordeaux Métropole',departments:['33'],publishedOn:'2026-10-24',deadline:'2026-11-24T15:00:00.000Z',contractTypes:['FOURNITURES'],
  descriptors:['Produits chimiques',"Produits d'entretien"],procedure:'Procédure Ouverte',url:'https://www.boamp.fr/pages/avis/?q=idweb:26-102913'});
 assert.ok(t.every((x:{subject:string})=>!/\n/.test(x.subject)),'subjects on one line');
});

test('notices — anything not an open, official, well-formed notice is dropped',()=>{
 const base=fixture.results[2];
 const drop=(over:Record<string,unknown>)=>assert.equal(toTender({...base,...over},NOW),null,JSON.stringify(over));
 drop({nature:'ATTRIBUTION'});
 drop({datelimitereponse:'2026-11-09T08:59:00+00:00'});
 drop({datelimitereponse:'demain'});
 drop({url_avis:'https://evil.example/pages/avis/?q=idweb:26-102913'});
 drop({url_avis:'https://www.boamp.fr/pages/avis/?q=idweb:26-999999'});
 drop({idweb:'26_102913'});
 drop({objet:'   '});
 drop({nomacheteur:null});
 drop({dateparution:'24/10/2026'});
 assert.equal(toTender(null,NOW),null);assert.equal(toTender('x',NOW),null);
 const long=toTender({...base,objet:'a'.repeat(1000)},NOW)!;assert.equal(long.subject.length,400);
});

test('search — redirects refused, a timeout set, results deduplicated and sorted by deadline',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];
 const doubled={total_count:7,results:[...fixture.results].reverse().concat(fixture.results[2])};
 const r=await searchOpenTenders(parseTenderQuery('graffiti','33'),{now:NOW,fetch:(async(url:string,init:RequestInit)=>{calls.push({url,init});return ok(doubled)()}) as typeof fetch});
 assert.equal(calls.length,1);assert.equal(calls[0]!.init.redirect,'error');assert.ok(calls[0]!.init.signal);
 assert.equal(r.tenders.length,6);assert.equal(r.total,7);
 const d=r.tenders.map(t=>t.deadline);assert.deepEqual(d,[...d].sort());
});

test('search — an unreachable, failing, oversized or malformed source is TENDERS_UNAVAILABLE',async()=>{
 const q=parseTenderQuery('graffiti','33');
 const unavailable=(p:Promise<unknown>)=>assert.rejects(p,(e:unknown)=>e instanceof TendersError&&e.message==='TENDERS_UNAVAILABLE');
 await unavailable(searchOpenTenders(q,{now:NOW,fetch:(async()=>{throw new TypeError('network')}) as typeof fetch}));
 await unavailable(searchOpenTenders(q,{now:NOW,fetch:(async()=>new Response('{}',{status:500})) as typeof fetch}));
 await unavailable(searchOpenTenders(q,{now:NOW,fetch:(async()=>new Response('not json')) as typeof fetch}));
 await unavailable(searchOpenTenders(q,{now:NOW,fetch:(async()=>new Response('{"results":"x"}')) as typeof fetch}));
 await unavailable(searchOpenTenders(q,{now:NOW,fetch:(async()=>new Response('x'.repeat(2_000_001))) as typeof fetch}));
});

test('switch — TENDERS_ENABLED off by default; off, the route answers 404 before reading anything',async()=>{
 for(const v of [undefined,'','false','0','on'])assert.equal(tendersEnabled({TENDERS_ENABLED:v}),false,String(v));
 for(const v of ['true','1',' TRUE '])assert.equal(tendersEnabled({TENDERS_ENABLED:v}),true,v);
 let touched=0;
 const deps=(enabled:boolean):TendersDeps=>({enabled,now:()=>NOW,requireEntitlement:async()=>{touched++},fetch:(async()=>{touched++;return ok(fixture)()}) as typeof fetch});
 const off=await handleTenders(new Request('https://x.test/api/v1/tenders?keywords=graffiti&departments=33'),['tenders'],json,deps(false));
 assert.equal(off!.status,404);assert.deepEqual(await off!.json(),{error:'Route ou action non disponible',code:TENDERS_DISABLED});
 assert.equal(touched,0,'off: no entitlement check, no call to the BOAMP');
 assert.equal(await handleTenders(new Request('https://x.test/api/v1/projects'),['projects'],json,deps(false)),null,'other routes untouched');
});

test('route — on: entitlement first, GET only, refusals in French, the list with its provenance',async()=>{
 const seen:string[]=[];const logs:Record<string,unknown>[]=[];
 const deps:TendersDeps={enabled:true,now:()=>NOW,requireEntitlement:async()=>{seen.push('entitlement')},log:e=>{logs.push(e)},
  fetch:(async(u:string)=>{seen.push('fetch');assert.ok(u.startsWith(BOAMP_RECORDS));return ok(fixture)()}) as typeof fetch};
 const res=await handleTenders(new Request('https://x.test/api/v1/tenders?keywords=graffiti,fa%C3%A7ade&departments=33'),['tenders'],json,deps);
 assert.equal(res!.status,200);assert.deepEqual(seen,['entitlement','fetch']);
 const body=await res!.json();
 assert.equal(body.tenders.length,6);assert.deepEqual(body.query,{keywords:['graffiti','façade'],departments:['33']});
 assert.match(body.provenance.source,/BOAMP/);
 assert.deepEqual(logs,[{component:'tenders',event:'search',keywords:2,departments:1,results:6}],'the log carries counts, never the words typed');
 const bad=await handleTenders(new Request('https://x.test/api/v1/tenders?keywords=a%22b&departments=33'),['tenders'],json,deps);
 assert.equal(bad!.status,400);assert.equal((await bad!.json()).code,'KEYWORD_INVALID');
 const post=await handleTenders(new Request('https://x.test/api/v1/tenders',{method:'POST'}),['tenders'],json,deps);assert.equal(post!.status,404);
 const sub=await handleTenders(new Request('https://x.test/api/v1/tenders/x'),['tenders','x'],json,deps);assert.equal(sub!.status,404);
 const down=await handleTenders(new Request('https://x.test/api/v1/tenders?keywords=graffiti&departments=33'),['tenders'],json,{...deps,fetch:(async()=>{throw new TypeError('x')}) as typeof fetch});
 assert.equal(down!.status,503);assert.equal((await down!.json()).code,'TENDERS_UNAVAILABLE');
});

test('route — wired in the API router with the switch from the server environment',()=>{
 const route=readFileSync(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.match(route,/import \{handleTenders,tendersEnabled\} from '\.\.\/\.\.\/\.\.\/\.\.\/src\/tenders\/api';/);
 assert.match(route,/handleTenders\(request,path,json,\{enabled:tendersEnabled\(process\.env\),requireEntitlement:\(\)=>requireActiveEntitlement\(db,user\.id\),/);
 assert.ok(route.indexOf('handleTenders(')<route.indexOf("const raw=await request.text()"),'answered before the generic body read');
});
