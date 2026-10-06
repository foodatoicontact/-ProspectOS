import {STATUSES as BASE_STATUSES} from './core.ts';
// The prospect pipeline statuses. core.ts (scoring) stays byte-identical by rule; the Signal Engine S8 adds 'RDV' (a
// meeting was booked, migration 025) between 'Intéressé' and 'Gagné'. Same values as prospects_status_check.
const at=BASE_STATUSES.indexOf('Gagné');
export const STATUSES=[...BASE_STATUSES.slice(0,at),'RDV',...BASE_STATUSES.slice(at)] as const as readonly string[];
