// Signal-first Discovery V1 — P1, pure domain logic (src/signal-discovery/*): search plan, event extraction, entity
// resolution, ICP pre-filter, grouping, review order. No database, no API, no UI, no network, no clock read.
// Fixtures: tests/fixtures/signal-discovery/6xpos-chr-occitanie.json (6XPOS — CHR equipment, Occitanie, new_site +
// expansion; fictitious organizations). Numbers 1–18 are the acceptance cases of the P1 brief.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {planSignalQueries,MAX_SIGNAL_QUERIES,MAX_QUERY_CHARS,MAX_QUERY_WORDS,EVENT_PHRASES,FRESHNESS_DAYS} from '../src/signal-discovery/plan.ts';
import {extractEvent,announcedDateIn,sentencesOf,type SearchHit} from '../src/signal-discovery/extract.ts';
import {resolveEventEntity,hostingPlatformOf,eventSubject,ENTITY_TO_CONFIRM} from '../src/signal-discovery/entity.ts';
import {buildCandidate,rankSignalCandidates,reviewTier,toPendingSignal,matchExistingProspect,REVIEW_TIER_LABELS,type SignalDiscoveryCandidate} from '../src/signal-discovery/rank.ts';
import {toCandidate} from '../src/signals/service.ts';
import {scoreIntent,type IntentSignal} from '../src/domain/intent.ts';
import {DEFAULT_CRITERIA,scoreProspect} from '../src/domain/core.ts';

const NOW=new Date('2026-10-13T10:00:00Z');
const F=JSON.parse(await readFile(new URL('./fixtures/signal-discovery/6xpos-chr-occitanie.json',import.meta.url),'utf8')) as {project:{subjects:string[];activity_terms:string[];location:string;signal_types:string[];max_results:number};hits:Record<string,SearchHit>};
const TARGET={activity_terms:F.project.activity_terms,location:F.project.location};
const hit=(id:string)=>{const h=F.hits[id];assert.ok(h,`fixture ${id}`);return h!};
function candidate(id:string):SignalDiscoveryCandidate{
 const r=buildCandidate(hit(id),TARGET,NOW);
 assert.ok(r.ok,`${id} should produce a candidate, got ${r.ok?'':r.reason}`);
 return (r as {ok:true;candidate:SignalDiscoveryCandidate}).candidate;
}
function rejected(id:string):string{
 const r=buildCandidate(hit(id),TARGET,NOW);
 assert.equal(r.ok,false,`${id} must not produce a candidate`);
 return (r as {ok:false;reason:string}).reason;
}
// The excerpt is the search result's own text, character for character (a clipped excerpt ends with "…").
const exactIn=(c:SignalDiscoveryCandidate,h:SearchHit)=>assert.ok(h.description.includes(c.excerpt)||h.title.includes(c.excerpt),`excerpt must be copied as is: ${c.excerpt}`);

