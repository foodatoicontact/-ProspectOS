// Programme partenaires (migration 052) — pure rules shared by the browser and the server. The database decides
// (attribution, commission, window, statements); these helpers only shape what is sent and shown.
export const PARTNER_CODE=/^[A-Z0-9]{3,20}$/;
export const REF_STORAGE_KEY='prospectos.partner_ref';
export const PAYOUT_THRESHOLD_CENTS=5000;
export const DEFAULT_RATE_PERCENT=30;
export const COMMISSION_MONTHS=12;

// « agence-a » or « Agence A » are typed by people: spaces and dashes are dropped, letters upper-cased. Anything else → null.
export function normalizePartnerCode(raw:unknown):string|null{
 if(typeof raw!=='string')return null;
 const c=raw.normalize('NFKC').replace(/[\s-]+/g,'').toUpperCase();
 return PARTNER_CODE.test(c)?c:null;
}
// ?ref=CODE on any page (the partner's link).
export function refFromSearch(search:string):string|null{
 try{return normalizePartnerCode(new URLSearchParams(search).get('ref'))}catch{return null}
}
// What sign-up sends to Supabase Auth with the account (user_metadata): the code if it is well-formed, nothing otherwise.
// The database reads it once, when the account creates its first organization; an unknown code is ignored there.
export function partnerSignupData(code:string):{partner_code?:string}{
 const c=normalizePartnerCode(code);return c?{partner_code:c}:{};
}
type Store={getItem(k:string):string|null;setItem(k:string,v:string):void};
// sessionStorage only (no cookie): the tab that followed the link keeps the code until it is closed. Every access may throw
// (private mode, blocked storage): the field then simply starts empty.
export function rememberRef(store:Store|null|undefined,search:string):string|null{
 const c=refFromSearch(search);if(!c||!store)return c;
 try{store.setItem(REF_STORAGE_KEY,c)}catch{}
 return c;
}
export function storedRef(store:Store|null|undefined):string{
 try{return normalizePartnerCode(store?.getItem(REF_STORAGE_KEY)??'')??''}catch{return ''}
}
export const referralLink=(origin:string,code:string)=>`${origin.replace(/\/+$/,'')}/?ref=${encodeURIComponent(code)}`;

// SIRET: 14 digits and a valid Luhn key (La Poste, SIREN 356000000: digit sum modulo 5) — the same rule as the database.
export function siretValid(raw:string):boolean{
 const s=raw.replace(/\s/g,'');if(!/^\d{14}$/.test(s))return false;
 const d=[...s].map(Number);
 if(s.startsWith('356000000'))return d.reduce((a,b)=>a+b,0)%5===0;
 return d.reduce((sum,v,i)=>{let x=v;if(i%2===0){x*=2;if(x>9)x-=9}return sum+x},0)%10===0;
}

// The amount EXCLUDING TAX a client paid on a Stripe invoice: what was paid, in the invoice's own HT/TTC proportion
// (total_excluding_tax / total). Under the VAT franchise both are equal. Missing or inconsistent figures → null (no line).
export type InvoiceAmounts={paid:number;ht:number};
export function invoiceAmounts(inv:{amount_paid?:number|null;total?:number|null;total_excluding_tax?:number|null}):InvoiceAmounts|null{
 const paid=inv.amount_paid,total=inv.total,ex=inv.total_excluding_tax;
 if(!Number.isInteger(paid)||(paid as number)<0)return null;
 if(paid===0)return {paid:0,ht:0};
 if(!Number.isInteger(total)||!Number.isInteger(ex)||(total as number)<=0||(ex as number)<0||(ex as number)>(total as number))return null;
 const ht=paid===total?ex as number:Math.round((paid as number)*(ex as number)/(total as number));
 return {paid:paid as number,ht:Math.min(ht,paid as number)};
}
// The commission the database computes, for display and tests: round(HT × rate / 100).
export const commissionOf=(htCents:number,ratePercent:number)=>Math.round(htCents*ratePercent/100);

export const euros=(cents:number)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(cents/100);
export const monthLabel=(iso:string)=>new Date(`${iso.slice(0,10)}T12:00:00Z`).toLocaleDateString('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'});
export const dayLabel=(iso:string)=>new Date(iso.length===10?`${iso}T12:00:00Z`:iso).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Paris'});
