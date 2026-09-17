import {FOODATOI_CRITERIA,type Criterion} from './core.ts';
type Icp={criteria?:Criterion[]};
export function projectCriteria(relation:Icp|Icp[]|null|undefined):Criterion[]{return (Array.isArray(relation)?relation[0]:relation)?.criteria??FOODATOI_CRITERIA}