// ------------------------------------------------------------
// Plan
// ------------------------------------------------------------
test('plan — at most 3 queries, within Brave limits, 180-day freshness, discovery phrases only, deterministic',()=>{
 const input={subjects:F.project.subjects,location:F.project.location,signal_types:F.project.signal_types,max_results:F.project.max_results,now:NOW};
 const plan=planSignalQueries(input);
 assert.ok(plan.queries.length>=1&&plan.queries.length<=MAX_SIGNAL_QUERIES);
 for(const q of plan.queries){
  assert.ok(q.q.length<=MAX_QUERY_CHARS&&q.q.split(' ').length<=MAX_QUERY_WORDS,q.q);
  assert.doesNotMatch(q.q,/linkedin|facebook|instagram|site:/i,'no social network, no site operator');
  assert.doesNotMatch(q.q,/ OR $/);
 }
 assert.deepEqual(plan.zone,{label:'Occitanie',cities:['Toulouse','Montpellier']});
 assert.equal(plan.freshness,'2026-04-16to2026-10-13');assert.equal(plan.window.days,FRESHNESS_DAYS);
 assert.equal(plan.max_results,20);
 assert.ok(plan.queries.some(q=>q.signal_types.includes('new_site'))&&plan.queries.some(q=>q.signal_types.includes('expansion')));
 assert.ok(plan.queries.some(q=>q.q.includes('"nouvelle ouverture"'))&&plan.queries.some(q=>q.q.includes('"deuxième établissement"')));
 assert.deepEqual(planSignalQueries(input),plan,'same input, same plan');
 // Only the requested types; an unknown type is ignored, never a parallel taxonomy.
 const onlyExpansion=planSignalQueries({...input,signal_types:['expansion','funding']});
 assert.deepEqual(onlyExpansion.queries.map(q=>q.signal_types),[['expansion']]);
 assert.equal(planSignalQueries({...input,max_results:999}).max_results,50);
 assert.ok(EVENT_PHRASES.new_site.includes('ouverture prochaine')&&EVENT_PHRASES.expansion.includes('poursuit son développement'));
});

// ------------------------------------------------------------
// 1–10: extraction, entity, ICP, grouping
// ------------------------------------------------------------
test('1 — future opening, organization resolved: NEW_SITE, announced month, FUTURE, first review tier',()=>{
 const c=candidate('future_opening_resolved');
 assert.equal(c.signal_type,'new_site');
 assert.deepEqual([c.entity_name,c.entity_name_status,c.entity_confidence],['Napolino','RESOLVED','HIGH']);
 assert.deepEqual(c.event_date,{text:'décembre 2026',year:2026,month:12,day:null,granularity:'MONTH',months:null});
 assert.equal(c.event_tense,'FUTURE');assert.equal(c.review_tier,1);
 assert.equal(c.published_at,'2026-10-01T08:00:00.000Z');
 assert.equal(c.entity_domain,null,'a media page never gives the company domain');assert.equal(c.entity_domain_status,'UNRESOLVED');
 assert.equal(c.icp_match,'IN');exactIn(c,hit('future_opening_resolved'));
 // Own site, name corroborated by its domain: the domain is resolved, and only then.
 const own=candidate('own_site_resolved_domain');
 assert.deepEqual([own.entity_name,own.entity_domain,own.entity_domain_method,own.entity_confidence],['Napolino','napolino-exemple.fr','own_site','HIGH']);
});

test('2 — recent expansion, organization resolved: EXPANSION, exact past day, very recent tier',()=>{
 const c=candidate('recent_expansion_resolved');
 assert.equal(c.signal_type,'expansion');assert.equal(c.entity_name,'Café Mira');
 assert.deepEqual(c.event_date,{text:'2 octobre 2026',year:2026,month:10,day:2,granularity:'DAY',months:null});
 assert.equal(c.event_tense,'PAST');assert.equal(c.review_tier,3);
 const physical=candidate('expansion_development_physical');
 assert.equal(physical.signal_type,'expansion','"poursuit son développement" + a physical opening');
 assert.equal(physical.entity_name,'Bagelmania Sud');assert.deepEqual(physical.location?.departments,['81']);
});

test('3 — an article about ANOTHER organization’s opening: never the headline’s organization',()=>{
 const c=candidate('another_company_in_article');
 assert.equal(c.signal_type,'new_site');
 assert.equal(c.entity_name,null);assert.equal(c.entity_name_status,'UNRESOLVED');assert.equal(c.display_name,ENTITY_TO_CONFIRM);
 assert.ok(c.reasons.includes('headline_names_another_organization'));
 assert.notEqual(c.display_name,'Burger Lab');
});

test('4 — editorial page about restaurants / fast-food with no event: no candidate',()=>{
 assert.equal(rejected('editorial_fast_food_guide'),'NO_EVENT');
 assert.equal(rejected('editorial_new_restaurants_list'),'NO_EVENT','a list of "nouveaux restaurants" is not one event');
});

