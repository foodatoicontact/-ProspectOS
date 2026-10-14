// Signal-first Discovery V1, step 3: WHO the event is about — name and domain resolved separately, each only from
// what the search result itself writes. Deterministic, no model, no network.
//
// Rules:
// 1. The organization is the SUBJECT of the event sentence ("L'enseigne Napoli ouvrira…" → Napoli). When the headline
//    explicitly names an organization (resolveCanonicalCompany: "X : …", "X ouvre…", "chez X") and the event
//    sentence names ANOTHER one, nothing is chosen: UNRESOLVED ("Entreprise à confirmer").
// 2. A hosting platform (netlify.app, vercel.app, github.io, wixsite.com…) is never a company: no name is ever
//    derived from it ("Netlify"), and its sub-domain is never turned into a name either.
// 3. A media, directory, marketplace or aggregator domain is never the company's domain. A domain is RESOLVED only
//    when the page is the organization's own site and its name is corroborated by that domain, or when the result
//    cites one domain whose label matches the resolved name. A domain is never derived from a name.
// 4. In doubt: UNRESOLVED. A person confirms the name when adding the candidate to a project (P2).
import {parse as parseDomain} from 'tldts';
import {assessCandidateQuality} from '../discovery/candidate-quality.ts';
import {resolveCanonicalCompany} from '../discovery/entity-resolution.ts';
import {entityCore} from '../discovery/admissibility.ts';
import {isPlaceName} from '../discovery/geo-fr.ts';
import {isCommuneName} from './places.ts';
import type {SourceType} from '../discovery/source-classification.ts';
import type {ExtractedEvent} from './extract.ts';

export const ENTITY_TO_CONFIRM='Entreprise à confirmer';

// Platforms that host many unrelated sites under their own domain. tldts already knows most of them as private
// suffixes (isPrivate); this list covers the ones it may not, and is matched on the host's end.
export const HOSTING_PLATFORM_SUFFIXES=['netlify.app','netlify.com','vercel.app','now.sh','github.io','gitlab.io','pages.dev','workers.dev','web.app','firebaseapp.com',
 'herokuapp.com','onrender.com','fly.dev','glitch.me','surge.sh','wixsite.com','wix.com','editorx.io','webflow.io','framer.website','framer.app','framer.ai','carrd.co',
 'squarespace.com','square.site','weebly.com','jimdosite.com','jimdofree.com','wordpress.com','blogspot.com','blogspot.fr','over-blog.com','hubspotpagebuilder.com',
 'myshopify.com','strikingly.com','site123.me','webnode.fr','webnode.page','e-monsite.com','sites.google.com','notion.site','super.site','typedream.app','godaddysites.com',
 'mystrikingly.com','canva.site','my.canva.site','lovable.app','replit.app','bolt.host'];

export type EntityNameMethod='event_subject'|'headline_and_event'|'headline_subject';
export type EntityResolution={
 entity_name:string|null;
 entity_name_status:'RESOLVED'|'UNRESOLVED';
 entity_name_method:EntityNameMethod|null;
 entity_confidence:'HIGH'|'MEDIUM'|null;
 entity_domain:string|null;
 entity_domain_status:'RESOLVED'|'UNRESOLVED';
 entity_domain_method:'own_site'|'domain_in_text'|null;
 // What the UI shows: the resolved name, or "Entreprise à confirmer". Never a platform name.
 display_name:string;
 source_host:string;
 // Registrable domain of the source, hosting platforms' private suffixes included ("terroirclub.netlify.app").
 source_domain:string|null;
 hosting_platform:string|null;
 source_page_kind:SourceType;
 reasons:string[];
};

