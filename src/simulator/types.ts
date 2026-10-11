// Public simulator V1 — a CONTROLLED simulation on fictional demonstration data. Nothing here searches, fetches, scores
// with a new rule or writes anything: FIT and INTENT are the product's own pure functions applied to these fixtures,
// and the recommended angle is stored with the fixture (checked against the real O2 selector by the tests).
import type {Criterion,Evidence} from '../domain/core.ts';
import type {IntentSignal} from '../domain/intent.ts';
import type {AngleType,PublicContentItem} from '../outreach/angle.ts';

export const SCENARIO_IDS=['restauration','logiciel-pme','btp','cabinets','industrie','generique'] as const;
export type ScenarioId=typeof SCENARIO_IDS[number];
export const SIM_MAX_PROSPECTS=3;

// A dictionary term: `stem` is matched against the start of a normalized word, `label` is what the visitor is shown.
export type Keyword={stem:string;label:string};

export type SimProspect={
 id:string;name:string;fictional:true;
 domain:string;                       // a reserved .example domain, never a real site
 sector_label:string;size_label:string;
 evidence:Evidence[];signals:IntentSignal[];public_content:PublicContentItem[];
 angle_ref:{type:AngleType;source_id:string|null};
};
export type SimScenario={
 id:ScenarioId;version:1;label:string;
 reference_date:string;               // the simulation's fixed "now": stable ages and FIT
 match:{target:Keyword[];offer:Keyword[]};
 criteria:Criterion[];
 prospects:SimProspect[];
};

// The zone is a controlled list: it is only echoed back, it never selects or relocates a fictional company.
export const REGIONS=[
 {code:'ara',label:'Auvergne-Rhône-Alpes'},{code:'bfc',label:'Bourgogne-Franche-Comté'},{code:'bre',label:'Bretagne'},
 {code:'cvl',label:'Centre-Val de Loire'},{code:'cor',label:'Corse'},{code:'ges',label:'Grand Est'},{code:'hdf',label:'Hauts-de-France'},
 {code:'idf',label:'Île-de-France'},{code:'nor',label:'Normandie'},{code:'naq',label:'Nouvelle-Aquitaine'},{code:'occ',label:'Occitanie'},
 {code:'pdl',label:'Pays de la Loire'},{code:'pac',label:'Provence-Alpes-Côte d’Azur'},{code:'drom',label:'Outre-mer'},{code:'fr',label:'France entière'},
] as const;
export type RegionCode=typeof REGIONS[number]['code'];
export const REGION_CODES=REGIONS.map(r=>r.code) as RegionCode[];
