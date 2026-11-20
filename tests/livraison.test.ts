// Delivered lists (commercial/livraison.ts) and their follow-up view (src/ui/v2/dedicated/DeliveryView.tsx): the template
// of the PDFs already sent, one style sheet for the document and the application, the same card fields in the same order
// with the same labels, fiche n = the n-th card of the document, and the PDF exported from the tool = the PDF sent plus a
// watermark and the delivery number only (an incremental update: the original bytes are its exact prefix).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderHtml,toImport,issues,dateIso,type Livraison} from '../commercial/livraison.ts';
import {LIVRAISON_CSS,scopedLivraisonCss} from '../src/dedicated/livraison-style.ts';
import {stampPdf,PdfNotStampable} from '../src/dedicated/stamp.ts';
import {exportPdf} from '../src/dedicated/pdf.ts';
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const EX=JSON.parse(read('commercial/livraisons/exemple.json')) as Livraison;

test('template: the example is valid; cards numbered c1…cN in the document order, with the labels of the delivered PDFs',()=>{
 assert.deepEqual(issues(EX),[]);
 const html=renderHtml(EX,LIVRAISON_CSS);
 const ids=[...html.matchAll(/<div class="card" id="c(\d+)">/g)].map(m=>Number(m[1]));
 assert.deepEqual(ids,[1,2,3]);
 const names=[...html.matchAll(/<div class="nm">([^<]+)<\/div>/g)].map(m=>m[1]);
 assert.deepEqual(names,EX.sections.flatMap(s=>s.fiches.map(f=>f.nom)));
 for(const label of ['<span class="k">Le fait</span>','<span class="k">Pourquoi maintenant</span>','<span class="k">Votre accroche</span>','Voir la source officielle ↗','Préparé pour <b>','L’essentiel en une page','Méthode &amp; sources'])
  assert.ok(html.includes(label),label);
 assert.ok(html.includes(`<style>${LIVRAISON_CSS}</style>`),'the shared style sheet, as is');
 assert.ok(html.includes('<h1>3 entreprises<br>à appeler <em>maintenant</em>.</h1>'));
 assert.equal(dateIso('2 octobre 2026'),'2026-10-02');assert.equal(dateIso('1er janvier 2027'),'2027-01-01');assert.throws(()=>dateIso('octobre 2026'));
 const bad={...EX,sections:[{...EX.sections[0]!,fiches:[{...EX.sections[0]!.fiches[0]!,siren:'123',url:'http://x.fr'}]}]};
 assert.deepEqual(issues(bad as Livraison).slice(0,2),['fiche 1 (EXEMPLE LOGISTIQUE) : SIREN à 9 chiffres requis','fiche 1 (EXEMPLE LOGISTIQUE) : lien de source https requis']);
});

test('import file: the same cards in the same order, with the same fields — fiche n of the tool is card n of the PDF',()=>{
 const imp=toImport(EX);const html=renderHtml(EX,LIVRAISON_CSS);
 assert.deepEqual(imp.items.map(i=>i.name),[...html.matchAll(/<div class="nm">([^<]+)<\/div>/g)].map(m=>m[1]));
 const first=imp.items[0]!,f=EX.sections[0]!.fiches[0]!;
 assert.deepEqual([first.siren,first.city,first.department,first.event_label,first.event_date,first.badge,first.chips,first.fact,first.why_now,first.hook,first.source_url,first.section_key],
  [f.siren,f.ville,f.dep,f.date,'2026-11-12','BODACC',f.puces,f.fait,f.pourquoi,f.accroche,f.url,'tr']);
 assert.equal(imp.header.prepared_for,EX.client);assert.equal(imp.header.title_count,3);
 assert.deepEqual(imp.sections.map(s=>s.key),['tr','syn']);assert.equal(imp.sections[1]!.title,'Syndics & administrateurs de biens');
});

test('one style sheet: the application applies the document’s rules, confined to its block, nothing printed-only',()=>{
 const scoped=scopedLivraisonCss('.pos-livraison');
 const rules=(css:string)=>new Map([...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>[m[1]!.trim(),m[2]!.trim()]));
 const tpl=rules(LIVRAISON_CSS),app=rules(scoped);
 for(const sel of ['.card','.ch','.nm','.meta','.chip','.chip.ghost','.dt','.dt span','.dt b','.k','.why','.hook','.hook .k','.src','.sh','.sh h2','.sh p','.sn','.grid','.logo','.logo span','.for','.eyebrow','h1','h1 em'])
  assert.equal(app.get(`.pos-livraison ${sel}`),tpl.get(sel)!.replace(/page-break-[a-z]+:[^;]+;?|break-(?:after|before|inside):[^;]+;?/g,''),sel);
 assert.equal(app.get('.pos-livraison .fact,.pos-livraison .why'),tpl.get('.fact,.why'));
 assert.doesNotMatch(scoped,/@page|page-break|(^|\})\s*(html|body|\*)\s*[{,]/m);
 assert.ok([...app.keys()].every(k=>k.split(',').every(x=>x.trim().startsWith('.pos-livraison'))),'every rule stays in its block');
 // The generator writes the shared sheet; no second copy of the style exists.
 assert.match(read('commercial/livraison-cli.ts'),/renderHtml\(l,LIVRAISON_CSS\)/);
 assert.match(read('src/ui/v2/dedicated/DeliveryView.tsx'),/scopedLivraisonCss\('\.pos-ui \.pos-livraison'\)/);
});

