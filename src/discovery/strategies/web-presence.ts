// Web presence diagnostic — what a web / SEO freelancer looks at first on a prospect's own site: who built it,
// on what, whether it still looks maintained, whether it works on a phone, whether a visitor can ask for a quote
// or book online. Deterministic, pure, no network, no LLM.
//
// Evidence-first, like every other extractor here:
//   - every fact is a CONTEXT note: criterion null, value null. It is never proposed as evidence, never scored
//     (scoreProspect counts VERIFIED evidence only) and never excludes a prospect;
//   - a fact that something IS on the page quotes that thing exactly (status OBSERVED). Before it is kept, its
//     excerpt must be found again in the page itself (isGrounded): a quote that is not in the source is dropped;
//   - a fact that something was NOT seen is only ever INFERRED, says how many pages were read, and never claims more
//     ("absence constatée sur ces pages, pas une preuve"). Its excerpt is the page's own <title>, so the reviewer
//     knows which page it is about; without a title, the fact is not emitted.
//
// Agency credit and CMS fingerprints are adapted from Harvey (github.com/ethanplusai/harvey, MIT,
// harvey/collectors/profile.py): the confidence ladder (explicit credit 0.9, descriptive anchor 0.75, a bare
// outbound link 0.35 and never recorded) and the platform fingerprints. Rewritten for French sites ("Site réalisé
// par", "Conception :", "Création site internet"), with hosting credits ("Hébergé par OVH") and consent / payment /
// social widgets refused.
import {load,type CheerioAPI} from 'cheerio';
import {createHash} from 'node:crypto';
import {ObservationSchema,type Observation} from '../types.ts';

import {type WebPresenceType} from './web-presence-labels.ts';
export {WEB_PRESENCE_TYPES,isWebPresenceType,type WebPresenceType} from './web-presence-labels.ts';

export type WebPresenceFact={type:WebPresenceType;status:'OBSERVED'|'INFERRED';claim:string;excerpt:string;url:string;title:string;confidence:number};
export type WebPage={url:string;html:string};

// Never more facts than this per analysis: they are context, the ICP's own proposals come first.
export const MAX_WEB_PRESENCE_FACTS=8;
// A copyright this many years old (or older) is worth a note; a younger one says nothing.
export const COPYRIGHT_STALE_YEARS=2;
// Below this much visible text the page was most likely drawn by JavaScript, which the analysis never runs: what is
// "not seen" there says nothing about the site, so no absence fact is emitted (found facts still are).
export const MIN_TEXT_FOR_ABSENCE=200;

const squash=(s:string)=>s.replace(/\s+/g,' ').trim();
const clip=(s:string,max=200)=>s.length<=max?s:s.slice(0,max).replace(/\s+\S*$/,'');

// Visible text of a page, whitespace-normalized: what an excerpt of text is checked against.
export function visibleText(html:string):string{
 const $=load(html.slice(0,500000));$('script,style,noscript,template,svg').remove();
 $('br').replaceWith(' ');return squash($.root().text());
}
// The anti-hallucination check: an excerpt is kept only when the page contains it, either in its visible text
// or, for a technical fact (a generator, an URL, a CDN path), verbatim in its source code.
export function isGrounded(excerpt:string,html:string,text=visibleText(html)):boolean{
 const e=squash(excerpt);if(!e)return false;
 return text.includes(e)||html.includes(excerpt.trim());
}

// ── who built the site ───────────────────────────────────────────────────────────────────────────────
// An explicit credit right before or in the link: "Site réalisé par", "Conception :", "Powered by"…
const STRONG_CREDIT=new RegExp([
 String.raw`\b(?:site(?:\s+(?:web|internet))?\s+)?(?:r[ée]alis[ée]e?s?|con[çc]ue?s?|cr[ée]{1,2}e?s?|d[ée]velopp[ée]e?s?|propuls[ée]e?s?|motoris[ée]e?s?|design[ée]?e?s?|webdesign)\s+par\b`,
 String.raw`\b(?:r[ée]alisation|conception|cr[ée]ation|webdesign|webmaster|cr[ée]dits?)\s*(?:du\s+site\s*)?:`,
 String.raw`\b(?:powered|website|site|web\s*design|designed|developed|built|created)\s+by\b`,
].join('|'),'i');
// An anchor that describes a web agency on its own ("Agence web Pixel", "Création site internet Bayonne").
const DESCRIPTIVE_CREDIT=/\b(?:agence\s+(?:web|digitale|de\s+communication|marketing)|cr[ée]ation\s+(?:de\s+)?sites?(?:\s+(?:web|internet))?|r[ée]f[ée]rencement|web\s*design|web\s*agency|digital\s*marketing|seo)\b/i;
// A hosting credit is a legal mention (LCEN), not the agency that built the site.
const HOSTING=/h[ée]berg|hosting|hosted\s+by/i;
// Outbound links that are never a site's maker: social, maps, payment, reviews, consent and accessibility
// widgets, public bodies, hosts, booking tools and the site builders themselves ("Créé avec Wix" is a platform,
// reported as WEB_CMS). Matched on whole domain labels, never as a substring: "x.com" must not refuse studio-x.com
// (Harvey's substring test did).
const BENIGN_DOMAINS=['x.com','t.co','wa.me','goo.gl','g.page','apple.com','bing.com','waze.com','stripe.com','gouv.fr','cnil.fr','europa.eu',
 'legifrance.gouv.fr','service-public.fr','wordpress.org','wordpress.com','wix.com','squarespace.com','shopify.com','gandi.net','pagesjaunes.fr'];