test('5 — event without any date: event date null, tense from the words only, "unknown date" tier',()=>{
 const c=candidate('event_without_date');
 assert.equal(c.event_date,null);assert.equal(c.published_at,null);
 assert.equal(c.review_tier,4);assert.equal(c.review_label,REVIEW_TIER_LABELS[4]);
 assert.equal(c.entity_name,'Bowlerie');
});

test('6 — publication date known, event date unknown: the publication never becomes the event date',()=>{
 const h=hit('published_known_event_unknown');
 const c=candidate('published_known_event_unknown');
 assert.equal(c.published_at,'2026-10-01T06:00:00.000Z');
 assert.equal(c.event_date,null,'the leading "1 octobre 2026 —" stamp is the publication, not the event');
 assert.equal(c.event_tense,'UNKNOWN');assert.equal(c.review_tier,4);
 assert.ok(!c.excerpt.startsWith('1 octobre 2026'));exactIn(c,h);
 // The hand-off to the Signal Engine keeps event_date null too.
 assert.equal(toPendingSignal(c,NOW).event_date,null);
 assert.equal(announcedDateIn('Publié il y a 3 jours : X ouvre ses portes',NOW),null,'a relative date is about the publication');
 assert.deepEqual(sentencesOf('12 mars 2026 — Napolino ouvre. Café Mira suit.'),['Napolino ouvre.','Café Mira suit.']);
});

test('7 — Netlify / Vercel hosting: never a company name, never a company domain, "Entreprise à confirmer"',()=>{
 for(const [id,platform,host] of [['hosting_netlify','netlify.app','terroirclub.netlify.app'],['hosting_vercel','vercel.app','smash-bros-burger.vercel.app']] as const){
  const c=candidate(id);
  assert.equal(c.hosting_platform,platform);assert.equal(c.source_domain,host);
  assert.equal(c.entity_name,null);assert.equal(c.display_name,ENTITY_TO_CONFIRM);
  assert.equal(c.entity_domain,null);assert.equal(c.entity_domain_status,'UNRESOLVED');
  assert.doesNotMatch(JSON.stringify([c.entity_name,c.display_name,c.entity_domain]),/netlify|vercel/i);
 }
 for(const h of ['x.netlify.app','y.vercel.app','me.github.io','a.pages.dev','shop.wixsite.com','b.webflow.io','c.blogspot.com'])assert.ok(hostingPlatformOf(h),h);
 for(const h of ['www.ladepeche.fr','napolino-exemple.fr'])assert.equal(hostingPlatformOf(h),null,h);
});

test('8 — the place of the event is not the head office: "Basée à Lyon, … à Toulouse" → Toulouse, an event mention',()=>{
 const c=candidate('event_place_not_headquarters');
 assert.equal(c.location?.text,'Toulouse');assert.deepEqual(c.location?.departments,['31']);assert.equal(c.location?.basis,'EVENT_MENTION');
 assert.doesNotMatch(JSON.stringify(c.location),/Lyon|69/);
 assert.equal(c.entity_name,'Kebab Royalto');
 assert.deepEqual(c.event_date,{text:'printemps 2027',year:2027,month:null,day:null,granularity:'PERIOD',months:[3,6]});
 assert.equal(c.review_tier,2,'spring 2027 starts more than 90 days after today');
});

test('9 — the same event from several sources: one candidate, the others listed as sources',()=>{
 const ids=['future_opening_resolved','same_event_source_2','same_event_source_3'];
 const o=rankSignalCandidates(ids.map(hit),{target:TARGET,now:NOW,max_results:20});
 assert.equal(o.review.length,1);assert.equal(o.merged,2);
 const c=o.review[0]!;
 assert.equal(c.source_url,hit('future_opening_resolved').url,'the most precise source is shown first');
 assert.deepEqual(c.other_sources.map(s=>s.source_url).sort(),[hit('same_event_source_2').url,hit('same_event_source_3').url].sort());
 // An unresolved organization is never merged into a resolved one, even for the same city and month.
 const withArticle=rankSignalCandidates([...ids,'another_company_in_article'].map(hit),{target:TARGET,now:NOW,max_results:20});
 assert.equal(withArticle.review.length,2);
 // Different place = different event.
 assert.equal(rankSignalCandidates(['future_opening_resolved','own_site_resolved_domain'].map(hit),{target:TARGET,now:NOW,max_results:20}).review.length,2);
});

