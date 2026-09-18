import {safeLink} from '../domain/core.ts';
export type Identity={id?:string;name:string;website?:string|null;phone?:string|null;address?:string|null;city?:string|null};
// Exported so other modules needing the exact same normalization (e.g. candidate-diversity.ts's title
// containment check) never reimplement a subtly different variant.
export const normalize=(s:string|null|undefined)=>(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function normalizeDomain(s:string|null|undefined){if(!s||!safeLink(s))return null;const h=new URL(s).hostname.toLowerCase().replace(/^www\./,'');return h||null}
export function normalizePhone(s:string|null|undefined){if(!s)return null;let p=s.replace(/\(0\)/g,'').replace(/[^\d+]/g,'');if(p.startsWith('00'))p='+'+p.slice(2);if(/^0[1-9]\d{8}$/.test(p))p='+33'+p.slice(1);return /^\+[1-9]\d{7,14}$/.test(p)?p:null}
export function similarity(a:string,b:string){a=normalize(a);b=normalize(b);if(!a||!b)return 0;const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old}}return 1-row[b.length]/Math.max(a.length,b.length)}
export class DeduplicationService {
 threshold:number;
 constructor(threshold=.9){if(threshold<.8||threshold>1)throw Error('Fuzzy threshold 0.8–1 required');this.threshold=threshold}
 key(c:Identity){const d=normalizeDomain(c.website),p=normalizePhone(c.phone);return d?`domain:${d}|${normalize(c.address)||normalize(c.city)}`:p?`phone:${p}`:c.address?`address:${normalize(c.name)}|${normalize(c.address)}`:`name:${normalize(c.name)}|${normalize(c.city)}`}
 match(c:Identity,existing:Identity[]):{status:'unique'|'duplicate_candidate'|'merge_review_required';duplicate_of:string|null;reason:string}{
 const d=normalizeDomain(c.website),p=normalizePhone(c.phone);
 // Strong identifiers considered first across all rows, not just first matching row.
 for(const other of existing){const sameDomain=d&&d===normalizeDomain(other.website),samePhone=p&&p===normalizePhone(other.phone);if(sameDomain||samePhone){const conflict=(c.address&&other.address&&normalize(c.address)!==normalize(other.address))||(c.city&&other.city&&normalize(c.city)!==normalize(other.city));const weakDomain=sameDomain&&!samePhone&&(normalize(c.name)!==normalize(other.name)||!c.address||!other.address);return {status:conflict||weakDomain?'merge_review_required':'duplicate_candidate',duplicate_of:other.id??null,reason:conflict?'Identifiant partagé, localisations différentes':weakDomain?'Domaine partagé : établissement à vérifier':sameDomain?'Domaine et établissement identiques':'Téléphone public identique'}}}
 for(const other of existing){if(normalize(c.name)===normalize(other.name)&&c.address&&other.address&&normalize(c.address)===normalize(other.address))return {status:'duplicate_candidate',duplicate_of:other.id??null,reason:'Nom et adresse identiques'}}
 for(const other of existing){if(c.city&&other.city&&normalize(c.city)===normalize(other.city)&&similarity(c.name,other.name)>=this.threshold)return {status:'merge_review_required',duplicate_of:other.id??null,reason:`Nom/ville similaires (seuil ${this.threshold})`}}
 return {status:'unique',duplicate_of:null,reason:'Aucun doublon identifié'};
 }
}
