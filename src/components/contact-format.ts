// Presentation only: a page's text often glues a phone number or an e-mail to the next words
// ("06.26.16.24.94Du Lundi au Samedi", "contact@studio.frDu lundi") because inline HTML elements carry no
// whitespace between them. The stored excerpt stays exactly what was read; only what a person sees is
// separated, and the contact itself is shown in a clean, readable form. No parsing of anything else.
const PHONE=/(?:\+33\s*(?:\(0\)\s*)?|0)[1-9](?:[ .-]?\d{2}){4}/g;
// A domain ends at its lowercase TLD: an uppercase letter or a digit glued after it starts the next words.
const EMAIL=/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[a-z]{2,24}(?=[^a-z]|$)/g;
export type ContactToken={kind:'phone'|'email';raw:string;display:string};

// "06.26.16.24.94" / "+33 6 26 16 24 94" → "06 26 16 24 94" (French numbering); anything else unchanged.
export function formatPhone(raw:string):string{
 let d=raw.replace(/\D/g,'');
 if(d.startsWith('33')&&d.length===11)d='0'+d.slice(2);
 if(d.startsWith('330')&&d.length===12)d='0'+d.slice(3);
 return /^0\d{9}$/.test(d)?d.match(/\d{2}/g)!.join(' '):raw.trim();
}
export function contactsIn(text:string):ContactToken[]{
 const out:ContactToken[]=[];
 for(const m of text.matchAll(PHONE))out.push({kind:'phone',raw:m[0],display:formatPhone(m[0])});
 for(const m of text.matchAll(EMAIL))out.push({kind:'email',raw:m[0],display:m[0].toLowerCase()});
 return out;
}
// The excerpt as displayed: a space where a word is glued before a contact, " · " where words are glued after it.
export function separateGluedContacts(text:string):string{
 let s=text;
 for(const re of [PHONE,EMAIL]){
  s=s.replace(re,(m,...args)=>{const offset=args[args.length-2] as number;const whole=args[args.length-1] as string;
   const before=whole[offset-1]??'',after=whole[offset+m.length]??'';
   return `${/[A-Za-zÀ-ÿ]/.test(before)?' ':''}${m}${/[A-Za-zÀ-ÿ0-9]/.test(after)?' · ':''}`;});
 }
 return s;
}
