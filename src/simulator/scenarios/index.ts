// The closed list of simulator scenarios, in the fixed order used to break ties in matching.
import type {ScenarioId,SimScenario} from '../types.ts';
import {restauration} from './restauration.ts';
import {logicielPme} from './logiciel-pme.ts';
import {btp} from './btp.ts';
import {cabinets} from './cabinets.ts';
import {industrie} from './industrie.ts';
import {generique} from './generique.ts';

export const SCENARIOS:readonly SimScenario[]=[restauration,logicielPme,btp,cabinets,industrie,generique];
export const getScenario=(id:ScenarioId):SimScenario|undefined=>SCENARIOS.find(s=>s.id===id);
