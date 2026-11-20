// Recomputes the counts frozen in src/domain/seo-content.ts (AGENCY_FIGURES) for /prospection-agences-consultants, from the
// BODACC open data (DILA, Licence Ouverte) and the API Recherche d'entreprises, with ProspectOS's own rules:
//   A. purchases of a business by a company in Haute-Garonne (readSalesNotice), then their INSEE headcount band;
//   B. company creations in Île-de-France (parseBodacc, legal persons only; sole traders only counted);
//   C. head-office moves in Hauts-de-Seine (parseBodacc, the three wordings of the registries).
// Run by hand (network): node --experimental-strip-types scripts/agency-figures.mts 2026-08-20 2026-11-17
// It prints the numbers; copy them into AGENCY_FIGURES with the date of the run. Never run at build time.
import {parseBodacc,BODACC_EXPORT,HEAD_OFFICE_SEARCH} from '../src/collect/bodacc.ts';
import {readSalesNotice} from '../src/discovery/providers/bodacc-sales.ts';
const [FROM='2026-08-20',TO='2026-11-17']=process.argv.slice(2);
const SELECT='id,dateparution,familleavis,registre,commercant,ville,cp,numerodepartement,url_complete,listeetablissements,acte,modificationsgenerales,listepersonnes';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function exportRows(where:string):Promise<any[]>{for(let i=0;i<4;i++){try{const r=await fetch(`${BODACC_EXPORT}?${new URLSearchParams({where,select:SELECT})}`);if(r.ok)return await r.json() as any[]}catch{}await pause(2000)}throw Error('BODACC export failed')}
const range=`dateparution>=date'${FROM}' and dateparution<=date'${TO}'`;
const sales=await exportRows(`familleavis="vente" and typeavis="annonce" and numerodepartement="31" and ${range}`);
const buyers=[...new Set(sales.map(readSalesNotice).flatMap((r:any)=>'notice' in r?[r.notice.siren as string]:[]))];
let tenOrMore=0,contactable=0;
for(const siren of buyers){let d:any=null;for(let i=0;i<3&&!d;i++){try{const r=await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siren}&per_page=1`);if(r.ok)d=await r.json()}catch{}await pause(250)}
 const c=d?.results?.find((x:any)=>x.siren===siren);const band=c?.tranche_effectif_salarie;
 if(band&&!['NN','00','01','02','03'].includes(band)){tenOrMore++;if(c.etat_administratif==='A'&&c.opposition_diffusion_commerciale!==true)contactable++}}
const idf=['75','77','78','91','92','93','94','95'].map(d=>`numerodepartement="${d}"`).join(' or ');
const creations=parseBodacc(await exportRows(`familleavis="creation" and (${idf}) and ${range}`),'creation');
const moves=parseBodacc(await exportRows(`familleavis="modification" and numerodepartement="92" and ${HEAD_OFFICE_SEARCH} and ${range}`),'modification');
console.log(JSON.stringify({from:FROM,to:TO,salesHauteGaronne:{companies:buyers.length,tenOrMore,tenOrMoreContactable:contactable},
 creationsIdf:{companies:new Set(creations.events.filter(e=>e.kind==='CREATION').map(e=>e.siren)).size,soleTradersLeftOut:creations.skippedPersons},
 movesHautsDeSeine:{companies:new Set(moves.events.map(e=>e.siren)).size}},null,1));
