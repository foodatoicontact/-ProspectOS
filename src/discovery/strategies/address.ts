import {DEPARTMENTS} from '../geo-fr.ts';
// The postal address an organization publishes on its OWN site ("105 avenue du Port, 38150 Salaise-sur-Sanne").
// Read only when it is written in full — a street line, a 5-digit postal code and a town — never geocoded, never
// guessed from a phone prefix or a region name. The department (and its region) comes from the postal code
// itself. The result is a sourced observation: the prospect's city may be filled from it only while empty.
export type OfficialAddress={line:string;postalCode:string;city:string;department:string|null;region:string|null};
const STREET=/(?:^|[^0-9])\d{1,4}\s*(?:bis|ter)?\s*,?\s*(?:rue|avenue|av\.?|boulevard|bd|chemin|route|place|all[ée]e|impasse|quai|cours|zone|za|zi|zac|parc|lieu[- ]dit|rond[- ]point|voie)\s/i;
// Postal code, then the town: words (accents, hyphens, apostrophes, "Saint-…", "sur", "en") up to punctuation,
// a separator, a phone label or the end. "CEDEX" and a trailing country are not part of the town.
const POSTAL_TOWN=/(?:^|[^0-9])((?:0[1-9]|[1-8]\d|9[0-5])\d{3}|97\d{3})(?!\d)\s+([A-ZÀ-Ý][\p{L}'’-]*(?:[ -](?:[\p{L}'’]+))*?)(?=\s*(?:$|[,.;|•·()\n]|\s-\s|\s–\s|\s+(?:t[ée]l|fax|france|cedex|e-?mail|contact|siret|horaires)\b|\s+\d))/iu;
function departmentOf(postalCode:string){
 const code=postalCode.startsWith('97')?postalCode.slice(0,3):postalCode.startsWith('20')?(Number(postalCode)<20200?'2A':'2B'):postalCode.slice(0,2);
 return DEPARTMENTS.find(d=>d.code===code)??null;
}
export function officialAddressIn(lines:string[]):OfficialAddress|null{
 for(const line of lines){
  if(line.length>300||!STREET.test(line))continue;
  const m=POSTAL_TOWN.exec(line);if(!m)continue;
  const postalCode=m[1]!.toUpperCase(),city=m[2]!.replace(/\s+/g,' ').trim();
  if(city.length<2||city.length>60)continue;
  const d=departmentOf(postalCode);
  return {line,postalCode,city,department:d?.name??null,region:d?.region??null};
 }
 return null;
}
// What the prospect card may show: the town, with its department when the postal code gives one.
export const addressCity=(a:OfficialAddress):string=>a.department?`${a.city} (${a.department})`:a.city;
