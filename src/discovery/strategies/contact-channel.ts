import type {Criterion} from '../../domain/core.ts';
// Deterministic, explainable recognition of a "documented professional contact channel" criterion,
// driven entirely by the project's own ICP — never a per-project hardcode (no "if Test SaaS").
// Recognition is a closed, literal key vocabulary, deliberately NOT a fuzzy label/word match: a
// phone number found on a page can only ever be attached to a criterion whose *key* unambiguously
// names contactability. This is narrower than GENERIC_KEYWORD_MATCH's label-based candidate search
// on purpose — matching on labels here would let an unrelated criterion whose label happens to
// contain a shared word (e.g. any label mentioning "contact") absorb a phone number as if it were
// proven true, which is exactly the hazardous "any phone -> any criterion" shortcut this must avoid.
export const CONTACT_CHANNEL_KEYS=['contactability','contact_channel','contact_documented','professional_contact'] as const;
// The key alone is not enough: a project created from the default ICP keeps its keys while the user
// rewrites the labels ("contactability" relabeled "Amplitude horaire étendue"). The criterion must ALSO
// still say, in the user's own words, that it is about a contact channel — otherwise a phone number
// would be proposed as proof of whatever the user renamed it to.
const CONTACT_LABEL=/contact|joignab|telephon|coordonn|canal|e-?mail|phone|reachab/;
const normalizeLabel=(label:string)=>label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function isContactChannelCriterion(c:Criterion):boolean{return (CONTACT_CHANNEL_KEYS as readonly string[]).includes(c.key)&&CONTACT_LABEL.test(normalizeLabel(c.label))}
export function findContactChannelCriterion(criteria:Criterion[]):Criterion|null{
 return criteria.find(isContactChannelCriterion)??null;
}
