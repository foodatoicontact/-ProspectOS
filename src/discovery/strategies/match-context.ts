// ICP match quality: which sentence of a page REALLY supports a criterion value the user wrote (a target category,
// location or organization type, or a need signal). Deterministic and explainable:
//
//  1. FINDING the value (findTermMatches): the user's own words only, whole words only — exact phrase, the same
//     phrase written as a compound or with hyphens ("agro-alimentaire" = "agroalimentaire"), a single word in its
//     plural form ("restaurants"), or every content word of a multi-word value inflected in one short span
//     ("transports routiers"). Never a fragment ("bar" in "barbecue"), never a synonym, never a model.
//  2. JUDGING the sentence (assessMatch): a menu, a short title, legal or cookie text, a quotation, a general article
//     is not evidence. For what the organization IS (category, organization type), a sentence about its SECTOR
//     ("l'image du secteur agroalimentaire") or about its CLIENTS / MEMBERS ("nous accompagnons les entreprises de
//     l'agroalimentaire") says nothing about the organization itself — unless the sentence says it belongs
//     ("nous sommes une PME agroalimentaire", "acteur du secteur agroalimentaire").
//  3. CHOOSING the best sentence of the page (bestMatch), not the first one.
// A rejected match never becomes a proposal; its code explains to the reviewer why the criterion stays to confirm.
export type Dimension='categories'|'locations'|'org_types'|'need';
export type LineKind='CONTENT'|'NAVIGATION'|'LEGAL'|'BOILERPLATE';
export type RejectCode='NAVIGATION'|'LEGAL'|'BOILERPLATE'|'THIRD_PARTY'|'SECTOR_MENTION'|'SERVED_NOT_SELF'|'GENERAL_ARTICLE';
export type Assessment={accepted:true;code:'SELF'|'NEUTRAL';score:number}|{accepted:false;code:RejectCode};
export type TermMatch={line:string;value:string;kind:'exact'|'compound'|'inflected'|'concept';index:number};