const BENIGN_BRANDS=['facebook','instagram','twitter','linkedin','youtube','tiktok','pinterest','whatsapp','google','paypal','lydia','sumup',
 'trustpilot','avis-verifies','guest-suite','axeptio','tarteaucitron','didomi','cookiebot','onetrust','iubenda','accessibe','userway',
 'jimdo','webflow','e-monsite','site123','godaddy','ovh','ovhcloud','o2switch','ionos','hostinger','planethoster','infomaniak',
 'calendly','doctolib','planity'];
export function isBenignHost(host:string):boolean{
 const h=host.toLowerCase().replace(/^www\./,'');const labels=h.split('.');
 if(BENIGN_DOMAINS.some(d=>h===d||h.endsWith('.'+d)))return true;
 // A brand is the registrable name (facebook.com, fr-fr.facebook.com, ovhcloud.com) — never a part of another
 // name (studio-ovh-lovers.fr is not OVH): only whole labels before the top-level domain count.
 return labels.slice(0,-1).some(l=>BENIGN_BRANDS.includes(l));
}

function footerScope($:CheerioAPI){
 const footer=$('footer,[role=contentinfo],[id*=footer],[class*=footer]');
 return footer.length?footer.find('a[href]'):$('body a[href]').slice(-25);
}
export function detectAgencyCredit($:CheerioAPI,pageHost:string):{excerpt:string;confidence:number}|null{
 let best:{excerpt:string;confidence:number}|null=null;
 footerScope($).each((_,el)=>{
  const a=$(el);const href=a.attr('href')??'';const anchor=squash(a.text());
  if(!/^https?:\/\//i.test(href)||!anchor||anchor.length>80)return;
  let host='';try{host=new URL(href).hostname.replace(/^www\./,'').toLowerCase()}catch{return}
  if(!host||host===pageHost||host.endsWith('.'+pageHost)||pageHost.endsWith('.'+host))return;
  if(isBenignHost(host))return;
  // The sentence the credit lives in: the link's own block (a footer line), never the whole footer.
  // A <br> inside it reads as a space, as in visibleText ("Site conçu par<br>Studio X").
  const block=(a.parent().closest('p,li,div,span,small,address,footer').first()).clone();
  const scope=block.length?block:a.parent().clone();scope.find('br').replaceWith(' ');
  const line=squash(scope.text());const at=line.indexOf(anchor);if(at<0)return;
  // Only the segment of that line the link closes: "Hébergement : OVH · Réalisation : Agence X" credits Agence X,
  // and its hosting half neither refuses nor feeds it. Still a substring of the page's text, so still a quote.
  const before=line.slice(0,at);
  const cut=Math.max(0,...[' | ',' · ',' • ',' – ',' — ',' - ','. ',' / '].map(sep=>{const i=before.lastIndexOf(sep);return i<0?0:i+sep.length}));
  const context=clip(line.slice(cut,at+anchor.length).trim(),200);
  if(!context.includes(anchor)||HOSTING.test(context))return;
  const confidence=STRONG_CREDIT.test(context)?.9:DESCRIPTIVE_CREDIT.test(anchor)?.75:.35;
  if(confidence>=.75&&(!best||confidence>best.confidence))best={excerpt:context,confidence};
 });
 return best;
}

// ── what it is built on ──────────────────────────────────────────────────────────────────────────────
// A page's own <meta name="generator"> is quoted as written. Fingerprints are the CDN paths a platform serves
// its files from; the matched path itself is the excerpt.
const FINGERPRINTS:[string,RegExp][]=[
 ['WordPress',/wp-content\/|wp-includes\//i],
 ['Wix',/static\.parastorage\.com|static\.wixstatic\.com/i],
 ['Squarespace',/static1\.squarespace\.com/i],
 ['Shopify',/cdn\.shopify\.com/i],
 ['Webflow',/assets\.website-files\.com/i],
];
export function detectCms($:CheerioAPI,html:string):{excerpt:string;claim:string;confidence:number}|null{
 const generator=squash($('meta[name="generator" i]').first().attr('content')??'');
 if(generator&&generator.length<=80)return {excerpt:generator,claim:`Le code de la page déclare son outil de création : « ${generator} »`,confidence:.9};
 for(const [name,re] of FINGERPRINTS){const m=html.match(re);if(m)return {excerpt:m[0],claim:`Site construit avec ${name} (empreinte technique « ${m[0]} » dans le code de la page)`,confidence:.8}}
 return null;
}

// ── does it still look maintained ────────────────────────────────────────────────────────────────────
const COPYRIGHT=/(?:©|\(c\)|copyright)\s*(?:(?:19|20)\d{2}\s*(?:-|–|—|à|to)\s*)?((?:19|20)\d{2})/gi;
export function staleCopyright(text:string,now:Date):{excerpt:string;year:number}|null{
 let latest:{excerpt:string;year:number}|null=null;
 for(const m of text.matchAll(COPYRIGHT)){
  const year=Number(m[1]);if(year<1995||year>now.getUTCFullYear())continue;
  if(!latest||year>latest.year){const start=Math.max(0,m.index!-60);latest={year,excerpt:squash(text.slice(start,m.index!+m[0].length+60))}}
 }
 if(!latest||now.getUTCFullYear()-latest.year<COPYRIGHT_STALE_YEARS)return null;
 return {year:latest.year,excerpt:clip(latest.excerpt,200)};
}

// ── can a visitor act online ─────────────────────────────────────────────────────────────────────────
// A quote request is a link, a button or a form that names it; a sentence alone ("devis gratuit au 05…") is not.
const QUOTE=/\bdevis\b|\bquote\b/i;
export function quoteRequest($:CheerioAPI):string|null{
 let found:string|null=null;
 $('a,button,input[type=submit],form legend,form h2,form h3,form label').each((_,el)=>{
  if(found)return;const e=$(el);const text=squash(e.is('input')?e.attr('value')??'':e.text());
  if(text&&text.length<=120&&QUOTE.test(text))found=text;
 });
 return found;
}
// Booking services whose own link or embed on the page is the proof. Only hosts known to be booking tools.
const BOOKING_HOSTS=['calendly.com','doctolib.fr','planity.com','resalib.fr','booksy.com','treatwell.fr','zenchef.com','thefork.fr','lafourchette.com','simplybook.me','setmore.com','acuityscheduling.com'];
export function onlineBooking($:CheerioAPI):string|null{
 let found:string|null=null;
 $('a[href],iframe[src],script[src]').each((_,el)=>{
  if(found)return;const raw=($(el).attr('href')??$(el).attr('src')??'').trim();
  let host='';try{host=new URL(raw).hostname.replace(/^www\./,'').toLowerCase()}catch{return}
  // The excerpt is the host as the page writes it: present verbatim in the source code, unlike a decoded URL.
  const written=new URL(raw).hostname;
  if(BOOKING_HOSTS.some(b=>host===b||host.endsWith('.'+b)))found=written;
 });
 return found;
}

// ── one analysis ─────────────────────────────────────────────────────────────────────────────────────
// pages[0] is the page the analysis started from (the site's home): page-level facts (mobile, HTTPS) are read
// there; "found" facts on any page read; "not seen" facts only once every page has been read.
export function diagnoseWebPresence(pages:WebPage[],now=new Date()):WebPresenceFact[]{
 if(!pages.length)return [];
 const facts:WebPresenceFact[]=[];
 // <br> reads as a space, as in visibleText: a footer line "Site réalisé par<br>Agence" quotes as the page shows it.
 const parsed=pages.map(p=>{const $=load(p.html.slice(0,500000));$('br').replaceWith(' ');return {...p,$,title:squash($('head title').first().text()).slice(0,300),text:visibleText(p.html)}});
 const home=parsed[0];
 let host='';try{host=new URL(home.url).hostname.replace(/^www\./,'').toLowerCase()}catch{/* no host: no agency check */}
 const add=(f:Omit<WebPresenceFact,'title'|'url'>,page=home)=>{
  // OBSERVED facts quote the page: dropped when the quote cannot be found again in it.
  if(f.status==='OBSERVED'&&!isGrounded(f.excerpt,page.html,page.text)&&f.excerpt!==page.url)return;
  facts.push({...f,url:page.url,title:page.title||'Page publique'});
 };
 const firstOf=<T>(read:(p:typeof home)=>T|null):{page:typeof home;value:T}|null=>{for(const page of parsed){const value=read(page);if(value)return {page,value}}return null};

 const credit=host?firstOf(p=>detectAgencyCredit(p.$,host)):null;
 if(credit)add({type:'WEB_AGENCY_CREDIT',status:'OBSERVED',excerpt:credit.value.excerpt,confidence:credit.value.confidence,
  claim:'Prestataire du site crédité en pied de page — extrait à vérifier (le site peut avoir changé de prestataire depuis)'},credit.page);

 const cms=firstOf(p=>detectCms(p.$,p.html));
 if(cms)add({type:'WEB_CMS',status:'OBSERVED',excerpt:cms.value.excerpt,confidence:cms.value.confidence,claim:cms.value.claim},cms.page);

 const copyright=firstOf(p=>staleCopyright(p.text,now));
 if(copyright)add({type:'WEB_COPYRIGHT_OLD',status:'OBSERVED',excerpt:copyright.value.excerpt,confidence:.85,
  claim:`Mention de copyright la plus récente : ${copyright.value.year} (il y a ${now.getUTCFullYear()-copyright.value.year} ans) — indice d'un site peu mis à jour, à vérifier`},copyright.page);

 // Absences need pages that were actually readable, and a title to quote.
 const canStateAbsence=!!home.title&&home.text.length>=MIN_TEXT_FOR_ABSENCE;
 if(home.url.startsWith('http://'))add({type:'WEB_NO_HTTPS',status:'OBSERVED',excerpt:home.url,confidence:.95,
  claim:'La page a été servie sans HTTPS : les navigateurs l’affichent « Non sécurisé »'});

 if(canStateAbsence&&!home.$('meta[name="viewport" i]').length)add({type:'WEB_NO_MOBILE_VIEWPORT',status:'INFERRED',excerpt:home.title,confidence:.7,
  claim:'Aucune balise « viewport » dans le code de la page d’accueil : affichage probablement non adapté au mobile — à vérifier sur un téléphone'});

 const pagesRead=`${parsed.length} page${parsed.length>1?'s':''} lue${parsed.length>1?'s':''}`;
 const quote=firstOf(p=>quoteRequest(p.$));
 if(quote)add({type:'WEB_QUOTE_REQUEST_FOUND',status:'OBSERVED',excerpt:quote.value,confidence:.8,
  claim:'Demande de devis proposée sur le site (lien, bouton ou formulaire) — fonctionnement à vérifier'},quote.page);
 else if(canStateAbsence)add({type:'WEB_NO_QUOTE_REQUEST_SEEN',status:'INFERRED',excerpt:home.title,confidence:.5,
  claim:`Aucun lien, bouton ni formulaire de demande de devis repéré (${pagesRead}) — absence constatée sur ces pages, pas une preuve`});

 const booking=firstOf(p=>onlineBooking(p.$));
 if(booking)add({type:'WEB_ONLINE_BOOKING_FOUND',status:'OBSERVED',excerpt:booking.value,confidence:.85,
  claim:`Prise de rendez-vous en ligne via un service externe (${booking.value.replace(/^www\./,'')})`},booking.page);
 else if(canStateAbsence)add({type:'WEB_NO_ONLINE_BOOKING_SEEN',status:'INFERRED',excerpt:home.title,confidence:.4,
  claim:`Aucun service de prise de rendez-vous en ligne repéré (${pagesRead}) — absence constatée sur ces pages, pas une preuve`});

 return facts.slice(0,MAX_WEB_PRESENCE_FACTS);
}

// Facts → stored observations: always a context note (criterion null, value null), validated by the same schema
// as every other observation. content_hash is the fact itself, so analysing the same site again does not
// duplicate it (unique (prospect_id, source_url, observation_type, content_hash)).
export function webPresenceObservations(pages:WebPage[],sourceType:Observation['source_type'],now=new Date()):Observation[]{
 const collected=now.toISOString(),expires=new Date(+now+90*86400000).toISOString();
 return diagnoseWebPresence(pages,now).map(f=>ObservationSchema.parse({
  criterion:null,observation_type:f.type,claim:f.claim,value:null,status:f.status,source_url:f.url,source_title:f.title,
  source_excerpt:f.excerpt.slice(0,500),source_type:sourceType,confidence:f.confidence,collected_at:collected,expires_at:expires,
  content_hash:createHash('sha256').update(`${f.type}\n${f.excerpt}`).digest('hex'),
 }));
}
