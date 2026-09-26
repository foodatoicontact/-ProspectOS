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
 ['RECRUITING_SIGNAL',/nous recrutons|recrute (?:actuellement|activement)|recrutement (?:en cours|actif)|rejoignez notre équipe|postes? à pourvoir/i,'Recrutement actif explicitement annoncé'],
 ['NEW_LOCATION_SIGNAL',/nouvelle (?:agence|implantation|boutique|antenne)|ouverture (?:récente|prochaine|d.une nouvelle)|vient d.ouvrir|ouvre ses portes/i,'Ouverture récente ou nouvelle implantation explicitement annoncée'],
 ['LAUNCH_SIGNAL',/nous lançons|lancement (?:de notre|d.une nouvelle|de la)/i,'Lancement explicitement annoncé'],
 ['PUBLIC_TENDER_SIGNAL',/appel d.offres|consultation publique|marché public/i,'Appel d’offres ou demande publique explicitement mentionné'],
 ['EXPANSION_SIGNAL',/expansion (?:internationale|nationale|du réseau)|développement à l.international|développement du réseau/i,'Expansion explicitement annoncée'],
];
export function matchCommercialSignal(ctx:Pick<ObservationContext,'lines'>):{type:string;line:string;claim:string}|null{
 for(const [type,re,claim] of PATTERNS){const line=ctx.lines.find(l=>re.test(l));if(line)return {type,line,claim}}
 return null;
}
