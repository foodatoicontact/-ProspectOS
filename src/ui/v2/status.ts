// What a StatusBadge says, in which tone, with which icon. A status is never carried by colour alone (label + icon),
// and two honesty rules are enforced here rather than left to each screen:
// - WATCH / WAIT never look like CONTACT (principle 6): each Today section has its own tone;
// - "Déclaré par vous" is never "Vérifié": a declaration has its own neutral tone, icon and label.
import type {Locale} from '../../i18n/locale.ts';
import type {TodaySection} from '../../nba/today.ts';
import type {IconName} from './icons.ts';
import type {StatusTone} from './tokens.ts';

export type UiStatus=StatusTone;
export const STATUS_META:Record<UiStatus,{icon:IconName;label:Record<Locale,string>}>={
 contact:{icon:'contact',label:{fr:'À contacter',en:'To contact'}},
 verify:{icon:'verify',label:{fr:'À vérifier',en:'To verify'}},
 engage:{icon:'engage',label:{fr:'Conversation en cours',en:'In conversation'}},
 watch:{icon:'watch',label:{fr:'En veille',en:'Watching'}},
 excluded:{icon:'excluded',label:{fr:'Exclu',en:'Excluded'}},
 verified:{icon:'verified',label:{fr:'Vérifié',en:'Verified'}},
 declared:{icon:'declared',label:{fr:'Déclaré par vous',en:'Declared by you'}},
};
export function statusLabelV2(status:UiStatus,locale:Locale):string{return STATUS_META[status].label[locale]}
// Today sections (src/nba/today.ts) → badge. Read-only use of the NBA type: nothing in the engine changes.
const SECTION_STATUS:Record<TodaySection,UiStatus>={contact:'contact',verify:'verify',engage:'engage',watch:'watch'};
export function statusForSection(section:TodaySection):UiStatus{return SECTION_STATUS[section]}
