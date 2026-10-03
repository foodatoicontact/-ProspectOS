// Hotfix #10 — ENTITY TYPE × SEARCH INTENT. The production canary of #9 showed real, resolved organizations with real
// domains still proposed as "Entreprise candidate" for an explicitly commercial brief ("Entreprise BTP recrute…"): a
// regional federation, a trade federation, an association, a trade media. A non-commercial organization is set aside
// with an explicit reason when the brief asks for companies and not for that kind of actor — and kept when the brief
// asks for it. Fit, size, competition and confirmed activity stay human qualification. Pure tests (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';
import {entityTypeMismatch,nonCommercialKind} from '../src/discovery/admissibility.ts';
import {rejectionReason} from '../src/discovery/rejection-reason.ts';
import {reviewPriority} from '../src/discovery/review-priority.ts';
import {metrics,run,CARLA,THOMAS,THOMAS_CANARY} from './beta-discovery-benchmark.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';
import type {Candidate} from '../src/discovery/types.ts';

const provider=new BraveProvider('k');
const BTP='Entreprise BTP recrute ou se développe nouveaux chantiers croissance 2026',ARA='Auvergne-Rhône-Alpes',CATS=['BTP','construction','travaux publics'];
const norm=(h:{title:string;url:string;description:string},query=BTP,categories=CATS):Candidate=>provider.normalizeResult({...h,__quality:assessCandidateQuality(h,ARA),__context:{query,categories,location:ARA}});
const meta=(c:Candidate)=>c.raw_metadata as Record<string,any>;
const row=(id:string)=>THOMAS_CANARY.rows.find(r=>r.id===id)!;
const isCandidate=(c:Candidate)=>meta(c).source_class==='COMPANY_CANDIDATE';
const reasonOf=(c:Candidate)=>rejectionReason(meta(c).admissibility.reason_code,meta(c).page_type,meta(c).entity_type);

