import type {Criterion} from '../../domain/core.ts';
import type {ObservationContext} from './restaurant.ts';
// Deterministic, explainable recognition of an explicit, cross-sector commercial/growth event —
// never a per-project hardcode, and never a bare-keyword guess. Two closed vocabularies gate this,
// exactly like contact-channel.ts's phone rule: the criterion *key* must unambiguously mean
// "observable commercial signal" (never a fuzzy label match), and the page text must contain one of
// a small set of explicit, concrete phrases naming a real event — presence of a website, a phone
// number, or the company's mere existence is deliberately NOT enough (that would be exactly the
// "any signal -> any criterion" shortcut this module must avoid). A single vague word ("entreprise",
// "service", "croissance" alone) never matches; only a full phrase naming the event does.
export const COMMERCIAL_SIGNAL_KEYS=['commercial_signal','business_signal','growth_signal'] as const;
// Same rule as contact-channel.ts: the key must be backed by a label that still names a commercial/growth
// signal — a default key whose label the user rewrote ("Capacité multi-terrains") never receives one.
const COMMERCIAL_LABEL=/signal|commercia|recrut|croissance|ouverture|lancement|expansion|appel d.offres|developpement|business|growth|hiring/;
const normalizeLabel=(label:string)=>label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const COMMERCIAL_SIGNAL_TYPES=['RECRUITING_SIGNAL','NEW_LOCATION_SIGNAL','LAUNCH_SIGNAL','PUBLIC_TENDER_SIGNAL','EXPANSION_SIGNAL'] as const;
export function isCommercialSignalCriterion(c:Criterion):boolean{return (COMMERCIAL_SIGNAL_KEYS as readonly string[]).includes(c.key)&&COMMERCIAL_LABEL.test(normalizeLabel(c.label))}
export function findCommercialSignalCriterion(criteria:Criterion[]):Criterion|null{
 return criteria.find(isCommercialSignalCriterion)??null;
}
const PATTERNS:[string,RegExp,string][]=[
 ['RECRUITING_SIGNAL',/nous recrutons|recrute (?:actuellement|activement)|recrutement (?:en cours|actif)|rejoignez notre équipe|postes? à pourvoir/i,'Signal potentiel de recrutement'],
 ['NEW_LOCATION_SIGNAL',/nouvelle (?:agence|implantation|boutique|antenne)|ouverture (?:récente|prochaine|d.une nouvelle)|vient d.ouvrir|ouvre ses portes/i,'Signal potentiel d’ouverture ou de nouvelle implantation'],
 ['LAUNCH_SIGNAL',/nous lançons|lancement (?:de notre|d.une nouvelle|de la)/i,'Signal potentiel de lancement'],
 ['PUBLIC_TENDER_SIGNAL',/appel d.offres|consultation publique|marché public/i,'Mention potentielle d’appel d’offres ou de demande publique'],
 ['EXPANSION_SIGNAL',/expansion (?:internationale|nationale|du réseau)|développement à l.international|développement du réseau/i,'Signal potentiel d’expansion'],
];
// Which signals the label actually asks for. "Signal de recrutement / alternance / croissance" asks for hiring and
// growth: a public tender ("Appel d'offres") is another signal and never satisfies it. A label naming no specific
// signal ("Signal commercial observable", "Business signal") accepts every explicit event, as before.
const LABEL_SIGNALS:[string,RegExp][]=[
 ['RECRUITING_SIGNAL',/recrut|embauche|alternan|emploi|hiring|job/],
 ['NEW_LOCATION_SIGNAL',/ouverture|implantation|agence|croissance|expansion|growth/],
 ['LAUNCH_SIGNAL',/lancement|nouveaut|nouvelle offre|croissance|launch|growth/],
 ['PUBLIC_TENDER_SIGNAL',/appel d.offres|marches? publics?|commande publique|tender|dce/],
 ['EXPANSION_SIGNAL',/expansion|croissance|developpement|growth/],
];
export function acceptedSignalTypes(label:string):Set<string>{
 const l=normalizeLabel(label);const named=LABEL_SIGNALS.filter(([,re])=>re.test(l)).map(([t])=>t);
 return new Set(named.length?named:COMMERCIAL_SIGNAL_TYPES);
}
// What the label asks the event to be ABOUT, beyond the kind of signal: "Recrutement cybersécurité (RSSI,
// ingénieur sécurité)" asks for a recruitment about cybersecurity, RSSI or a security engineer. Read from the
// label's own words (never a per-sector list): the words naming the kind of signal or a generic qualifier are
// not a topic. A label naming no topic ("Signal commercial observable") accepts any event of its kinds, as before.
const NOT_A_TOPIC=/^(?:signal|signaux|commercial|commerciale|commerciaux|observable|observables|recrutement|recrutements|recrute|recrutent|recruter|embauche|embauches|hiring|job|jobs|emploi|emplois|alternance|poste|postes|profil|profils|croissance|growth|ouverture|ouvertures|implantation|implantations|agence|agences|lancement|lancements|nouveaute|nouveautes|nouvelle|offre|launch|expansion|developpement|appel|appels|offres|marche|marches|public|publics|publique|commande|tender|business|actif|active|actifs|recent|recente|recents|explicite|equivalent|equivalents|type|types|dans|pour|avec|chez|des|les|une|du|de|la|le|un|en|et|ou)$/;
const words=(s:string)=>normalizeLabel(s).split(/[^a-z0-9]+/).filter(w=>w.length>=3);
export function labelTopics(label:string):string[]{return [...new Set(words(label).filter(w=>!NOT_A_TOPIC.test(w)))]}
// A topic word is present in the sentence as a whole word, or inside a compound of at least 5 letters
// ("sécurité" in "cybersécurité" and back) — never as a fragment of an unrelated short word.
const mentionsTopic=(line:string,topics:string[])=>{const ws=words(line);return topics.some(t=>ws.some(w=>w===t||(t.length>=5&&w.length>=5&&(w.includes(t)||t.includes(w)))))};
export function matchCommercialSignal(ctx:Pick<ObservationContext,'lines'>,label?:string):{type:string;line:string;claim:string}|null{
 const accepted=label===undefined?null:acceptedSignalTypes(label);
 const topics=label===undefined?[]:labelTopics(label);
 // A generic event ("nous recrutons 40 opérateurs") never satisfies a criterion asking for a specific one.
 for(const [type,re,claim] of PATTERNS){if(accepted&&!accepted.has(type))continue;const line=ctx.lines.find(l=>re.test(l)&&(!topics.length||mentionsTopic(l,topics)));if(line)return {type,line,claim}}
 return null;
}