test('follow-up view: the card’s fields in the PDF’s order and with its labels; status and journal come after, at the bottom',()=>{
 const v=read('src/ui/v2/dedicated/DeliveryView.tsx');const card=v.slice(v.indexOf('return <div className="card"'),v.indexOf('export function DeliveryDocument'));
 const order=['className="nm"','className="chip"','className="chip ghost"','className="dt"','<span className="k">Le fait</span>','<span className="k">Pourquoi maintenant</span>',
  '<span className="k">Votre accroche</span>','className="src"','Voir la source officielle ↗','className="fu"','Fiche n° ','aria-label={`Statut de','Journal de la fiche'];
 let last=-1;for(const o of order){const i=card.indexOf(o);assert.ok(i>last,`${o} after the previous field`);last=i}
 // The header: same logo, « Préparé pour », the eyebrow (with the delivery number added in front), the same title.
 assert.match(v,/<div className="logo"><span>P\.<\/span>ProspectOS<\/div>/);
 assert.match(v,/<div className="eyebrow">Livraison n° \{d\.number\} · \{h\.eyebrow/);
 assert.match(v,/<h1>\{count\} entreprises<br\/>à appeler <em>maintenant<\/em>\.<\/h1>/);
 assert.match(v,/<div className="sn">\{its\.length\} entreprises<\/div><h2>\{s\.title\}<\/h2><p>\{s\.subtitle\} · source : \{s\.source\}<\/p>/);
 // One column on a phone: the order inside a card does not change.
 assert.match(v,/@media \(max-width:700px\)\{.*\.pos-livraison \.grid\{grid-template-columns:1fr\}/);
});

test('PDF of the tool = the PDF sent + watermark + delivery number: incremental update, original bytes untouched',()=>{
 const original=exportPdf({title:'Document envoyé',subtitle:'Livraison',rows:[{id:'1',delivery_number:1,reference:'L1-F001',siren:'900000001',name:'EXEMPLE',city:'Meaux',source_label:'BODACC',
  source_url:'https://www.bodacc.fr/x',delivered_on:'2026-11-16',status:'A_CONTACTER'}],generatedAt:new Date('2026-11-16T10:00:00Z')});
 const stamped=stampPdf(original,{watermark:'Livraison n° 1 · Exemple · confidentiel',footer:'ProspectOS · Livraison n° 1 du 16 novembre 2026'});
 assert.ok(stamped.length>original.length);
 assert.deepEqual(stamped.subarray(0,original.length),original,'the document sent is the exact prefix');
 const tail=Buffer.from(stamped.subarray(original.length)).toString('latin1');
 const prev=/startxref\n(\d+)\n%%EOF\n$/.exec(Buffer.from(original).toString('latin1'))![1];
 assert.match(tail,new RegExp(`/Prev ${prev} >>`),'the new section chains to the original cross-reference');
 assert.match(tail,/\/Subtype \/Stamp \/Rect \[[^\]]+\] \/F 132 \/NM \(prospectos-livraison\)/);
 assert.match(tail,/\(Livraison n\\260 1 \\267 Exemple \\267 confidentiel\) Tj/,'the watermark and the delivery number');
 assert.match(tail,/\/Annots \[\d+ 0 R\]/,'the page lists the stamp');
 assert.doesNotMatch(tail,/\/JavaScript|\/OpenAction|\/URI|\/Launch/);
 const xref=Number(/startxref\n(\d+)\n%%EOF\n$/.exec(Buffer.from(stamped).toString('latin1'))![1]);
 assert.equal(Buffer.from(stamped.subarray(xref,xref+4)).toString('latin1'),'xref');
 assert.throws(()=>stampPdf(new TextEncoder().encode('not a pdf'),{watermark:'x',footer:'y'}),PdfNotStampable);
 assert.throws(()=>stampPdf(new TextEncoder().encode('%PDF-1.7\n1 0 obj<</Type /XRef>>endobj\nstartxref\n9\n%%EOF\n'),{watermark:'x',footer:'y'}),PdfNotStampable);
 assert.match(read('src/dedicated/api.ts'),/stampPdf\(byteaToBytes\(dd\.pdf\),\{watermark:`Livraison n° \$\{dd\.number\} · \$\{who\} · confidentiel`/);
});

test('no client data in the repository: deliveries live in an ignored folder, except the fictitious example',()=>{
 const ignore=read('.gitignore');assert.match(ignore,/^commercial\/livraisons\/\*$/m);assert.match(ignore,/^!commercial\/livraisons\/exemple\.json$/m);
 assert.match(EX.lead,/fictif/);
});

test('register check before any delivery: opposition to prospecting, sole trader, closed or unknown company → refused',async()=>{
 const {verifierEntreprises}=await import('../commercial/livraison.ts');
 const reg:Record<string,Record<string,unknown>>={
  '900000001':{siren:'900000001',etat_administratif:'A',nature_juridique:'5710',opposition_diffusion_commerciale:false},
  '900000002':{siren:'900000002',etat_administratif:'A',nature_juridique:'5710',opposition_diffusion_commerciale:true},
  '900000003':{siren:'900000003',etat_administratif:'C',nature_juridique:'1000',complements:{est_entrepreneur_individuel:true}}};
 const fetchJson=async(url:string)=>{const q=new URL(url).searchParams.get('q')!;return {results:reg[q]?[reg[q]]:[]}};
 assert.deepEqual(await verifierEntreprises(EX,fetchJson),['fiche 2 (ATELIER FICTIF) : opposée à la prospection commerciale (registre Sirene) — à retirer',
  'fiche 3 (SYNDIC EXEMPLE) : entrepreneur individuel — à retirer','fiche 3 (SYNDIC EXEMPLE) : entreprise fermée — à retirer']);
 const down=await verifierEntreprises(EX,async()=>{throw Error('x')});
 assert.equal(down.length,3);assert.match(down[0]!,/registre injoignable/);
 assert.match(read('commercial/livraison-cli.ts'),/const reg=await verifierEntreprises\(l,/,'the CLI runs it before generating');
});
