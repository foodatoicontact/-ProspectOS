// Propositions commerciales et devis de la « Veille dédiée » (commercial/README.md). Pur et sans dépendance : chargement et
// contrôle de la configuration, calcul des montants en centimes, numérotation, rendu HTML. Le PDF est produit par cli.ts.
// Règle : aucun identifiant légal n'est jamais inventé ni complété ici. Un devis n'est produit que si le vendeur est
// identifiable (devisRefusal) ; sinon seul le mode « proposition », non contractuel, est possible.
export type Mode='proposition'|'devis';
export type Vendeur={denomination:string;nom_commercial?:string;forme_juridique:string;capital:string;adresse:string;siren:string;rcs_ville:string;
 tva:{regime:''|'franchise'|'assujetti';numero?:string;taux?:number};email:string;telephone?:string;iban?:string;bic?:string};
export type Client={denomination:string;adresse:string;siren?:string;contact:{nom:string;fonction:string};regions:string[];sources:string[];metiers:string[];
 livrable:string;frequence:string;prix_ht_par_region_par_mois:number;mois_offerts:number;engagement:'mensuel'|'annuel';nombre_mois?:number;date_debut:string};
export type Ligne={libelle:string;quantite:number;unitaire:number;montant:number};   // montants en centimes ; remise = montant négatif
export type Totaux={lignes:Ligne[];totalHT:number;tva:number;totalTTC:number;mentionTva:string|null;tauxTva:number|null};

const vide=(v:unknown)=>v===undefined||v===null||String(v).trim()==='';
// Sociétés : le capital est une mention obligatoire des documents commerciaux (Code de commerce, art. R123-238).
const SOCIETE=/\b(SAS|SASU|SARL|EURL|SA|SNC|SCOP|SELARL|SELAS)\b|société/i;

/** Merge the versioned (empty) seller file with the local one, which only fills what it sets. */
export function mergeVendeur(base:Vendeur,local:Partial<Vendeur>|null):Vendeur{
 if(!local)return base;
 const out={...base} as Record<string,unknown>;
 for(const [k,v] of Object.entries(local))if(k!=='_note'&&!vide(v)&&!(typeof v==='object'&&!Array.isArray(v)))out[k]=v;
 if(local.tva)out.tva={...base.tva,...Object.fromEntries(Object.entries(local.tva).filter(([,v])=>!vide(v)))};
 return out as Vendeur;
}

/** The fields a quote cannot do without, empty here. Empty list: a quote may be issued. */
export function devisRefusal(v:Vendeur):string[]{
 const missing:string[]=[];
 if(vide(v.denomination))missing.push('dénomination');
 if(vide(v.siren))missing.push('SIREN');
 else if(!/^\d{9}$/.test(String(v.siren).replace(/\s/g,'')))missing.push('SIREN (9 chiffres attendus)');
 if(vide(v.rcs_ville))missing.push('RCS (ville du greffe)');
 if(vide(v.forme_juridique))missing.push('forme juridique');
 else if(SOCIETE.test(v.forme_juridique)&&vide(v.capital))missing.push('capital social (obligatoire pour une société)');
 if(vide(v.adresse))missing.push('adresse');
 if(v.tva?.regime!=='franchise'&&v.tva?.regime!=='assujetti')missing.push('régime de TVA (« franchise » ou « assujetti »)');
 else if(v.tva.regime==='assujetti'&&vide(v.tva.numero))missing.push('numéro de TVA intracommunautaire');
 return missing;
}