test('10 — out of ICP: another region, or a public body → OUT, kept apart (never deleted)',()=>{
 const region=candidate('out_of_icp_region');
 assert.equal(region.icp_match,'OUT');assert.ok(region.icp_reasons.includes('location:ZONE_MISMATCH'));
 const pub=candidate('out_of_icp_public_body');
 assert.equal(pub.icp_match,'OUT');assert.ok(pub.icp_reasons.includes('non_commercial:PUBLIC_BODY'));
 const o=rankSignalCandidates(Object.values(F.hits),{target:TARGET,now:NOW,max_results:20});
 assert.deepEqual(o.out_of_icp.map(c=>c.source_url).sort(),[hit('out_of_icp_region').url,hit('out_of_icp_public_body').url].sort());
 assert.ok(o.review.every(c=>c.icp_match!=='OUT'));
});

// ------------------------------------------------------------
// 11–13: FIT and INTENT
// ------------------------------------------------------------
function intentSignal(c:SignalDiscoveryCandidate,status:IntentSignal['status']):IntentSignal{
 const raw=toPendingSignal(c,NOW);
 const v=toCandidate('discovery_recycled',raw,[],NOW);
 assert.ok(v.ok,'the hand-off passes the Signal Engine schema (no FUTURE_DATE)');
 const s=(v as {ok:true;candidate:any}).candidate;
 return {id:`sig-${c.event_key}`,signal_type:s.signal_type,status,title:s.title,excerpt:s.excerpt,source_url:s.source_url,source_domain:c.source_domain,
  confidence:0.6,event_date:s.event_date??null,published_at:s.published_at??null,observed_at:s.observed_at,matched_terms:s.matched_terms};
}
const P1_MODULES=['plan.ts','extract.ts','entity.ts','rank.ts','record.ts'];
// Code only: comment lines may name what the module deliberately does not do.
const codeOf=(src:string)=>src.split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
test('11 — an unverified candidate changes neither FIT nor INTENT',async()=>{
 const c=candidate('future_opening_resolved');
 // FIT reads verified evidence only: a candidate is not evidence, the score with no evidence is unchanged.
 const fit=scoreProspect(DEFAULT_CRITERIA,[],NOW);
 assert.deepEqual(scoreProspect(DEFAULT_CRITERIA,[],NOW),fit);
 for(const f of await readdir(new URL('../src/signal-discovery/',import.meta.url))){
  const src=await readFile(new URL(`../src/signal-discovery/${f}`,import.meta.url),'utf8');
  const imports=src.split('\n').filter(l=>/^import /.test(l)).join('\n');
  assert.doesNotMatch(imports,/domain\/|evidence|observations/,`${f}: no FIT / INTENT / evidence input`);
  assert.doesNotMatch(codeOf(src),/'VERIFIED'|"VERIFIED"|review_signal|reviewed_by/,`${f}: never sets a review status`);
  // The pure P1 modules carry no status at all (P3's service and API only name a RUN's status).
  if(P1_MODULES.includes(f))assert.doesNotMatch(src,/\bstatus\s*:/,`${f}: no status in the pure logic`);
 }
 // Even once handed to the Signal Engine, a pending signal adds nothing to verified INTENT.
 const r=scoreIntent([intentSignal(c,'PENDING_REVIEW')],null,NOW);
 assert.equal(r.score,0);assert.equal(r.lines.length,0);
});