test('1 — FNTP (regional FRTP site) for a commercial BTP brief: not a commercial candidate, explicit federation reason',()=>{
 const c=norm(row('fntp'));
 assert.equal(isCandidate(c),false);assert.equal(meta(c).entity_type,'FEDERATION');assert.equal(meta(c).admissibility.reason_code,'ENTITY_TYPE_MISMATCH');
 assert.equal(reasonOf(c),'TYPE_MISMATCH_FEDERATION');assert.match(fr['discovery.reason.TYPE_MISMATCH_FEDERATION'],/hors type d’acteur demandé/);
});
test('2 — FFB AURA for the same brief: not a commercial candidate (the entity is resolved, the reason is NOT "entité non résolue")',()=>{
 const c=norm(row('ffb'));
 assert.equal(isCandidate(c),false);assert.equal(meta(c).entity_type,'FEDERATION');assert.notEqual(reasonOf(c),'ENTITY_UNRESOLVED');
 assert.equal(c.name,'Fédération Française du Bâtiment Région Auvergne-Rhône-Alpes','the organization stays identified');
});
test('3 — federations explicitly asked for: FFB and FNTP stay candidates',()=>{
 for(const id of ['fntp','ffb']){const c=norm(row(id),'Fédérations professionnelles BTP Auvergne-Rhône-Alpes',['BTP']);assert.ok(isCandidate(c),id);assert.equal(meta(c).entity_type,'FEDERATION')}
});
test('4 — association: set aside for "Entreprises BTP…", kept for "Associations professionnelles BTP…"',()=>{
 const asCompanies=norm(row('cra'),'Entreprises BTP Auvergne-Rhône-Alpes',['BTP']);
 assert.equal(isCandidate(asCompanies),false);assert.equal(meta(asCompanies).entity_type,'ASSOCIATION');assert.equal(reasonOf(asCompanies),'TYPE_MISMATCH_ASSOCIATION');
 assert.ok(isCandidate(norm(row('cra'),'Associations professionnelles BTP Auvergne-Rhône-Alpes',['BTP'])));
});
test('5 — public body: set aside for "Entreprises construction…", kept when public bodies are asked for',()=>{
 const page={title:'Ville de Grenoble - Direction des travaux et de la construction',url:'https://www.grenoble.example/',description:'La Ville de Grenoble, ses chantiers de construction et ses marchés publics en Auvergne-Rhône-Alpes.'};
 const asCompanies=norm(page,'Entreprises construction Auvergne-Rhône-Alpes',['construction']);
 assert.equal(meta(asCompanies).entity_type,'PUBLIC_BODY');assert.equal(isCandidate(asCompanies),false);assert.equal(reasonOf(asCompanies),'TYPE_MISMATCH_PUBLIC_BODY');
 assert.equal(entityTypeMismatch('PUBLIC_BODY',{query:'organismes publics accompagnement construction',categories:[]}),false);
});
test('6 — Cercara-like ambiguous company (activity not confirmed by the source): stays a reviewable candidate',()=>{
 const c=norm(row('cercara'));
 assert.ok(isCandidate(c));assert.equal(meta(c).entity_type,'COMPANY');assert.ok(['HIGH','MEDIUM','LOW'].includes(reviewPriority(meta(c),c.website).level),'reviewed like any candidate');
});
test('7 — adjacent company (agency, E-Declic fixture): still a candidate, no agency/competitor filter',()=>{
 const x=run(CARLA).find(o=>o.row.id==='e-declic')!;
 assert.ok(x.meta.source_class==='COMPANY_CANDIDATE');assert.equal(x.meta.entity_type,'COMPANY');
});
test('8 — article (NHU fixtures) still rejected as content: the page-type guard of #9 is intact',()=>{
 for(const id of ['nhu-blog','nhu-article']){const x=run(CARLA).find(o=>o.row.id===id)!;assert.notEqual(x.meta.source_class,'COMPANY_CANDIDATE',id);assert.equal(x.meta.entity_type,'CONTENT',id)}
 assert.equal(isCandidate(norm(row('article'))),false);
});
test('9 — event: rejected for "entreprises BTP", kept when trade shows/events are asked for',()=>{
 const page={title:'Salon Batimat Auvergne-Rhône-Alpes 2026 - 400 exposants BTP',url:'https://www.salon-btp-aura.example/',description:'Le salon du BTP en Auvergne-Rhône-Alpes : 400 exposants, inscriptions ouvertes.'};
 assert.equal(meta(norm(page,'entreprises BTP Auvergne-Rhône-Alpes',['BTP'])).admissibility.reason_code,'EVENT_PAGE');
 assert.ok(isCandidate(norm(page,'salons et événements BTP Auvergne-Rhône-Alpes',['BTP'])));
});
test('Le Moniteur-like trade media: typed MEDIA from its own title (no domain list), set aside for a company brief, kept for a media brief',()=>{
 const c=norm(row('moniteur'));
 assert.equal(meta(c).entity_type,'MEDIA');assert.equal(isCandidate(c),false);assert.equal(reasonOf(c),'TYPE_MISMATCH_MEDIA');
 assert.ok(isCandidate(norm(row('moniteur'),'médias spécialisés construction BTP',['BTP'])));
 assert.equal(nonCommercialKind('Ribiere','Entreprise générale de bâtiment - RIBIERE','https://www.ribiere.eu/'),null,'a company title is not a media title');
});
test('no commercial word and no actor type in the brief: nothing is set aside by the guard (ambiguity stays reviewable)',()=>{
 assert.equal(entityTypeMismatch('FEDERATION',{query:'BTP Auvergne-Rhône-Alpes',categories:[]}),false);
 const cra=norm(row('cra'),'BTP travaux publics Auvergne-Rhône-Alpes croissance 2026',['BTP']);
 assert.notEqual(meta(cra).admissibility.reason_code,'ENTITY_TYPE_MISMATCH');assert.ok(isCandidate(cra),'an association stays reviewable when the brief names no actor type');
 // (A federation there is still handled by the earlier sector-body rule of admissibility.ts — unchanged.)
 assert.equal(meta(norm(row('fntp'),'BTP travaux publics Auvergne-Rhône-Alpes croissance 2026',['BTP'])).admissibility.reason_code,'SECTOR_BODY_PAGE');
});
test('UI reasons: every mismatch reason exists in FR and EN; an unknown type falls back to the generic mismatch, never "non résolue"',()=>{
 for(const k of ['ENTITY_TYPE_MISMATCH','TYPE_MISMATCH_FEDERATION','TYPE_MISMATCH_ASSOCIATION','TYPE_MISMATCH_PUBLIC_BODY','TYPE_MISMATCH_MEDIA'])assert.ok(fr[`discovery.reason.${k}` as keyof typeof fr]&&en[`discovery.reason.${k}` as keyof typeof en],k);
 assert.equal(rejectionReason('ENTITY_TYPE_MISMATCH','OFFICIAL_ORGANIZATION_SITE','COMPANY'),'ENTITY_TYPE_MISMATCH');
});
test('benchmark — canary shapes: 4 non-commercial candidates → 0, real companies kept; #9 results unchanged',()=>{
 const canary=metrics(THOMAS_CANARY),thomas=metrics(THOMAS),carla=metrics(CARLA);
 console.log(`ENTITY_GUARD_BENCHMARK ${JSON.stringify({THOMAS_CANARY:canary,THOMAS:thomas,CARLA:carla})}`);
 assert.equal(canary.ENTITY_TYPE_MISMATCH_AS_CANDIDATE,0);assert.deepEqual(canary.candidates.map(n=>n.replace(/\[.*$/,'')).sort(),['Cercara','Dupuis Construction']);
 assert.deepEqual([thomas.CANDIDATES,thomas.FALSE_POSITIVE_LIKE_RESULTS],[4,0]);assert.deepEqual([carla.CANDIDATES,carla.FALSE_POSITIVE_LIKE_RESULTS],[3,0]);
});
test('no domain blacklist and no canary name in the engine (executable code)',async()=>{
 for(const dir of ['../src/discovery/','../src/discovery/strategies/']){
  for(const f of (await readdir(new URL(dir,import.meta.url))).filter(f=>f.endsWith('.ts'))){
   const src=(await readFile(new URL(dir+f,import.meta.url),'utf8')).split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n');
   assert.doesNotMatch(src,/lemoniteur|cra\.asso|cercara|ffbatiment|frtpaura/i,`${dir}${f}`);
  }
 }
});