export function clientIssues(c:Client):string[]{
 const p:string[]=[];
 for(const k of ['denomination','adresse','livrable','frequence','date_debut'] as const)if(vide(c[k]))p.push(k);
 if(vide(c.contact?.nom))p.push('contact.nom');
 if(!Array.isArray(c.regions)||!c.regions.length)p.push('regions');
 if(!Array.isArray(c.sources)||!c.sources.length)p.push('sources');
 if(!Array.isArray(c.metiers)||!c.metiers.length)p.push('metiers');
 if(!(Number.isFinite(c.prix_ht_par_region_par_mois)&&c.prix_ht_par_region_par_mois>0))p.push('prix_ht_par_region_par_mois');
 if(!(Number.isInteger(c.mois_offerts)&&c.mois_offerts>=0))p.push('mois_offerts');
 if(c.engagement!=='mensuel'&&c.engagement!=='annuel')p.push('engagement (« mensuel » ou « annuel »)');
 if(c.nombre_mois!==undefined&&!(Number.isInteger(c.nombre_mois)&&c.nombre_mois>=1&&c.nombre_mois<=36))p.push('nombre_mois');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(c.date_debut??''))p.push('date_debut (AAAA-MM-JJ)');
 return p;
}

const cents=(eur:number)=>Math.round(eur*100);
const pluriel=(n:number,s:string,p=s+'s')=>`${n} ${n>1?p:s}`;
/** Lines and totals. Annual: 12 months, 2 of them offered. Monthly: `nombre_mois` (1 by default) months shown. */
export function calcul(c:Client,v:Vendeur):Totaux{
 const mois=c.engagement==='annuel'?12:(c.nombre_mois??1);
 const pu=cents(c.prix_ht_par_region_par_mois);
 const lignes:Ligne[]=c.regions.map(r=>({libelle:`Veille dédiée — ${r}`,quantite:mois,unitaire:pu,montant:pu*mois}));
 const parMois=pu*c.regions.length;
 if(c.mois_offerts>0)lignes.push({libelle:c.mois_offerts===1?'Premier mois offert':`${pluriel(c.mois_offerts,'mois offert','mois offerts')}`,quantite:c.mois_offerts,unitaire:-parMois,montant:-parMois*c.mois_offerts});
 if(c.engagement==='annuel')lignes.push({libelle:'Engagement annuel : 2 mois offerts',quantite:2,unitaire:-parMois,montant:-parMois*2});
 const totalHT=Math.max(0,lignes.reduce((s,l)=>s+l.montant,0));
 if(v.tva?.regime==='assujetti'){
  const taux=v.tva.taux??20;const tva=Math.round(totalHT*taux/100);
  return {lignes,totalHT,tva,totalTTC:totalHT+tva,mentionTva:null,tauxTva:taux};
 }
 return {lignes,totalHT,tva:0,totalTTC:totalHT,mentionTva:'TVA non applicable, art. 293 B du CGI',tauxTva:null};
}

/** DEV-AAAA-NNNN, numbered per year; returns the number and the counter to save (only once the PDF exists). */
export function prochainNumero(compteur:Record<string,number>,annee:number):{numero:string;compteur:Record<string,number>}{
 const n=(compteur[String(annee)]??0)+1;
 return {numero:`DEV-${annee}-${String(n).padStart(4,'0')}`,compteur:{...compteur,[String(annee)]:n}};
}

export const eur=(c:number)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(c/100).replace(/ /g,' ');
const MOIS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
export const dateFr=(iso:string)=>{const [y,m,d]=iso.slice(0,10).split('-').map(Number);return `${d===1?'1er':d} ${MOIS[m!-1]} ${y}`};
export const plusJours=(iso:string,j:number)=>new Date(Date.parse(iso.slice(0,10)+'T12:00:00Z')+j*86400000).toISOString().slice(0,10);
export const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

/** Minimal Markdown (#, ##, paragraphs, « - » lists) → HTML, for the annex; HTML comments are dropped. */
export function mdToHtml(md:string):string{
 const out:string[]=[];let list=false;
 for(const raw of md.replace(/<!--[\s\S]*?-->/g,'').split('\n')){
  const l=raw.trim();
  if(l.startsWith('- ')){if(!list){out.push('<ul>');list=true}out.push(`<li>${esc(l.slice(2))}</li>`);continue}
  if(list){out.push('</ul>');list=false}
  if(!l)continue;
  if(l.startsWith('## '))out.push(`<h3>${esc(l.slice(3))}</h3>`);
  else if(l.startsWith('# '))out.push(`<h2>${esc(l.slice(2))}</h2>`);
  else out.push(`<p>${esc(l)}</p>`);
 }
 if(list)out.push('</ul>');
 return out.join('\n');
}

