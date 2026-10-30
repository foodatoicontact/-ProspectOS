// Signaux SIRENE — the presets (which activities, how recent). Configuration, not code: the defaults live in
// presets.defaults.ts and REGISTRY_SIGNAL_PRESETS_JSON (same shape) replaces them entirely on a server. Every preset is
// validated: NAF rév. 2 codes as the register writes them (two digits, dot, two digits, letter), an age in days.
import {z} from 'zod';
import {DEFAULT_PRESETS as DEFAULTS} from './presets.defaults.ts';

export const NAF_CODE=/^\d{2}\.\d{2}[A-Z]$/;
export const PresetSchema=z.object({
 label:z.string().trim().min(2).max(80),
 max_age_days:z.number().int().min(1).max(730),
 naf_codes:z.array(z.string().regex(NAF_CODE)).min(1).max(100),
 name_keywords:z.array(z.string().trim().min(2).max(40)).max(50).default([]),
 ambiguities:z.array(z.string().max(500)).max(20).default([]),
}).strict();
export type Preset=z.infer<typeof PresetSchema>&{key:string};
const PresetsSchema=z.record(z.string().regex(/^[a-z][a-z0-9_]{1,59}$/),PresetSchema);

export function loadPresets(env:Record<string,string|undefined>=process.env):Record<string,Preset>{
 const raw=env.REGISTRY_SIGNAL_PRESETS_JSON?.trim();
 let source:unknown=DEFAULTS;
 if(raw){try{source=JSON.parse(raw)}catch{throw Error('REGISTRY_PRESETS_INVALID')}}
 const parsed=PresetsSchema.safeParse(source);
 if(!parsed.success||!Object.keys(parsed.data).length)throw Error('REGISTRY_PRESETS_INVALID');
 return Object.fromEntries(Object.entries(parsed.data).map(([key,p])=>[key,{...p,key}]));
}
