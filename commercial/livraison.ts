// Liste livrée au client de la veille dédiée — le gabarit des PDF déjà envoyés (couverture, « L'essentiel en une page »,
// une section par signal, cartes à deux colonnes, « Méthode & sources »), porté tel quel du générateur d'origine. La même
// description sert à deux sorties : le HTML imprimé en PDF (npm run livraison) et le fichier d'import de l'espace de
// suivi, pour que chaque fiche y garde son ordre, son numéro et ses intitulés. Aucune donnée client n'est versionnée : les
// descriptions réelles vivent dans commercial/livraisons/ (ignoré par git), sauf l'exemple fictif.
export type Fiche={siren:string;nom:string;ville:string;dep:string;date:string;fait:string;pourquoi:string;accroche:string;url:string;puces?:string[]};
export type Section={cle:string;titre:string;sous_titre:string;source:string;couleur:string;badge:string;fiches:Fiche[]};
export type Livraison={
 client:string;titre_document:string;eyebrow:string;lead:string;
 kpis:[string,string][];             // hors le total, calculé : [valeur, libellé]
 departements:Record<string,string>;note_departements:string;
 signaux:{titre:string;texte:string;couleur:string}[];
 par_ou_commencer:{nom:string;ville:string;texte:string;fiche:number}[];   // fiche : numéro (1, 2, 3…) dans l'ordre du document
 methode:{titre:string;texte:string}[];ecartes:string[];
 cta:{titre:string;texte:string;lien:string;libelle:string};mention_legale:string;
 sections:Section[];
};
const E=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
// The section titles may carry « & »: escaped once, like the original (« Syndics &amp; administrateurs »).
const T=(s:string)=>E(s);
const MOIS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
export function dateIso(fr:string):string{
 const m=/^(\d{1,2})(?:er)?\s+(\S+)\s+(\d{4})$/.exec(fr.trim());const i=m?MOIS.indexOf(m[2]!.toLowerCase()):-1;
 if(!m||i<0)throw Error(`Date illisible : ${fr}`);
 return `${m[3]}-${String(i+1).padStart(2,'0')}-${m[1]!.padStart(2,'0')}`;
}
export function issues(l:Livraison):string[]{
 const p:string[]=[];let n=0;
 for(const s of l.sections){
  if(!/^[a-z0-9-]{1,30}$/.test(s.cle))p.push(`section « ${s.titre} » : clé invalide`);
  if(!/^#[0-9a-f]{6}$/i.test(s.couleur))p.push(`section « ${s.titre} » : couleur #rrggbb requise`);
  for(const f of s.fiches){n++;
   if(!/^\d{9}$/.test(f.siren))p.push(`fiche ${n} (${f.nom}) : SIREN à 9 chiffres requis`);
   if(!/^https:\/\//.test(f.url))p.push(`fiche ${n} (${f.nom}) : lien de source https requis`);
   try{dateIso(f.date)}catch{p.push(`fiche ${n} (${f.nom}) : date illisible`)}
   for(const k of ['nom','ville','dep','fait','pourquoi','accroche'] as const)if(!String(f[k]??'').trim())p.push(`fiche ${n} (${f.nom}) : ${k} manquant`);
  }
 }
 for(const t of l.par_ou_commencer)if(!(t.fiche>=1&&t.fiche<=n))p.push(`« Par où commencer » : fiche ${t.fiche} inexistante`);
 if(!n)p.push('aucune fiche');
 return p;
}
// Before any delivery: every company is checked in the official register (API Recherche d'entreprises). A company that
// objects to commercial prospecting (opposition_diffusion_commerciale), a sole trader, a closed company or one the register
// does not know is refused — the list cannot be generated until it is removed. fetchJson is injected (tests, CLI).
export type FetchJson=(url:string)=>Promise<unknown>;
export async function verifierEntreprises(l:Livraison,fetchJson:FetchJson,pause:()=>Promise<void>=async()=>{}):Promise<string[]>{
 const p:string[]=[];let n=0;
 for(const s of l.sections)for(const f of s.fiches){n++;
  let r:Record<string,any>|undefined;
  try{const body=await fetchJson(`https://recherche-entreprises.api.gouv.fr/search?${new URLSearchParams({q:f.siren,per_page:'1'})}`) as {results?:Record<string,any>[]};
   r=(body.results??[]).find(x=>x?.siren===f.siren)}catch{p.push(`fiche ${n} (${f.nom}) : registre injoignable, réessayez`);await pause();continue}
  if(!r)p.push(`fiche ${n} (${f.nom}) : SIREN ${f.siren} introuvable au registre`);
  else{
   if(r.opposition_diffusion_commerciale===true)p.push(`fiche ${n} (${f.nom}) : opposée à la prospection commerciale (registre Sirene) — à retirer`);
   if(r.complements?.est_entrepreneur_individuel===true||String(r.nature_juridique??'').startsWith('1'))p.push(`fiche ${n} (${f.nom}) : entrepreneur individuel — à retirer`);
   if(r.etat_administratif!=='A')p.push(`fiche ${n} (${f.nom}) : entreprise fermée — à retirer`);
  }
  await pause();
 }
 return p;
}
// The document, as the original generator wrote it (same markup, same order, same anchors c1…cN).
export function renderHtml(l:Livraison,css:string):string{
 const all=l.sections.flatMap(s=>s.fiches);const total=all.length;
 const deps=new Map<string,number>();for(const f of all)deps.set(f.dep,(deps.get(f.dep)??0)+1);
 const mx=Math.max(...deps.values());
 const bars=[...deps.entries()].sort((a,b)=>a[0]<b[0]?-1:1).map(([k,v])=>`<div class="bar"><div class="bl">${k} · ${l.departements[k]??''}</div><div class="bt"><div class="bf" style="width:${(v/mx*100).toFixed(0)}%"></div></div><div class="bv">${v}</div></div>`).join('');
 let i=0;
 const card=(f:Fiche,s:Section)=>{i++;
  const meta=`<span class="chip">${f.dep} · ${E(f.ville)}</span>`+(f.puces??[]).map(p=>`<span class="chip ghost">${E(p)}</span>`).join('');
  return `<div class="card" id="c${i}"><div class="ch"><div><div class="nm">${E(f.nom)}</div><div class="meta">${meta}</div></div><div class="dt"><span>${s.badge}</span><b>${E(f.date)}</b></div></div>
<div class="fact"><span class="k">Le fait</span>${E(f.fait)}</div>
<div class="why"><span class="k">Pourquoi maintenant</span>${E(f.pourquoi)}</div>
<div class="hook"><span class="k">Votre accroche</span>« ${E(f.accroche)} »</div>
<a class="src" href="${f.url}">Voir la source officielle ↗</a></div>`};
 const secs=l.sections.map(s=>({s,cards:s.fiches.map(f=>card(f,s)).join('')}));
 const nav=secs.map(({s})=>`<a class="toc" href="#s-${s.cle}"><span class="dot" style="background:${s.couleur}"></span><span class="tt">${T(s.titre)}<small>${s.sous_titre}</small></span><span class="n">${s.fiches.length}</span></a>`).join('');
 const body=secs.map(({s,cards})=>`<section id="s-${s.cle}" class="sec"><div class="sh" style="--c:${s.couleur}"><div class="sn">${s.fiches.length} entreprises</div><h2>${T(s.titre)}</h2><p>${s.sous_titre} · source : ${s.source}</p><a class="back" href="#sommaire">↑ Sommaire</a></div><div class="grid">${cards}</div></section>`).join('');
 const top=l.par_ou_commencer.map(t=>`<a class="top" href="#c${t.fiche}"><div class="tn">${E(t.nom)}</div><div class="tv">${E(t.ville)}</div><div class="tw">${E(t.texte)}</div></a>`).join('');
 const kpis=[[String(total),'entreprises'],...l.kpis].map(([v,k])=>`<div><b>${v}</b><span>${k}</span></div>`).join('');
 return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${l.titre_document.replace('{total}',String(total))}</title><style>${css}</style></head><body>
<div class="page cover"><div class="glow"></div>
<div class="cv-top"><div class="logo"><span>P.</span>ProspectOS</div><div class="for">Préparé pour <b>${E(l.client)}</b></div></div>
<div class="cv-mid"><div class="eyebrow">${l.eyebrow}</div>
<h1>${total} entreprises<br>à appeler <em>maintenant</em>.</h1>
<p class="lead">${l.lead}</p>
<div class="kpis">${kpis}</div></div>
<div class="cv-bot" id="sommaire"><div class="lbl">Sommaire — cliquez pour y aller</div>${nav}<a class="toc" href="#methode"><span class="dot" style="background:#9aa3b8"></span><span class="tt">Méthode &amp; sources<small>comment cette liste a été construite</small></span><span class="n">→</span></a></div></div>
<div class="page light"><div class="ph"><div class="logo s"><span>P.</span>ProspectOS</div><a class="back" href="#sommaire">↑ Sommaire</a></div>
<h2 class="big">L’essentiel en une page</h2>
<div class="two"><div class="panel"><div class="pt">Répartition par département</div>${bars}<div class="note">${l.note_departements}</div></div>
<div class="panel"><div class="pt">Les ${l.signaux.length} signaux</div>
${l.signaux.map(g=>`<div class="sig" style="--c:${g.couleur}"><b>${g.titre}</b><span>${g.texte}</span></div>`).join('\n')}</div></div>
<div class="pt2">Par où commencer cette semaine</div><div class="tops">${top}</div>
<div class="how"><b>Comment lire chaque fiche.</b> <span class="k2">Le fait</span> ce qui a été publié, avec sa date. <span class="k2">Pourquoi maintenant</span> notre hypothèse de besoin, à valider au premier appel. <span class="k2">Votre accroche</span> une première phrase qui cite le fait — jamais d’invention. <span class="k2">Source</span> le lien vers la publication officielle.</div></div>
<div class="light">${body}</div>
<div class="page light meth-page" id="methode"><div class="ph"><div class="logo s"><span>P.</span>ProspectOS</div><a class="back" href="#sommaire">↑ Sommaire</a></div>
<h2 class="big">Méthode &amp; sources</h2>
<div class="meth">${l.methode.map(m=>`<div><b>${m.titre}</b><span>${m.texte}</span></div>`).join('\n')}</div>
<div class="rules"><div class="pt">Ce que nous avons écarté</div><ul>${l.ecartes.map(e=>`<li>${e}</li>`).join('')}</ul></div>
<div class="cta"><div><div class="ct">${l.cta.titre}</div><div class="cs">${l.cta.texte}</div></div><a href="${l.cta.lien}">${l.cta.libelle}</a></div>
<p class="legal">${l.mention_legale}</p></div>
</body></html>`;
}
// The import file of the follow-up space: the delivery header and, in the document's order (fiche 1, 2, 3…), each card
// with the same fields and labels — plus the SIREN, kept for the follow-up and the CSV.
export type ImportFile={header:{prepared_for:string;eyebrow:string;lead:string;title_count:number};
 sections:{key:string;title:string;subtitle:string;source:string;color:string;badge:string}[];
 items:{siren:string;name:string;city:string;department:string;event_date:string;event_label:string;badge:string;chips:string[];fact:string;why_now:string;hook:string;
  source_url:string;source_label:string;section_key:string}[]};
const plain=(s:string)=>s.replace(/&amp;/g,'&');
export function toImport(l:Livraison):ImportFile{
 return {header:{prepared_for:l.client,eyebrow:plain(l.eyebrow),lead:plain(l.lead),title_count:l.sections.reduce((n,s)=>n+s.fiches.length,0)},
  sections:l.sections.map(s=>({key:s.cle,title:plain(s.titre),subtitle:plain(s.sous_titre),source:plain(s.source),color:s.couleur,badge:s.badge})),
  items:l.sections.flatMap(s=>s.fiches.map(f=>({siren:f.siren,name:f.nom,city:f.ville,department:f.dep,event_date:dateIso(f.date),event_label:f.date,badge:s.badge,
   chips:f.puces??[],fact:f.fait,why_now:f.pourquoi,hook:f.accroche,source_url:f.url,source_label:plain(s.source),section_key:s.cle})))};
}