const CSS=`@page{size:A4;margin:16mm 16mm 20mm}*{box-sizing:border-box}body{margin:0;font:9.6pt/1.5 Inter,"Segoe UI",system-ui,sans-serif;color:#14172b}
.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #6d5efc;padding-bottom:10px}
.logo{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13pt}.logo span{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:7px;background:#6d5efc;color:#fff;font-size:11pt}
.doc{text-align:right}.doc h1{margin:0;font-size:15pt;color:#0b0f24}.doc p{margin:2px 0;color:#4a4f6b;font-size:9pt}
.imm{display:inline-block;margin-top:4px;background:#fff4e5;color:#8a5200;border:1px solid #f0a33a;border-radius:6px;padding:1px 7px;font-size:8.5pt;font-weight:600}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}.box{border:1px solid #e3e5f0;border-radius:8px;padding:9px 11px}
.box h3{margin:0 0 4px;font-size:8pt;letter-spacing:.08em;text-transform:uppercase;color:#6b7090}.box p{margin:1px 0}.muted{color:#6b7090}
h2{font-size:11.5pt;margin:16px 0 6px;color:#0b0f24}table{width:100%;border-collapse:collapse}th{text-align:left;font-size:8pt;color:#6b7090;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #d9dcea;padding:5px 6px}
td{padding:6px;border-bottom:1px solid #eceef6}td.n,th.n{text-align:right;white-space:nowrap}tr.remise td{color:#12733a}
.tot{margin-left:auto;width:52%;margin-top:6px}.tot td{border:0;padding:3px 6px}.tot tr.grand td{font-weight:700;font-size:11pt;border-top:2px solid #0b0f24;padding-top:6px}
ul{margin:4px 0;padding-left:18px}li{margin:2px 0}.sign{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.sign .box{height:92px}
.accord{break-inside:avoid}.annexe{break-before:page}.annexe h2{font-size:13pt}.annexe h3{font-size:10pt;margin:12px 0 3px}.annexe p,.annexe li{font-size:9pt}`;

export function renderHtml(o:{mode:Mode;vendeur:Vendeur;client:Client;date:string;numero?:string|null;conditions:string}):string{
 const {mode,vendeur:v,client:c}=o;const t=calcul(c,v);
 const nomV=v.denomination||v.nom_commercial||'ProspectOS';
 const idV=[v.forme_juridique&&`${v.forme_juridique}${v.capital?` au capital de ${v.capital}`:''}`,v.siren&&`SIREN ${v.siren}`,v.rcs_ville&&`RCS ${v.rcs_ville}`,
  v.tva?.regime==='assujetti'&&v.tva.numero?`TVA ${v.tva.numero}`:null].filter(Boolean).join(' · ');
 const mois=c.engagement==='annuel'?12:(c.nombre_mois??1);
 const lignes=t.lignes.map(l=>`<tr class="${l.montant<0?'remise':''}"><td>${esc(l.libelle)}</td><td class="n">${l.quantite} mois</td><td class="n">${eur(l.unitaire)}</td><td class="n">${eur(l.montant)}</td></tr>`).join('');
 const tvaLigne=t.mentionTva?`<tr><td colspan="2" class="muted">${esc(t.mentionTva)}</td></tr>`:`<tr><td>TVA ${t.tauxTva} %</td><td class="n">${eur(t.tva)}</td></tr>`;
 const titre=mode==='devis'?'Devis':'Proposition commerciale';
 return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(titre)} — ${esc(c.denomination)}</title><style>${CSS}</style></head><body>