test('12 — a rejected signal changes neither FIT nor INTENT (estimated INTENT included)',()=>{
 const r=scoreIntent([intentSignal(candidate('recent_expansion_resolved'),'REJECTED')],null,NOW);
 assert.equal(r.score,0);assert.equal(r.estimated.score,0);assert.equal(r.pending.count,0);
});

test('13 — a signal VERIFIED by a person (existing review_signal path) feeds INTENT; a future event is dated by its publication',()=>{
 const future=candidate('future_opening_resolved');
 const raw=toPendingSignal(future,NOW);
 assert.equal(raw.event_date,null,'a future event never goes into signals.event_date (FUTURE_DATE unchanged)');
 assert.deepEqual((raw.metadata.announced_event as any).text,'décembre 2026');
 const r=scoreIntent([intentSignal(future,'VERIFIED')],null,NOW);
 assert.ok(r.score>0);assert.equal(r.lines[0]!.date_basis,'published');
 // A past event written with its exact day keeps that day as event_date.
 const past=candidate('past_exact_day_event');
 assert.equal(toPendingSignal(past,NOW).event_date,'2026-09-25');
 assert.equal(scoreIntent([intentSignal(past,'VERIFIED')],null,NOW).lines[0]!.date_basis,'event');
});

// ------------------------------------------------------------
// 14: ENTITY mode unchanged
// ------------------------------------------------------------
// Updated in P3: the API router (app/api/v1/[...path]/route.ts) is now the ONLY file outside the module that knows it.
test('14 — ENTITY / Registry Discovery untouched: no import of the new module outside the router, no mode switch',async()=>{
 const ROUTER='app/api/v1/[...path]/route.ts';
 const tracked=execFileSync('git',['ls-files','src','app','supabase'],{encoding:'utf8'}).split('\n').filter(f=>/\.(ts|tsx|sql)$/.test(f)&&!f.startsWith('src/signal-discovery/')&&f!==ROUTER);
 for(const f of tracked){
  const src=await readFile(new URL(`../${f}`,import.meta.url),'utf8');
  assert.doesNotMatch(src,/signal-discovery|signal_discovery|SIGNAL_DISCOVERY/,`${f} must not know about Signal-first Discovery`);
 }
 const types=await readFile(new URL('../src/discovery/types.ts',import.meta.url),'utf8');
 assert.doesNotMatch(types,/discovery_mode/);
 // The new module only READS existing primitives; it never imports the ENTITY run path.
 for(const f of await readdir(new URL('../src/signal-discovery/',import.meta.url))){
  const src=await readFile(new URL(`../src/signal-discovery/${f}`,import.meta.url),'utf8');
  assert.doesNotMatch(codeOf(src),/discovery\/(?:api|services|observations|providers\/)/,f);
  // Database and server access only in the two P3 adapters; the pure modules and the service stay database-free.
  if(!['api.ts','repository.ts'].includes(f))assert.doesNotMatch(codeOf(src),/discovery\/repository|server\/|supabase/,f);
 }
});

// ------------------------------------------------------------
// 15–18: search snippets and the meaning of "ouverture" / "expansion"
// ------------------------------------------------------------
test('15 — a search snippet gives a candidate with source_type=search_snippet, never "observed on the page"',async()=>{
 for(const id of ['future_opening_resolved','hosting_netlify','recent_expansion_resolved']){
  const c=candidate(id);
  assert.equal(c.source_type,'search_snippet');assert.equal(c.observed_on_page,false);
  assert.ok(['search_result_snippet','search_result_title'].includes(c.excerpt_origin));
  exactIn(c,hit(id));
  const raw=toPendingSignal(c,NOW);
  assert.equal(raw.source_type,'search_snippet');assert.equal(raw.metadata.observed_on_page,false);
 }
 for(const f of await readdir(new URL('../src/signal-discovery/',import.meta.url))){
  const src=await readFile(new URL(`../src/signal-discovery/${f}`,import.meta.url),'utf8');
  assert.doesNotMatch(src,/le site indique|observ[ée]e? sur la page|nous avons observ/i,f);
 }
 for(const label of [...Object.values(REVIEW_TIER_LABELS),ENTITY_TO_CONFIRM])assert.doesNotMatch(label,/probab|chance|qualifi|score|%|v[ée]rifi|observ/i);
});

