// Signaux SIRENE — French text normalisation for matching a register entry with a Google place. Deterministic, no
// network. Accents, case, apostrophes and punctuation never decide a match; legal forms (SARL, SAS…) and short
// function words never count as a distinctive word; street types are written one way ("av" = "avenue").

const LEGAL_FORMS=new Set(['sarl','sas','sasu','eurl','sa','sci','snc','scop','scp','selarl','selas','ei','eirl','ste','societe','sarlu','micro','entreprise']);
const STOP_WORDS=new Set(['le','la','les','l','de','du','des','d','et','au','aux','a','en','chez','the','un','une','sur','pour','par']);
const STREET_TYPES:Record<string,string>={av:'avenue',ave:'avenue',bd:'boulevard',bld:'boulevard',boul:'boulevard',r:'rue',pl:'place',pce:'place',
 rte:'route',che:'chemin',chem:'chemin',ch:'chemin',all:'allee',imp:'impasse',crs:'cours',qu:'quai',sq:'square',res:'residence',lot:'lotissement',
 za:'zone',zac:'zone',zi:'zone',zone:'zone',fg:'faubourg',fbg:'faubourg',pass:'passage',sen:'sentier',vla:'villa',hameau:'hameau'};
// Number suffixes the register writes on their own ("12 B RUE…", "12 BIS RUE…").
const NUMBER_SUFFIX=/^(?:b|bis|t|ter|q|quater|c)$/;

// Lower case, no accent, apostrophes and punctuation as spaces, single spaces.
export function fold(text:string|null|undefined):string{
 return (text??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/œ/g,'oe').replace(/æ/g,'ae')
  .replace(/[’'`´]/g,' ').replace(/&/g,' et ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

// The words that identify a business name: no legal form, no function word, no single letter.
export function nameTokens(name:string|null|undefined):string[]{
 return fold(name).split(' ').filter(w=>w.length>1&&!LEGAL_FORMS.has(w)&&!STOP_WORDS.has(w));
}

export type AddressParts={number:string|null;street:string[];postalCode:string|null};
// A French street address as comparable parts: house number (with its suffix), street words (type expanded, function
// words dropped) and postal code. Built from the register's own fields or from one formatted line.
export function addressParts(line:string|null|undefined,postalCode?:string|null):AddressParts{
 const words=fold(line).split(' ').filter(Boolean);
 const cp=postalCode&&/^\d{5}$/.test(postalCode)?postalCode:(words.find(w=>/^\d{5}$/.test(w))??null);
 let number:string|null=null;const street:string[]=[];
 for(let i=0;i<words.length;i++){const w=words[i]!;
  if(w===cp)break;// what follows the postal code is the commune
  if(number===null&&!street.length&&/^\d{1,4}[a-z]?$/.test(w)){number=w.replace(/[a-z]$/,'');if(NUMBER_SUFFIX.test(words[i+1]??''))i++;continue}
  if(STOP_WORDS.has(w))continue;
  street.push(STREET_TYPES[w]??w);
 }
 return {number,street,postalCode:cp};
}

// Share of the smaller set found in the larger one (0..1).
export function overlap(a:readonly string[],b:readonly string[]):number{
 if(!a.length||!b.length)return 0;const [small,large]=a.length<=b.length?[a,b]:[b,a];const set=new Set(large);
 return small.filter(w=>set.has(w)).length/small.length;
}