export const norm=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’`]/g,"'").replace(/\s+/g,' ').trim();
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const tokens=(s:string)=>norm(s).split(/[^a-z0-9]+/).filter(Boolean);
const B='(?:^|[^a-z0-9])',E='(?=[^a-z0-9]|$)';
const GRAMMAR=new Set(['le','la','les','l','un','une','des','de','du','d','au','aux','a','en','et','ou','pour','par','sur','dans','avec']);

// A word and its regular French / English plural.
function variants(w:string):string[]{
 const v=new Set([w]);
 if(w.length>=3){v.add(`${w}s`);v.add(`${w}x`);if(w.endsWith('al'))v.add(`${w.slice(0,-2)}aux`);if(w.endsWith('s')||w.endsWith('x'))v.add(w.slice(0,-1))}
 return [...v];
}
// Every place a value appears in the lines, best kind first within a line.
export function findTermMatches(lines:string[],value:string):TermMatch[]{
 const words=tokens(value);if(!words.length)return [];
 const out:TermMatch[]=[];
 const phrase=new RegExp(`${B}(${words.map(esc).join('[\\s-]+')})${E}`);
 const compact=words.join('');
 const compound=words.length>1?new RegExp(`${B}(${esc(compact)})${E}`):null;
 // A single compound word the user wrote ("agroalimentaire") also matches its hyphenated / spaced writing.
 const split=words.length===1&&words[0].length>=8?words[0]:null;
 const content=words.filter(w=>!GRAMMAR.has(w));
 for(const line of lines){
  const n=norm(line);let m:RegExpExecArray|null;
  if((m=phrase.exec(n))){out.push({line,value,kind:'exact',index:m.index+m[0].length-m[1].length});continue}
  if(compound&&(m=compound.exec(n))){out.push({line,value,kind:'compound',index:m.index+m[0].length-m[1].length});continue}
  if(split){
   // "agro-alimentaire" / "agro alimentaire": the two halves joined by a hyphen or a space form the user's word.
   const hy=new RegExp(`${B}([a-z]{3,})[\\s-]([a-z]{3,})${E}`,'g');let found=-1;
   for(const h of n.matchAll(hy))if(h[1]+h[2]===split){found=(h.index??0)+h[0].length-h[1].length-h[2].length-1;break}
   if(found>=0){out.push({line,value,kind:'compound',index:found});continue}
  }
  if(words.length===1){
   const re=new RegExp(`${B}(${variants(words[0]).map(esc).join('|')})${E}`);
   if((m=re.exec(n))&&m[1]!==words[0]){out.push({line,value,kind:'inflected',index:m.index+m[0].length-m[1].length});continue}
  }else if(content.length>=2){
   // Every content word, inflected, within a span of at most (words + 2) tokens: one expression, not two
   // unrelated words of the same sentence.
   const toks=tokens(line);const pos=content.map(w=>{const vs=variants(w);return toks.map((t,i)=>vs.includes(t)?i:-1).filter(i=>i>=0)});
   if(pos.every(p=>p.length)){
    const span=Math.max(...pos.map(p=>p[0]))-Math.min(...pos.map(p=>p[0]));
    if(span<=content.length+1){const at=n.indexOf(toks[Math.min(...pos.map(p=>p[0]))]);out.push({line,value,kind:'concept',index:Math.max(0,at)})}
   }
  }
 }
 return out;
}

const LEGAL=/(cookies?|traceurs|mentions legales|politique de confidentialite|donnees personnelles|rgpd|gdpr|conditions generales|cgu|cgv|tous droits reserves|©|copyright|heberge(?:ur|ment|e par| par)|hosting|siret|rcs [a-z]|capital social de|tva intracom|numero de tva|directeur de (?:la )?publication|privacy|terms of)/;
const BOILER=/(newsletter|inscrivez-vous|abonnez-vous|suivez-nous|partager sur|lire la suite|en savoir plus|voir plus|cliquez ici|accepter|retour en haut|follow us|read more|subscribe)/;
// What kind of line this is, from its shape and wording only.
export function lineKind(raw:string):LineKind{
 const n=norm(raw);
 if(LEGAL.test(n))return 'LEGAL';
 const segments=raw.split(/\s[|·•>»/]\s|\s[|·•]|[|·•]\s/).map(s=>s.trim()).filter(Boolean);
 if(segments.length>=3&&segments.every(s=>tokens(s).length<=3))return 'NAVIGATION';
 if(BOILER.test(n)&&tokens(raw).length<=14)return 'BOILERPLATE';
 return 'CONTENT';
}

// The organization says it IS this (membership), anywhere in the sentence.
const MEMBERSHIP=new RegExp([
 `${B}(?:nous sommes|sommes|est|etait|we are|is) (?:une?|l'une? des|le|la|leader|specialiste|un acteur|une entreprise)`,
 `${B}(?:notre|nos) (?:entreprise|societe|groupe|pme|usine|usines|activite|production|metier|savoir-faire|atelier)`,
 `${B}(?:acteur|actrice|fabricant|producteur|productrice|transformateur|industriel|specialiste|leader|expert|entreprise|societe|pme|eti|groupe|maison|cooperative|association|cabinet|agence|atelier) (?:[a-z'-]+ ){0,3}?(?:du|de la|de l'|des|de|d')?\\s?$`,
 `${B}specialise\\w* (?:dans|en)`,
].join('|'));
// The value names the organization's clients, members or partners.
const SERVED=/(?:pour (?:les|des|vos|nos|une?|le|la|l')|aupres (?:des|de)|au service (?:des|de|du)|accompagn\w* (?:les|des|vos|nos)|nos clients|vos clients|clients? (?:du|de la|de l'|des|dans)|dedie\w* (?:aux|a l'|a la)|destine\w* (?:aux|a l'|a la)|adherents?|membres?|federe\w*|represente\w*|fourniss\w* (?:les|des|aux)|fournisseur\w* (?:des|de|du)|partenaires? (?:des|de|du)|partenaires?|travaill\w* (?:avec|pour)|clientes?|references?|ils nous font confiance|equip\w* (?:les|des)|aux (?:entreprises|industriels|professionnels|acteurs|structures|organisations))(?:[\s,;:]+[a-z'-]+){0,6}[\s,;:]*$/;
// The value is named as a sector, an industry or a market, right before it.
const SECTOR=/(?:secteurs?|filieres?|industries?|monde|univers|metiers|tendances?|marches?|acteurs|professionnels|entreprises|image)(?:\s+[a-z'-]+){0,2}?(?:\s+(?:de l'|de la|du|des|de|d'))?\s*$/;
const QUOTE=/[«"“]|temoign\w*|selon (?:un|une|le|la|les)|declare\w*|explique\w*|according to/;
const ARTICLE=/(?:tendances?|enquete|etude|barometre|chiffres cles|selon (?:une|un|les)|webinaire|webinar|livre blanc|guide|conseils? pour|comment |pourquoi |actualites? (?:du|de la)|^\d+ (?:conseils|astuces|tendances|erreurs))|\?\s*$/;

export function assessMatch(raw:string,value:string,dimension:Dimension,index?:number):Assessment{
 const kind=lineKind(raw);if(kind!=='CONTENT')return {accepted:false,code:kind};
 const n=norm(raw);const words=tokens(raw).length;
 // A short line alone is a heading or a menu entry, never a fact (an address line is a location: kept).
 if(dimension!=='locations'&&words<=3)return {accepted:false,code:'NAVIGATION'};
 if(dimension==='locations')return {accepted:true,code:'NEUTRAL',score:0.7};
 const at=index??Math.max(0,n.indexOf(norm(value).split(/[^a-z0-9]+/)[0]));
 const before=n.slice(Math.max(0,at-90),at);
 if(QUOTE.test(n))return {accepted:false,code:'THIRD_PARTY'};
 if(dimension==='need'){
  if(ARTICLE.test(n))return {accepted:false,code:'GENERAL_ARTICLE'};
  return {accepted:true,code:'NEUTRAL',score:0.8};
 }
 // Who the value describes: clients / members first (the organization serves them), then the organization itself,
 // then a mere sector mention.
 if(SERVED.test(before))return {accepted:false,code:'SERVED_NOT_SELF'};
 const member=MEMBERSHIP.test(before)||new RegExp(`${B}(?:nous sommes|sommes|est|we are|is) (?:une?|le|la)?\\s?(?:[a-z'-]+ ){0,3}?$`).test(before)
  ||/(?:^|[^a-z])(?:nous sommes|notre (?:entreprise|societe|groupe|pme)|nous (?:fabriquons|produisons|transformons|concevons|gerons|exploitons|distribuons))(?=[^a-z]|$)/.test(n);
 if(member)return {accepted:true,code:'SELF',score:1};
 if(SECTOR.test(before))return {accepted:false,code:'SECTOR_MENTION'};
 if(ARTICLE.test(n))return {accepted:false,code:'GENERAL_ARTICLE'};
 return {accepted:true,code:'NEUTRAL',score:0.7};
}

export type Best={match:TermMatch;assessment:Extract<Assessment,{accepted:true}>};
export type Rejected={match:TermMatch;code:RejectCode};
// The best supporting sentence for any of the values, and what was refused (to explain it).
export function bestMatch(lines:string[],values:string[],dimension:Dimension):{best:Best|null;rejected:Rejected[]}{
 let best:Best|null=null;const rejected:Rejected[]=[];
 const kindRank={exact:4,compound:3,inflected:3,concept:2};
 for(const value of values)for(const match of findTermMatches(lines,value)){
  const a=assessMatch(match.line,value,dimension,match.index);
  if(!a.accepted){rejected.push({match,code:a.code});continue}
  if(!best||a.score>best.assessment.score||(a.score===best.assessment.score&&kindRank[match.kind]>kindRank[best.match.kind]))best={match,assessment:a};
 }
 return {best,rejected};
}

const REASONS:Record<RejectCode,string>={
 NAVIGATION:'n’apparaît que dans un menu ou un titre court',
 LEGAL:'n’apparaît que dans les mentions légales, les cookies ou les informations d’hébergement',
 BOILERPLATE:'n’apparaît que dans un bandeau ou un lien générique',
 THIRD_PARTY:'apparaît dans une citation ou un témoignage, pas comme un fait sur l’organisation',
 SECTOR_MENTION:'apparaît dans une phrase sur le secteur, sans dire que l’organisation en fait partie',
 SERVED_NOT_SELF:'désigne ici les clients, membres ou partenaires de l’organisation, pas l’organisation elle-même',
 GENERAL_ARTICLE:'apparaît dans un article ou un titre général, pas comme un fait sur l’organisation',
};
export const rejectionReason=(value:string,code:RejectCode)=>`« ${value} » ${REASONS[code]} — correspondance écartée, critère à confirmer`;
