import {load} from 'cheerio';
import type {SignalType} from './types.ts';
// Signal Engine S4 — deterministic extraction (docs/SIGNAL_ENGINE_V1_PLAN.md §7): what kind of event a text describes,
// when it happened, and whether it names the company we look at. Lexicons FR/EN, French and ISO dates, JSON-LD
// (JobPosting, NewsArticle…) and <time datetime>. No model, no network, no clock read: `now` is always passed in.
// An excerpt is always text read on the page itself, never a rewording.

export const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’']/g,"'").replace(/\s+/g,' ').trim();

// Order matters: the most specific events first (a "levée de fonds pour recruter 30 personnes" is a funding round, a
// "cyberattaque" announced in a news item is an incident before anything else). Each pattern is read on folded text.
const LEXICON:Array<[SignalType,RegExp]>=[
 ['incident_cyber',/\b(cyber ?attaques?|cyber-attaques?|rancongiciels?|ransomwares?|fuites? de donnees|data breach|piratage|incident de (cyber)?securite|security incident)\b/],
 ['funding',/\b(leve(e|nt)?s? (de )?\d|levee de fonds|leve des fonds|tour de table|series? [abc]\b|seed round|raises? \$?\d|raised \$?\d|funding round|financement de \d|millions? d'euros pour)/],
 ['acquisition',/\b(rachete|rachat|acquiert|acquisition|fusionne|fusion|reprend la societe|reprise de|acquires?|acquired|merger|merges with)\b/],
 ['public_contract_won',/\b(remporte (le|un) marche|attributaire|marche public remporte|titulaire du marche|wins? (a |the )?(public )?contract|awarded (a |the )?contract)\b/],
 ['leadership_change',/\b(nomme(e)?s?|nomination|nouveau (directeur|president|dg|ceo|cto|cfo|dsi|rssi|responsable)|nouvelle (directrice|presidente|dg|responsable)|prend la (direction|tete)|rejoint .{0,60} en tant que|appoints?|appointed|new (ceo|cto|cfo|chief|head|director|managing director))\b/],
 ['headcount_growth',/\b(recrute(r)? \d+|\d+ (recrutements|embauches|postes a pourvoir|creations? d'emplois)|creations? d'emplois|double(r)? (ses|son) effectifs?|hires? \d+ (people|employees))\b/],
 ['hiring_role',/\b(recrute|recrutons|recrutement|offres? d'emploi|nous rejoindre|rejoignez(-nous)?|h\/f|f\/h|cdi|cdd|alternance|we'?re hiring|is hiring|join (our|the) team|job opening)\b/],
 ['new_site',/\b(ouvre (un|une|son|sa|ses|de nouveaux|de nouvelles)|ouverture d'(un|une)|inaugure|inauguration|nouveaux locaux|nouveau (site|siege|bureau|entrepot|magasin|agence|atelier|showroom)|nouvelle (agence|usine|implantation|boutique)|demenage|opens? (a |its )?new)\b/],
 ['expansion',/\b(s'implante|implantation|s'etend|developpement a l'international|a l'international|nouveaux? marches?|expansion|expands?|expanding)\b/],
 ['certification',/\b(certifie(e)?s?|certification|iso ?\d{4,5}|qualiopi|label(lise|isee)?|hds|secnumcloud|certified)\b/],
 ['partnership',/\b(partenariat|nouveau partenaire|s'associe (a|avec)|signe un accord|alliance avec|partnership|partners with|teams up with)\b/],
 ['product_launch',/\b(lance(ment)?|devoile|nouvelle (offre|gamme|version|solution|application)|nouveau (produit|service|logiciel)|launch(es|ed)?|unveils?|introduces?)\b/],
 ['tech_change',/\b(migre|migration (vers|de)|deploie|deploiement d(e|u)|adopte|nouvel erp|nouveau (crm|erp|logiciel de)|passe (au|a) (cloud|sap|salesforce)|moves? to|migrat(es|ed) to|rolls? out)\b/],
 ['event',/\b(salon|conference|webinaire|webinar|table ronde|stand [a-z0-9]|rendez-vous sur|journee portes ouvertes|meetup|keynote|trade show)\b/],
];
// The event type a text describes, or null. Read on the title and excerpt together (folded).
export function classifySignal(text:string):SignalType|null{
 const t=fold(text);
 for(const [type,re] of LEXICON)if(re.test(t))return type;
 return null;
}

const MONTHS:Record<string,number>={janvier:1,janv:1,jan:1,january:1,fevrier:2,fevr:2,fev:2,feb:2,february:2,mars:3,mar:3,march:3,avril:4,avr:4,apr:4,april:4,mai:5,may:5,juin:6,jun:6,june:6,
 juillet:7,juil:7,jul:7,july:7,aout:8,aug:8,august:8,septembre:9,sept:9,sep:9,september:9,octobre:10,oct:10,october:10,novembre:11,nov:11,november:11,decembre:12,dec:12,december:12};
const iso=(y:number,m:number,d:number):string|null=>{
 if(y<1990||y>2100||m<1||m>12||d<1||d>31)return null;
 const date=new Date(Date.UTC(y,m-1,d));
 return date.getUTCMonth()===m-1&&date.getUTCDate()===d?date.toISOString().slice(0,10):null;
};
// A calendar day read in a text: ISO (2026-03-12, also inside a datetime), French (12 mars 2026, 1er octobre 2026,
// 12/03/2026, 12.03.2026), English (March 12, 2026 / 12 March 2026), relative ("il y a 3 jours", "3 days ago",
// "hier", "aujourd'hui"). Never a guess: an unreadable or impossible date is null.
export function parseDay(text:string|null|undefined,now:Date):string|null{
 if(!text)return null;
 const t=fold(text);
 let m=t.match(/\b(\d{4})-(\d{2})-(\d{2})/);if(m)return iso(+m[1],+m[2],+m[3]);
 m=t.match(/\b(\d{1,2})(?:er)?\s+([a-z]{3,9})\.?\s+(\d{4})\b/);if(m&&MONTHS[m[2]])return iso(+m[3],MONTHS[m[2]],+m[1]);
 m=t.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);if(m&&MONTHS[m[1]])return iso(+m[3],MONTHS[m[1]],+m[2]);
 m=t.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\b/);if(m)return iso(+m[3],+m[2],+m[1]);
 const day=(n:number)=>new Date(now.getTime()-n*86400000).toISOString().slice(0,10);
 if(/\baujourd'hui\b|\btoday\b/.test(t))return day(0);
 if(/\bhier\b|\byesterday\b/.test(t))return day(1);
 m=t.match(/\bil y a (\d{1,3}) (jour|jours|semaine|semaines|mois)\b/)??t.match(/\b(\d{1,3}) (day|days|week|weeks|month|months) ago\b/);
 if(m){const n=+m[1];const unit=m[2];return day(/^(semaine|week)/.test(unit)?n*7:/^(mois|month)/.test(unit)?n*30:n)}
 return null;
}

// The company named in a text, by whole words (case, accents and punctuation aside): "Acme" matches "ACME recrute" but
// not "Acmeo" nor "acme-tools.example". Legal forms (SAS, SARL…) are not part of the name to look for.
const LEGAL_FORMS=/\b(sas|sasu|sarl|sa|eurl|sci|snc|scop|gie|inc|ltd|llc|gmbh|group|groupe)\b\.?/g;
export function companyTokens(name:string):string{return fold(name).replace(LEGAL_FORMS,' ').replace(/[^a-z0-9]+/g,' ').trim()}
export function mentionsCompany(text:string,name:string):boolean{
 const needle=companyTokens(name);if(needle.length<2)return false;
 const hay=` ${fold(text).replace(/[^a-z0-9]+/g,' ')} `;
 return hay.includes(` ${needle} `);
}

export type PageItem={kind:'job'|'news';title:string;excerpt:string;published_at:string|null;event_date:string|null;source:'json_ld'|'time'|'listing'};
const clip=(s:string,n:number)=>{const t=s.replace(/\s+/g,' ').trim();return t.length<=n?t:t.slice(0,n-1).replace(/\s+\S*$/,'')+'…'};
const asDateTime=(v:unknown,now:Date):string|null=>{
 if(typeof v!=='string')return null;const d=parseDay(v,now);if(!d)return null;
 const full=new Date(v);return Number.isFinite(+full)&&/\d{2}:\d{2}/.test(v)?full.toISOString():`${d}T00:00:00.000Z`;
};
function jsonLdNodes(html:string):Array<Record<string,unknown>>{
 const $=load(html);const out:Array<Record<string,unknown>>=[];
 const walk=(v:unknown)=>{if(Array.isArray(v)){v.forEach(walk);return}if(v&&typeof v==='object'){const o=v as Record<string,unknown>;out.push(o);if(Array.isArray(o['@graph']))walk(o['@graph'])}};
 $('script[type="application/ld+json"]').each((_,el)=>{try{walk(JSON.parse($(el).text()))}catch{/* An unreadable block is ignored. */}});
 return out.slice(0,200);
}
const typeOf=(o:Record<string,unknown>)=>([] as unknown[]).concat(o['@type']??[]).map(String);
const textOf=(v:unknown)=>typeof v==='string'?load(`<p>${v}</p>`)('p').text().replace(/\s+/g,' ').trim():'';

// The dated items a page carries: job ads (JSON-LD JobPosting; on a careers page, links and headings marked as job
// ads), news items (JSON-LD articles; headings next to a <time datetime>). At most 20 per page.
export function extractPageItems(html:string,opts:{careersPage:boolean;now:Date}):PageItem[]{
 const items:PageItem[]=[];const seen=new Set<string>();
 const push=(i:PageItem)=>{const k=fold(i.title);if(!i.title||seen.has(k)||items.length>=20)return;seen.add(k);items.push(i)};
 for(const node of jsonLdNodes(html)){
  const types=typeOf(node);
  if(types.includes('JobPosting')){
   const title=textOf(node.title);if(!title)continue;
   // An ad past its closing date is no longer a reason to call.
   const until=parseDay(typeof node.validThrough==='string'?node.validThrough:null,opts.now);if(until&&until<opts.now.toISOString().slice(0,10))continue;
   const desc=textOf(node.description);
   push({kind:'job',title:clip(title,300),excerpt:clip(desc?`${title} — ${desc}`:title,500),published_at:asDateTime(node.datePosted,opts.now),event_date:null,source:'json_ld'});
  }else if(types.some(t=>/^(NewsArticle|Article|BlogPosting|PressRelease|Report)$/.test(t))){
   const title=textOf(node.headline??node.name);if(!title)continue;
   const desc=textOf(node.description);
   push({kind:'news',title:clip(title,300),excerpt:clip(desc?`${title} — ${desc}`:title,500),published_at:asDateTime(node.datePublished??node.dateCreated,opts.now),event_date:null,source:'json_ld'});
  }
 }
 const $=load(html.slice(0,500000));$('script,style,noscript,template,svg,nav,footer').remove();
 $('time[datetime]').each((_,el)=>{
  const when=asDateTime($(el).attr('datetime'),opts.now);if(!when)return;
  const box=$(el).closest('article,li,.post,.news,.actualite,div');
  const heading=box.find('h1,h2,h3,h4,a').first().text().replace(/\s+/g,' ').trim();
  if(!heading||heading.length<12)return;
  const text=box.text().replace(/\s+/g,' ').trim();
  push({kind:'news',title:clip(heading,300),excerpt:clip(text.length<=600?text:heading,500),published_at:when,event_date:null,source:'time'});
 });
 if(opts.careersPage){
  // Only strong job-ad markers: a contract type or the gender mention French job ads carry ("H/F").
  const JOB_MARK=/\b(h\/f|f\/h|cdi|cdd|alternance|stage|freelance|full[- ]time|part[- ]time)\b/;
  $('h2,h3,h4,li a,article a').each((_,el)=>{
   const title=$(el).text().replace(/\s+/g,' ').trim();
   if(title.length<8||title.length>200||!JOB_MARK.test(fold(title)))return;
   push({kind:'job',title:clip(title,300),excerpt:clip(title,500),published_at:null,event_date:null,source:'listing'});
  });
 }
 return items;
}

// Same-site pages worth reading for signals: news, press, blog, careers. Decided from the link's path and text.
const NEWS_LINK=/\b(actualites?|actus?|news|presse|press|communiques?|blog|journal|medias?|evenements?|events?)\b/;
const CAREERS_LINK=/\b(carrieres?|careers?|recrutement|recrute|emplois?|jobs?|offres?|nous rejoindre|rejoignez nous|join us|travailler chez)\b/;
export function signalPageKind(url:string,text:string):'news'|'careers'|null{
 let path='';try{path=new URL(url).pathname}catch{return null}
 const t=fold(`${path.replace(/[\/_-]+/g,' ')} ${text}`);
 if(CAREERS_LINK.test(t))return 'careers';
 if(NEWS_LINK.test(t))return 'news';
 return null;
}