<div class="top"><div><div class="logo"><span>P.</span>${esc(v.nom_commercial||'ProspectOS')}</div></div>
<div class="doc"><h1>${titre}</h1>${o.numero?`<p>N° ${esc(o.numero)}</p>`:''}<p>Date : ${dateFr(o.date)}</p><p>Valable jusqu’au ${dateFr(plusJours(o.date,30))} (30 jours)</p>
${mode==='proposition'?'<span class="imm">Société en cours d’immatriculation</span>':''}</div></div>
<div class="parties"><div class="box"><h3>Vendeur</h3><p><b>${esc(nomV)}</b></p>${idV?`<p class="muted">${esc(idV)}</p>`:''}${v.adresse?`<p>${esc(v.adresse)}</p>`:''}
<p>${esc(v.email)}${v.telephone?` · ${esc(v.telephone)}`:''}</p></div>
<div class="box"><h3>Client</h3><p><b>${esc(c.denomination)}</b></p>${c.siren?`<p class="muted">SIREN ${esc(c.siren)}</p>`:''}<p>${esc(c.adresse)}</p>
<p>À l’attention de ${esc(c.contact.nom)}${c.contact.fonction?`, ${esc(c.contact.fonction)}`:''}</p></div></div>
<h2>Prestations</h2>
<table><thead><tr><th>Désignation</th><th class="n">Quantité</th><th class="n">Prix unitaire HT</th><th class="n">Montant HT</th></tr></thead><tbody>${lignes}</tbody></table>
<table class="tot"><tr><td>Total HT</td><td class="n">${eur(t.totalHT)}</td></tr>${tvaLigne}<tr class="grand"><td>Total TTC</td><td class="n">${eur(t.totalTTC)}</td></tr></table>
<h2>Périmètre et livrable</h2><ul>
<li>Régions : ${esc(c.regions.join(', '))}</li><li>Sources : ${esc(c.sources.join(', '))}, et registre national des entreprises pour vérifier chaque entreprise</li>
<li>Métiers ciblés : ${esc(c.metiers.join(' ; '))}</li><li>Livrable : ${esc(c.livrable)}</li><li>Fréquence : ${esc(c.frequence)}, à partir du ${dateFr(c.date_debut)}</li>
<li>Engagement : ${c.engagement==='annuel'?'annuel (12 mois, dont 2 offerts)':`mensuel, reconduit tacitement (${pluriel(mois,'mois')} chiffré${mois>1?'s':''} ci-dessus)`} ; résiliation avec un préavis de 30 jours, sans frais</li>
<li>Aucun volume de fiches n’est garanti : il dépend des publications officielles de la période.</li></ul>
<h2>Conditions de paiement</h2><ul>
<li>Paiement par virement à 30 jours à compter de la date de la facture${v.iban?` — IBAN ${esc(v.iban)}${v.bic?`, BIC ${esc(v.bic)}`:''}`:''}.</li>
<li>En cas de retard, des pénalités sont dues au taux de trois fois le taux d’intérêt légal, ainsi qu’une indemnité forfaitaire pour frais de recouvrement de 40 € (articles L441-10 et D441-5 du Code de commerce).</li>
<li>Pas d’escompte pour paiement anticipé.</li></ul>
<p class="muted">Les conditions particulières de la veille dédiée, jointes en annexe, font partie de ce document.</p>
${mode==='devis'?`<div class="accord"><h2>Bon pour accord</h2><div class="sign"><div class="box"><h3>Date</h3></div><div class="box"><h3>Signature et cachet du client</h3><p class="muted">Précédés de la mention « Bon pour accord »</p></div></div></div>`:''}
<section class="annexe">${mdToHtml(o.conditions)}</section></body></html>`;
}

export const PIED={proposition:'Document non contractuel. Un devis vous sera adressé dès l’immatriculation finalisée.',
 devis:(v:Vendeur,numero:string)=>`${v.denomination} · SIREN ${v.siren} · RCS ${v.rcs_ville} · Devis ${numero}`};