const keepCase=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’`]/g,"'");
const alnum=(s:string)=>keepCase(s).toLowerCase().replace(/[^a-z0-9]/g,'');

export function hostingPlatformOf(host:string):string|null{
 const h=host.toLowerCase().replace(/\.$/,'');
 const listed=HOSTING_PLATFORM_SUFFIXES.find(suffix=>h===suffix||h.endsWith(`.${suffix}`));
 if(listed)return listed;
 const p=parseDomain(h,{allowPrivateDomains:true});
 return p.isPrivate&&p.publicSuffix?p.publicSuffix:null;
}
export function sourceDomainWithPrivate(host:string):string|null{
 return parseDomain(host.toLowerCase(),{allowPrivateDomains:true}).domain??null;
}

const CAP_WORD="[A-Z][\\w'&.-]*";
const CAP_RUN=`${CAP_WORD}(?:\\s+(?:(?:de|du|des|d'|la|le|les|l'|et|&)\\s+)?${CAP_WORD}){0,3}`;
// Words that introduce the organization ("l'enseigne X", "le groupe X", "la chaîne de restaurants X").
// Generic organization words may come without an article; a business-type word only WITH an article ("le
// restaurant X"): without one, it is part of the name ("Café Mira", "Brasserie Flo").
const ORG_INTRO=/^(?:(?:(?:l'|la |le |les )?(?:enseigne|chaine(?: de (?:restaurants?|restauration(?: rapide)?|boulangeries?|cafes?|magasins?))?|groupe|marque|franchise|franchiseur|reseau|societe|entreprise|start-?up|concept|specialiste(?: de [a-z' -]+)?|acteur(?: de [a-z' -]+)?)|(?:l'|la |le |les )(?:restaurant|brasserie|boulangerie|pizzeria|cafe|bar|traiteur|fast-food|maison|coffee shop|snack))\s+(?:de |d')?)+/i;
// Words that never are an organization's name by themselves.
const NOT_A_NAME=/^(?:le|la|les|l|un|une|des|ce|cet|cette|ces|notre|nos|votre|vos|mon|ma|mes|leur|leurs|son|sa|ses|nouveau|nouvelle|nouvel|ouverture|restaurant|restaurants|enseigne|groupe|marque|chaine|reseau|societe|entreprise|ville|mairie|region|departement|france|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|il|elle|ils|elles|on|c|apres|avant|depuis|des|en|a|au|pour|avec|deja|bientot|enfin|selon|toulouse|montpellier|occitanie|info|exclusif|video|photos)$/;
// Participial clauses about the organization, never its name ("Basée à Lyon", "Fondée en 2010").
const PARTICIPLE=/^(?:basee?s?|installee?s?|implantee?s?|fondee?s?|creee?s?|nee?s?|connue?s?|specialisee?s?|presente?s?|originaire|deja|apres|fort|forte|riche|avec|depuis|en|des|selon|d'apres)\b/i;

// The organization named at the start of one clause, or null.
function nameInClause(clause:string):string|null{
 let t=keepCase(clause).replace(/[«»"“”]/g,' ').replace(/\s+/g,' ').trim();
 if(!t||PARTICIPLE.test(t))return null;
 const raw=clause.normalize('NFC').replace(/[«»"“”]/g,' ').replace(/\s+/g,' ').trim();
 const intro=ORG_INTRO.exec(t);
 let offset=intro?intro[0].length:0;
 // A leading article or possessive alone ("Le", "Notre") is not a name.
 const lead=/^(?:le|la|les|l'|ce|cette|notre|nos)\s*/i.exec(t.slice(offset));
 if(lead&&!intro)offset+=lead[0].length;
 // After an introducing word, up to two lowercase adjectives may precede the name ("le groupe toulousain Napoli").
 if(intro){const adj=/^(?:[a-z][a-z'-]*\s+){1,2}(?=[A-Z])/.exec(t.slice(offset));if(adj)offset+=adj[0].length}
 const rest=t.slice(offset);
 const m=new RegExp(`^(${CAP_RUN})(?:\\s+(?:bientot|prochainement|desormais|aussi|egalement|deja|enfin|officiellement|qui|,))*\\s*$`).exec(rest);
 if(!m)return null;
 const name=raw.slice(offset,offset+m[1]!.length).trim();
 // P4: a commune named alone at the head of a clause is a place ("Jonzac, 3 800 habitants, … son deuxième
 // fast-food"); introduced as an organization ("l'enseigne Orange") it stays a name.
 if(!intro&&isCommuneName(name))return null;
 return acceptable(name)?name:null;
}
function acceptable(name:string):boolean{
 if(name.length<2||name.length>60)return false;
 if(/(?:^|\s)(?:et|and|&)(?:\s|$)|,/.test(name))return false; // several organizations: never pick one
 const words=keepCase(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
 if(!words.length||words.every(w=>NOT_A_NAME.test(w)))return false;
 if(NOT_A_NAME.test(words[0]!)&&words.length===1)return false;
 if(isPlaceName(name))return false;
 return true;
}
// The subject of the event: the last clause before the verb that names an organization.
export function eventSubject(subjectText:string):string|null{
 const clauses=subjectText.split(/\s*[,;:–—(]\s*|\s+-\s+/).map(c=>c.trim()).filter(Boolean);
 for(let i=clauses.length-1;i>=0;i--){const n=nameInClause(clauses[i]!);if(n)return n}
 return null;
}
// P4 (canary #1): the organization is often named as the OBJECT of the event, not its subject — "Un nouveau
// restaurant McDonald's s'apprête à ouvrir", "le nouveau restaurant Burger King de Castelnaudary", "un nouveau Quick
// ouvrira ses portes". Read only right after "nouveau/nouvel/nouvelle" (an establishment word optional) or after an
// establishment word + "de l'enseigne": a capitalized name there, never a place, never a generic word.
const OBJECT_NAME=new RegExp(`(?:^|[\\s,(])(?:(?:un|une|le|la|son|sa|du|de|d')\\s+)?(?:nouveau|nouvel|nouvelle|tout nouveau|toute nouvelle)\\s+(?:(?:restaurant|etablissement|magasin|point de vente|boutique|enseigne|fast-food|drive)\\s+)?(?:(?:de l'enseigne|de la chaine|de la marque)\\s+)?(${CAP_RUN})`,'g');
export function objectName(text:string):string|null{
 const kc=keepCase(text).replace(/[«»"“”]/g,' ');const raw=text.normalize('NFC').replace(/[«»"“”]/g,' ');
 for(const m of kc.matchAll(OBJECT_NAME)){
  const start=m.index!+m[0].length-m[1]!.length;
  // A name stops before a lowercase word: "Quick va ouvrir" → "Quick"; CAP_RUN already does. Trim a trailing "Le/La".
  let name=raw.slice(start,start+m[1]!.length).replace(/\s+(?:Le|La|Les|De|Du|Des)$/,'').trim();
  // "Burger King de Castelnaudary": the place after "de/du/d'" is where, not who.
  const tail=/\s+(?:de|du|des|d'|d’)\s*([A-ZÀ-Ý].*)$/.exec(name);
  if(tail&&(isPlaceName(tail[1]!)||isCommuneName(tail[1]!)))name=name.slice(0,tail.index).trim();
  const introduced=/(?:de l'enseigne|de la chaine|de la marque)\s+$/.test(m[0].slice(0,m[0].length-m[1]!.length));
  if(acceptable(name)&&(introduced||!isCommuneName(name)))return name;
 }
 return null;
}
// The grammatical subject's own clause (the text before the first comma): "La chaîne de restauration rapide, qui
// avait un temps déserté la France au profit de Burger King, ouvre…" → "La chaîne de restauration rapide". A capital
// at its very start is the sentence's, never a name.
const mainClauseNamesNoOne=(subject:string)=>!/\s[A-Z]/.test(keepCase(subject.split(/\s*[,;:–—(]\s*/)[0]??''));
// P4: a headline that opens on the organization and its event verb ("Crousto s'installe au Crès et dévoile…"),
// for verbs the shared headline reading does not know. The name must stand alone before the verb.
const HEADLINE_LEAD=new RegExp(`^(${CAP_RUN})\\s+(?:ouvre|ouvrira|va ouvrir|a ouvert|vient d'ouvrir|s'installe|s'installera|s'implante|s'implantera|arrive|debarque|inaugure|s'agrandit|poursuit son (?:developpement|implantation|expansion))\\b`);
function headlineLead(headline:string):string|null{
 const kc=keepCase(headline);const m=HEADLINE_LEAD.exec(kc);if(!m)return null;
 const name=headline.normalize('NFC').slice(0,m[1]!.length).trim();
 return acceptable(name)&&!isCommuneName(name)?name:null;
}
const sameAsHeadlineObject=(name:string,headline:string)=>{const h=objectName(headline);return !!h&&same(name,h)};
const same=(a:string,b:string)=>{const ca=entityCore(a),cb=entityCore(b);return ca.length>=2&&cb.length>=2&&(ca===cb||ca.startsWith(cb)||cb.startsWith(ca))};
const corroborates=(name:string,domain:string|null)=>{if(!domain)return false;const n=alnum(entityCore(name)||name),label=alnum(domain.split('.')[0]??'');return n.length>=3&&(label.startsWith(n)||n.startsWith(label)&&label.length>=4)};
const OPENING_HEADLINE=/\b(?:ouvr\w*|ouverture|implant\w*|s'install\w*|inaugur\w*|nouveau|nouvelle|nouvel|arrive|debarque|s'agrandit|deuxieme|second|seconde|troisieme|franchise)\b/i;

export function resolveEventEntity(event:ExtractedEvent):EntityResolution{
 const reasons:string[]=[];
 let host='';try{host=new URL(event.source_url).hostname.toLowerCase()}catch{/* extract.ts refuses an invalid URL */}
 const hosting=hostingPlatformOf(host);
 const sourceDomain=sourceDomainWithPrivate(host);
 const quality=assessCandidateQuality({title:event.headline,url:event.source_url,description:event.snippet},'');
 const canonical=resolveCanonicalCompany({title:event.headline,description:event.snippet,sourceUrl:event.source_url,quality});
 if(hosting)reasons.push(`hosting_platform:${hosting}`);

 // Name.
 const fromEvent=eventSubject(event.subject_text);
 const headlineMethod=canonical.companyName.status==='RESOLVED'?canonical.companyName.method:null;
 // Only an explicit headline pattern names an organization; a name derived from a domain never does here.
 const fromHeadline=(headlineMethod&&['colon_prefix','leading_verb','chez_mention'].includes(headlineMethod)&&acceptable(canonical.companyName.name)?canonical.companyName.name:null)??headlineLead(event.headline);
 let name:string|null=null,method:EntityNameMethod|null=null,confidence:EntityResolution['entity_confidence']=null;
 const fromObject=fromEvent?null:objectName(event.excerpt)??(event.excerpt_origin==='search_result_snippet'?objectName(event.headline):null);
 if(fromEvent&&fromHeadline){
  if(same(fromEvent,fromHeadline)){name=fromEvent;method='headline_and_event';confidence='HIGH'}
  else reasons.push('headline_names_another_organization');
 }else if(fromEvent){name=fromEvent;method='event_subject';confidence='MEDIUM'}
 else if(fromObject&&(!fromHeadline||same(fromObject,fromHeadline)||sameAsHeadlineObject(fromObject,event.headline))){
  // A headline prefix that is a rubric ("Commerce : … le nouveau restaurant Burgerio") does not contradict a name the
  // headline itself writes as the object of the opening.
  name=fromObject;method='event_subject';confidence=fromHeadline&&same(fromObject,fromHeadline)?'HIGH':'MEDIUM';reasons.push('named_as_event_object');
 }else if(fromObject&&fromHeadline)reasons.push('headline_names_another_organization');
 else if(fromHeadline&&OPENING_HEADLINE.test(keepCase(event.headline))&&event.excerpt_origin==='search_result_snippet'&&mainClauseNamesNoOne(event.subject_text)){
  // "Napoli ouvrira à Toulouse" as headline, the snippet sentence without subject ("Le restaurant ouvrira…").
  name=fromHeadline;method='headline_subject';confidence='MEDIUM';
 }else if(fromHeadline&&event.excerpt_origin==='search_result_title'){name=fromHeadline;method='headline_subject';confidence='MEDIUM'}
 if(!name)reasons.push('no_explicit_organization');

 // Domain.
 let domain:string|null=null,domainMethod:EntityResolution['entity_domain_method']=null;
 if(name&&!hosting){
  const cd=canonical.companyDomain;
  if(cd.status==='RESOLVED'){
   const d=sourceDomainWithPrivate(new URL(cd.website).hostname);
   if(d&&!hostingPlatformOf(d)&&corroborates(name,d)){domain=d;domainMethod=cd.method}
   else reasons.push('domain_not_corroborated_by_name');
  }
 }
 if(name&&domain&&domainMethod==='own_site')confidence='HIGH';
 return {
  entity_name:name,entity_name_status:name?'RESOLVED':'UNRESOLVED',entity_name_method:method,entity_confidence:name?confidence:null,
  entity_domain:domain,entity_domain_status:domain?'RESOLVED':'UNRESOLVED',entity_domain_method:domain?domainMethod:null,
  display_name:name??ENTITY_TO_CONFIRM,source_host:host,source_domain:sourceDomain,hosting_platform:hosting,
  source_page_kind:hosting?'unknown':canonical.sourceType,reasons,
 };
}