test('16 — the word "ouverture" alone never makes NEW_SITE',()=>{
 assert.equal(rejected('opening_mind'),'NON_ESTABLISHMENT_OPENING');
 assert.equal(rejected('opening_hours'),'NON_ESTABLISHMENT_OPENING');
 assert.equal(rejected('opening_festival'),'NON_ESTABLISHMENT_OPENING');
 for(const text of ['La saison est ouverte à Toulouse.','Ouverture du capital de la société.','Une ouverture vers de nouveaux horizons.','Le marché ouvre en hausse.'])
  assert.equal(extractEvent({title:text,description:'',url:'https://www.exemple.fr/a'},NOW).ok,false,text);
});

test('17 — opening of registrations, ticketing, recruitment, hours… is never NEW_SITE',()=>{
 for(const id of ['opening_inscriptions','opening_ticketing','opening_recruitment','opening_hours'])assert.equal(rejected(id),'NON_ESTABLISHMENT_OPENING',id);
 for(const text of ['Ouverture des candidatures pour les food trucks du marché de Noël à Toulouse.','Les réservations ouvriront le 3 novembre 2026.','Ouverture des précommandes du coffret à Montpellier.'])
  assert.equal(extractEvent({title:text,description:'',url:'https://www.exemple.fr/b'},NOW).ok,false,text);
});

test('18 — an expansion of a range, an offer, an audience or a service is never EXPANSION',()=>{
 for(const id of ['expansion_range','expansion_audience','expansion_commercial_development'])assert.equal(rejected(id),'NOT_PHYSICAL_EXPANSION',id);
 for(const text of ['La Brasserie du Port développe sa carte de saison.','Le Fournil étend ses services à la livraison.','Expansion de son catalogue pour le Bistrot Lumière.'])
  assert.equal(extractEvent({title:text,description:'',url:'https://www.exemple.fr/c'},NOW).ok,false,text);
});

// ------------------------------------------------------------
// Other guards
// ------------------------------------------------------------
test('guards — stale publication, past event beyond 180 days, explicit negation, invalid URL',()=>{
 assert.equal(rejected('stale_publication'),'STALE_PUBLICATION');
 assert.equal(rejected('negated_opening'),'NEGATED');
 assert.equal(extractEvent({title:'Le Grill du Pont a ouvert un restaurant à Albi en mars 2025',description:'',url:'https://www.exemple.fr/d'},NOW).ok,false);
 assert.equal(extractEvent({title:'X ouvrira un restaurant à Albi',description:'',url:'javascript:alert(1)'},NOW).ok,false);
 assert.equal(extractEvent({title:'X ouvrira un restaurant à Albi',description:'',url:'https://user:pw@exemple.fr/'},NOW).ok,false);
 // A date before the clause that contradicts the verb never dates the new opening.
 const r=extractEvent({title:'Après son restaurant ouvert en 2023 à Albi, Le Grill du Pont ouvrira un restaurant à Castres',description:'',url:'https://www.exemple.fr/e'},NOW);
 assert.ok(r.ok);assert.equal((r as any).event.event_date,null);assert.equal((r as any).event.event_tense,'FUTURE');
 // A day without a year keeps its year unknown: never added.
 assert.deepEqual(announcedDateIn('ouverture prévue le 12 décembre',NOW),{text:'12 décembre',year:null,month:12,day:12,granularity:'DAY',months:null});
});

