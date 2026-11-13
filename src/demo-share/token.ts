import {createHash,randomBytes} from 'node:crypto';
// Demo links (migration 042). The token is drawn here — 256 random bits, URL-safe — shown once to the project owner and
// only its SHA-256 goes to the database: a database read never yields a working link.
export const newDemoToken=():string=>randomBytes(32).toString('base64url');
export const isDemoToken=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
export const demoTokenHash=(token:string):string=>createHash('sha256').update(token).digest('hex');
export const DEMO_PATH='/d/';
// Built on the address the owner is using (production or its preview), like the team invitation link.
export const demoLink=(origin:string,token:string):string=>new URL(`${DEMO_PATH}${token}`,origin).toString();
