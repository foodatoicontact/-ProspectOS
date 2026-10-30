// Signaux SIRENE — response cache with a time to live, so the same register page or Google search is not requested
// again within the TTL. Two stores behind one interface: memory (one process; tests, CLI) and the database table of
// migration 038 (server, shared by every instance). Keys are hashes of the request — never a secret, never the API
// key. Google content stays out of the database: the server caches Places responses in memory only (Google Maps
// Platform terms allow storing the place ID, not the place's details).
import {createHash} from 'node:crypto';

export interface ResponseCache{
 get(key:string):Promise<unknown|undefined>;
 set(key:string,value:unknown,ttlSeconds:number):Promise<void>;
}
export const cacheKey=(namespace:string,parts:unknown)=>`${namespace}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;

export class MemoryCache implements ResponseCache{
 private readonly entries=new Map<string,{value:unknown;expires:number}>();
 private readonly now:()=>number;
 constructor(now:()=>number=Date.now){this.now=now}
 async get(key:string){const e=this.entries.get(key);if(!e)return undefined;if(e.expires<=this.now()){this.entries.delete(key);return undefined}return e.value}
 async set(key:string,value:unknown,ttlSeconds:number){if(ttlSeconds>0)this.entries.set(key,{value,expires:this.now()+ttlSeconds*1000})}
}

// A cache that never stores (TTL 0, or a store that failed): every call reaches the source.
export const NO_CACHE:ResponseCache={get:async()=>undefined,set:async()=>{}};