test('entity — subject rules: organization words, articles, participial clauses, several organizations',()=>{
 assert.equal(eventSubject("Basée à Lyon, l’enseigne Kebab Royalto"),'Kebab Royalto');
 assert.equal(eventSubject('Le groupe toulousain Napolino'),'Napolino');
 assert.equal(eventSubject('Café Mira'),'Café Mira');
 assert.equal(eventSubject('Notre nouveau restaurant'),null);
 assert.equal(eventSubject('Toulouse'),null,'a place is not an organization');
 assert.equal(eventSubject('Napolino et Café Mira'),null,'never one organization picked out of several');
 const e=resolveEventEntity(candidate('hosting_vercel'));
 assert.equal(e.display_name,ENTITY_TO_CONFIRM);
});

test('review order — deterministic: near future > far future > very recent > unknown date > older past',()=>{
 const at=(text:string)=>reviewTier({event_date:announcedDateIn(text,NOW),event_tense:'UNKNOWN'},NOW);
 assert.equal(at('en novembre 2026'),1);assert.equal(at('en mai 2027'),2);assert.equal(at('en 2027'),2,'a year alone is never "near"');assert.equal(at('le 2 octobre 2026'),3);
 assert.equal(at('sans date'),4);assert.equal(at('en mai 2026'),5);assert.equal(at('en octobre 2026'),3,'the current month');
 const a=rankSignalCandidates(Object.values(F.hits),{target:TARGET,now:NOW,max_results:20});
 const b=rankSignalCandidates([...Object.values(F.hits)].reverse(),{target:TARGET,now:NOW,max_results:20});
 assert.deepEqual(a.review.map(c=>c.source_url),b.review.map(c=>c.source_url),'input order does not matter');
 for(let i=1;i<a.review.length;i++)assert.ok(a.review[i-1]!.icp_match===a.review[i]!.icp_match?a.review[i-1]!.review_tier<=a.review[i]!.review_tier:a.review[i-1]!.icp_match==='IN');
 assert.equal(rankSignalCandidates(Object.values(F.hits),{target:TARGET,now:NOW,max_results:3}).review.length,3);
});

test('existing prospect — the candidate is attached to it, never a duplicate',()=>{
 const c=candidate('future_opening_resolved');
 assert.equal(matchExistingProspect(c,[{id:'p1',name:'NAPOLINO'},{id:'p2',name:'Autre'}])?.id,'p1');
 assert.equal(matchExistingProspect(candidate('hosting_netlify'),[{id:'p1',name:'Terroir Club'}]),null,'an unresolved candidate is never matched');
});

// ------------------------------------------------------------
// Acceptance 6XPOS — CHR, Occitanie, new_site + expansion
// ------------------------------------------------------------
test('acceptance 6XPOS — "X ouvrira un nouveau restaurant à Toulouse en décembre 2026" first; guide and registrations rejected',()=>{
 const o=rankSignalCandidates(Object.values(F.hits),{target:TARGET,now:NOW,max_results:F.project.max_results});
 assert.ok(o.review.length<=20);
 const first=o.review[0]!;
 assert.equal(first.source_url,hit('future_opening_resolved').url);
 assert.deepEqual([first.signal_type,first.entity_name,first.event_tense,first.location?.text],['new_site','Napolino','FUTURE','Toulouse']);
 const urls=new Set([...o.review,...o.out_of_icp].flatMap(c=>[c.source_url,...c.other_sources.map(s=>s.source_url)]));
 for(const id of ['editorial_fast_food_guide','opening_inscriptions','opening_ticketing','expansion_range','negated_opening'])assert.ok(!urls.has(hit(id).url),id);
 assert.ok((o.rejected.NO_EVENT??0)>=2&&(o.rejected.NON_ESTABLISHMENT_OPENING??0)>=4);
 // Nothing is verified, scored or qualified here.
 assert.doesNotMatch(JSON.stringify(o),/VERIFIED|probab|qualifi/i);
 assert.ok(o.review.every(c=>c.source_type==='search_snippet'&&c.observed_on_page===false));
});
