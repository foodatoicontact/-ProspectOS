// Company-creation barometer pages (/creations-entreprises and /creations-entreprises/<department>): the monthly BODACC
// totals of src/domain/company-creations.ts rendered inside the standard public SEO article (PublicSeoPage), so header,
// footer, FAQ, structured data and call to action are the site's own. Server component, no client JavaScript: every number
// is in the HTML, the chart is plain markup with a text equivalent (table) for screen readers and search engines.
import Link from 'next/link';
import type {Metadata} from 'next';
import {SITE_URL,socialImage,type SeoPage} from '../domain/seo';
import {ACTIVITY_RULES,BODACC_LICENSE,BODACC_PUBLIC_PAGE,CREATIONS_DEPARTMENTS,CREATIONS_HUB,MIN_COMMUNE_NOTICES,creationsPath,monthLabel,percentChange,shortMonthLabel,
 type CreationsDepartment,type DepartmentCreations,type RegionRow} from '../domain/company-creations';

const nf=new Intl.NumberFormat('fr-FR');
const n=(v:number)=>nf.format(v);
// French typography: a narrow no-break space before % and :, never "0 %" for a share that exists.
const pct=(v:number)=>v>0&&v<.005?'<1\u202f%':`${Math.round(v*100)}\u202f%`;
const signed=(v:number|null)=>v===null?'—':`${v>0?'+':v<0?'−':''}${Math.abs(v)}\u202f%`;
const RELATED=['prospection-b2b','prospection-restaurants','qualifier-un-prospect-b2b'];

export function creationsMetadata(page:SeoPage):Metadata{
 const url=`${SITE_URL}/${page.slug}`;
 return {title:{absolute:page.title},description:page.description,alternates:{canonical:url},
  openGraph:{title:page.title,description:page.description,url,type:'article',locale:'fr_FR',siteName:'ProspectOS',images:[socialImage],modifiedTime:page.updated},
  twitter:{card:'summary_large_image',title:page.title,description:page.description,images:[socialImage]}};
}
const titled=(base:string)=>`${base} | ProspectOS`.length<=75?`${base} | ProspectOS`:base;

const METHOD_BLOCKS:SeoPage['sections'][number]['blocks']=[
 {type:'p',text:'Les chiffres comptent les annonces de la famille « Créations » publiées au BODACC (Bulletin officiel des annonces civiles et commerciales, édité par la DILA), lues dans ses données ouvertes sous Licence Ouverte 2.0. Une annonce correspond à une immatriculation au registre du commerce et des sociétés (RCS) à la suite d’une création. Le mois retenu est celui de la publication, en général une à deux semaines après l’immatriculation.'},
 {type:'p',text:'Le BODACC ne couvre que le RCS : les sociétés et les commerçants, y compris les micro-entrepreneurs commerçants. Les artisans qui ne sont pas inscrits au RCS, les professions libérales et les associations n’y figurent pas. Ces chiffres ne sont donc pas le total officiel des créations d’entreprises publié par l’INSEE : ils mesurent les nouvelles entreprises commerciales, mois après mois.'},
 {type:'p',text:'La répartition par activité est indicative. Chaque annonce est classée automatiquement d’après les mots de l’activité déclarée de son premier établissement, dans la première catégorie qui correspond, ou dans « Autres activités ». Ce n’est pas le code NAF officiel, attribué plus tard par l’INSEE.'},
 {type:'ul',items:ACTIVITY_RULES.map(r=>`${r.label} : ${r.words}.`)},
 {type:'p',text:`Aucune entreprise n’est nommée ici : la page ne publie que des totaux. Une commune n’apparaît que si elle compte au moins ${MIN_COMMUNE_NOTICES} annonces dans le mois. La page se met à jour seule chaque jour, et le mois affiché est le dernier mois complet.`},
];

const PROSPECTING_BLOCKS=(where:string):SeoPage['sections'][number]['blocks']=>[
 {type:'p',text:`Une entreprise qui vient de se créer ${where} a presque tout à mettre en place : site internet, comptabilité, assurance, banque, locaux, outils, fournisseurs. C’est le moment où elle choisit ses prestataires, avant que ses habitudes ne soient prises.`},
 {type:'ul',items:[
  'Choisissez une activité plutôt que tout le volume : une agence web ne vise pas les mêmes créations qu’un expert-comptable ou un installateur de cuisines professionnelles.',
  'Vérifiez chaque entreprise sur sa fiche officielle (SIREN, adresse, activité) avant de la contacter : une annonce donne le point de départ, pas la preuve que l’entreprise correspond à votre cible.',
  'Pour un entrepreneur individuel, l’entreprise et la personne se confondent : contactez-le sur son adresse professionnelle, présentez-vous clairement et proposez toujours de ne plus le recontacter.',
  'Préparez un message qui cite un fait précis et vérifiable (l’activité déclarée, l’ouverture d’un local) plutôt qu’un argumentaire générique.',
 ]},
 {type:'p',text:'ProspectOS cherche les entreprises du registre public par secteur (codes NAF), zone et effectif, rattache chaque observation à sa source et vous laisse confirmer chaque fait avant de [prioriser votre liste de prospects](/prioriser-liste-prospects). Pour les entreprises que vous suivez, il signale les annonces BODACC (nouvel établissement, changement de dirigeant, transfert de siège).'},
];

export function departmentSeoPage(d:DepartmentCreations):SeoPage{
 const dep=d.department,month=monthLabel(d.month);
 const change=percentChange(d.total,d.previous?.count),yoy=percentChange(d.total,d.lastYear?.count);
 const top=d.activities.find(a=>a.key!=='OTHER'&&a.key!=='NO_ACTIVITY');
 const capital=d.communes[0];
 return {
  slug:creationsPath(dep),navLabel:`Créations ${dep.in}`,updated:d.source.retrievedAt.slice(0,10),
  keywords:{primary:`créations d'entreprises ${dep.name}`,secondary:[`nouvelles entreprises ${dep.prefecture}`,`entreprises créées récemment ${dep.name}`]},
  title:titled(`Créations d’entreprises ${dep.in} (${dep.code})\u202f: ${month}`),
  description:`${n(d.total)} créations d’entreprises publiées au BODACC ${dep.in} en ${month} : évolution sur 13 mois, activités et communes. Totaux mis à jour chaque mois, sans aucun nom.`,
  eyebrow:`Baromètre des créations · ${dep.name} (${dep.code})`,
  h1:`Créations d’entreprises ${dep.in}\u202f: ${month}`,
  intro:`${n(d.total)} annonces de création d’entreprise ont été publiées au BODACC ${dep.in} en ${month}`
   +(change!==null?`, soit ${signed(change)} par rapport au mois précédent`:'')
   +(yoy!==null?` et ${signed(yoy)} sur un an`:'')+'.'
   +(top?` La première activité est « ${top.label.toLowerCase()} » (${pct(top.share)} des annonces).`:'')
   +(capital?` ${capital.label} en concentre ${pct(capital.share)}.`:''),
  sections:[
   {h2:`Prospecter les entreprises qui viennent de se créer ${dep.in}`,blocks:PROSPECTING_BLOCKS(dep.in)},
   {h2:'Méthode et sources',blocks:METHOD_BLOCKS},
  ],
  faq:[
   {q:`Combien d’entreprises ont été créées ${dep.in} en ${month} ?`,a:`${n(d.total)} annonces de création ont été publiées au BODACC ${dep.in} en ${month} : ${n(d.kinds.company+d.kinds.companyNoActivity)} sociétés et ${n(d.kinds.individual)} entrepreneurs individuels inscrits au registre du commerce. Les artisans hors RCS et les professions libérales ne sont pas comptés.`},
   {q:`Où trouver la liste des nouvelles entreprises ${dep.in} ?`,a:'Les annonces nominatives sont publiques sur bodacc.fr, et chaque entreprise a sa fiche officielle sur l’Annuaire des entreprises (annuaire-entreprises.data.gouv.fr). Cette page ne publie que des totaux. Pour constituer une liste ciblée et vérifiée, ProspectOS cherche dans le registre public par secteur et par zone : voir [la prospection B2B fondée sur des preuves](/prospection-b2b).'},
   {q:'Pourquoi ces chiffres diffèrent-ils de ceux de l’INSEE ?',a:'L’INSEE compte toutes les créations, y compris les micro-entrepreneurs non commerçants, les artisans et les professions libérales. Le BODACC ne publie que les immatriculations au registre du commerce et des sociétés, datées de leur publication. Les deux séries ne se comparent pas directement.'},
   {q:'Les activités sont-elles des codes NAF officiels ?',a:'Non. Elles sont classées par mots-clés d’après l’activité déclarée dans l’annonce, selon les règles listées dans la méthode. C’est une répartition indicative, utile pour repérer les secteurs qui créent le plus.'},
  ],
  cta:{title:'Trouvez et vérifiez vos prochains clients',text:`Cherchez ${dep.in} les entreprises de votre cible dans le registre public, avec une source pour chaque fait.`,href:'/',label:'Explorer la démonstration'},
  related:RELATED,
 };
}

export function hubSeoPage(region:{month:string;total:number;rows:RegionRow[]}|null,updated:string):SeoPage{
 const month=region?monthLabel(region.month):null;
 const first=region?.rows[0];
 return {
  slug:CREATIONS_HUB,navLabel:'Créations d’entreprises en Occitanie',updated,
  keywords:{primary:'créations d’entreprises Occitanie',secondary:['nouvelles entreprises Toulouse','créations d’entreprises par département']},
  title:titled(month?`Créations d’entreprises en Occitanie\u202f: ${month}`:'Créations d’entreprises en Occitanie par département'),
  description:region&&month?`${n(region.total)} créations d’entreprises publiées au BODACC en Occitanie en ${month}, département par département. Baromètre mensuel tiré du registre officiel.`
   :'Le baromètre mensuel des créations d’entreprises en Occitanie, département par département, tiré des annonces officielles du BODACC. Totaux uniquement, sans aucun nom.',
  eyebrow:'Baromètre des créations d’entreprises',
  h1:'Créations d’entreprises en Occitanie, département par département',
  intro:region&&month&&first?`${n(region.total)} annonces de création d’entreprise ont été publiées au BODACC dans les 13 départements d’Occitanie en ${month}. Le département le plus actif est ${first.department.name} (${first.department.code}), avec ${n(first.count)} annonces. Choisissez un département pour voir l’évolution sur 13 mois, les activités et les communes.`
   :'Chaque mois, le nombre d’annonces de création d’entreprise publiées au BODACC dans les 13 départements d’Occitanie. Choisissez un département pour voir l’évolution sur 13 mois, les activités et les communes.',
  sections:[{h2:'Méthode et sources',blocks:METHOD_BLOCKS}],
  faq:[
   {q:'Quel département d’Occitanie crée le plus d’entreprises ?',a:region&&month&&first?`En ${month}, le département qui compte le plus d’annonces de création au BODACC est ${first.department.name} (${first.department.code}), avec ${n(first.count)} annonces.`:'La Haute-Garonne et l’Hérault, autour de Toulouse et de Montpellier, publient chaque mois le plus d’annonces de création.'},
   {q:'D’où viennent ces chiffres ?',a:'Des annonces de la famille « Créations » du BODACC, publiées par la DILA en données ouvertes sous Licence Ouverte 2.0, comptées par département et par mois de publication.'},
  ],
  cta:{title:'Trouvez et vérifiez vos prochains clients',text:'Cherchez dans le registre public les entreprises de votre cible, avec une source pour chaque fait.',href:'/',label:'Explorer la démonstration'},
  related:RELATED,
 };
}

// ── Data blocks (rendered right after the hero) ─────────────────────────────────────────────────────────────────────────
const CSS=`
.pos-creations{display:grid;gap:var(--pos-space-5,20px)}
.pos-creations__kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:var(--pos-space-3,12px);margin:0;padding:0;list-style:none}
.pos-creations__kpi{padding:var(--pos-space-4,16px);background:var(--pos-surface-card);border:1px solid var(--pos-border);border-radius:var(--pos-radius-lg,12px)}
.pos-creations__kpi dt{font-size:var(--pos-text-sm,14px);color:var(--pos-text-3)}
.pos-creations__kpi dd{margin:4px 0 0;font-family:var(--pos-font-display);font-size:clamp(24px,5vw,32px);font-weight:var(--pos-weight-heavy,800);letter-spacing:-.03em;color:var(--pos-text-1)}
.pos-creations__kpi dd small{display:block;font-family:inherit;font-size:var(--pos-text-sm,14px);font-weight:400;letter-spacing:0;color:var(--pos-text-3)}
.pos-creations__card{padding:var(--pos-space-5,20px);background:var(--pos-surface-card);border:1px solid var(--pos-border);border-radius:var(--pos-radius-xl,16px);box-shadow:var(--pos-shadow-card)}
.pos-creations__card h2{margin:0 0 var(--pos-space-1,4px);font-size:var(--pos-text-xl,20px);font-weight:var(--pos-weight-heavy,800);letter-spacing:-.02em;color:var(--pos-text-1)}
.pos-creations__card p.pos-creations__sub{margin:0 0 var(--pos-space-4,16px);font-size:var(--pos-text-sm,14px);color:var(--pos-text-3)}
.pos-creations__grid{display:grid;gap:var(--pos-space-5,20px);grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))}
.pos-creations__chart{display:grid;grid-template-columns:repeat(13,minmax(0,1fr));gap:2px;align-items:end;height:180px;padding-top:22px;border-bottom:1px solid var(--pos-border)}
.pos-creations__bar{position:relative;display:flex;align-items:flex-end;height:100%}
.pos-creations__bar span{display:block;width:100%;max-width:28px;margin:0 auto;border-radius:4px 4px 0 0;background:var(--pos-accent-soft);min-height:2px}
.pos-creations__bar--current span{background:var(--pos-accent)}
.pos-creations__bar:hover span{background:var(--pos-accent-hover,var(--pos-accent))}
.pos-creations__bar b{position:absolute;left:50%;transform:translateX(-50%);font-size:var(--pos-text-xs,12px);font-weight:var(--pos-weight-semibold,600);color:var(--pos-text-1);white-space:nowrap}
.pos-creations__axis{display:grid;grid-template-columns:repeat(13,minmax(0,1fr));gap:2px;margin-top:6px;font-size:11px;color:var(--pos-text-3);text-align:center}
.pos-creations__table{width:100%;border-collapse:collapse;font-size:var(--pos-text-sm,14px)}
.pos-creations__table th,.pos-creations__table td{padding:8px 4px;border-bottom:1px solid var(--pos-border);text-align:left;vertical-align:top}
.pos-creations__table th{font-weight:var(--pos-weight-semibold,600);color:var(--pos-text-3)}
.pos-creations__table td{color:var(--pos-text-1)}
.pos-creations__table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pos-creations__share{display:block;height:4px;margin-top:4px;border-radius:2px;background:var(--pos-accent-soft)}
.pos-creations__share i{display:block;height:100%;border-radius:2px;background:var(--pos-accent)}
.pos-creations__links{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.pos-ui.pos-public .pos-creations__links a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid var(--pos-border);border-radius:var(--pos-radius-pill,999px);font-size:var(--pos-text-sm,14px);color:var(--pos-text-1);text-decoration:none}
.pos-ui.pos-public .pos-creations__links a:hover{border-color:var(--pos-accent)}
.pos-ui.pos-public .pos-creations__links a[aria-current]{background:var(--pos-accent);border-color:var(--pos-accent);color:var(--pos-on-accent);font-weight:var(--pos-weight-semibold,600)}
.pos-creations__source{margin:0;font-size:var(--pos-text-xs,12px);color:var(--pos-text-3)}
.pos-creations__source a{color:inherit;text-decoration:underline}
.pos-creations details summary{cursor:pointer;font-size:var(--pos-text-sm,14px);color:var(--pos-text-2);margin-top:var(--pos-space-3,12px)}
.pos-creations__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (forced-colors:active){.pos-creations__bar span,.pos-creations__share i{background:CanvasText}.pos-creations__bar--current span{background:Highlight}}
`;
const Styles=()=><style href="pos-creations" precedence="default">{CSS}</style>;

function datasetJsonLd(name:string,description:string,url:string,updated:string,spatial:string){
 return JSON.stringify({'@context':'https://schema.org','@type':'Dataset',name,description,url,inLanguage:'fr-FR',dateModified:updated,
  spatialCoverage:{'@type':'Place',name:spatial},license:BODACC_LICENSE,isAccessibleForFree:true,
  creator:{'@type':'Organization',name:'ProspectOS',url:SITE_URL},
  isBasedOn:{'@type':'Dataset',name:'BODACC — annonces commerciales',url:BODACC_PUBLIC_PAGE,publisher:{'@type':'GovernmentOrganization',name:'Direction de l’information légale et administrative (DILA)'}}}).replace(/</g,'\\u003c');
}

export function DepartmentLinks({current}:{current?:CreationsDepartment}){
 return <nav aria-label="Créations d’entreprises par département"><ul className="pos-creations__links">
  {CREATIONS_DEPARTMENTS.map(d=><li key={d.code}><Link href={`/${creationsPath(d)}`} aria-current={d.code===current?.code?'page':undefined}>{d.name} ({d.code})</Link></li>)}
 </ul></nav>;
}

function Trend({d}:{d:DepartmentCreations}){
 const max=Math.max(1,...d.trend.map(t=>t.count));
 return <section className="pos-creations__card" aria-labelledby="creations-trend">
  <h2 id="creations-trend">Annonces de création publiées chaque mois</h2>
  <p className="pos-creations__sub">Les 13 derniers mois complets, {d.department.name}.</p>
  <div className="pos-creations__chart" aria-hidden="true">
   {d.trend.map((t,i)=>{const last=i===d.trend.length-1,peak=t.count===max;
    return <div key={t.month} className={`pos-creations__bar${last?' pos-creations__bar--current':''}`} title={`${monthLabel(t.month)} : ${n(t.count)} annonces`}>
     <span style={{height:`${Math.round(t.count/max*100)}%`}}/>
     {(last||peak)&&<b style={{bottom:`calc(${Math.round(t.count/max*100)}% + 4px)`}}>{n(t.count)}</b>}
    </div>})}
  </div>
  <div className="pos-creations__axis" aria-hidden="true">{d.trend.map(t=><span key={t.month}>{shortMonthLabel(t.month)}</span>)}</div>
  <details><summary>Voir les chiffres mois par mois</summary>
   <table className="pos-creations__table"><caption className="pos-creations__sr">Annonces de création par mois, {d.department.name}</caption>
    <thead><tr><th scope="col">Mois</th><th scope="col" className="num">Annonces</th></tr></thead>
    <tbody>{d.trend.map(t=><tr key={t.month}><td>{monthLabel(t.month)}</td><td className="num">{n(t.count)}</td></tr>)}</tbody>
   </table>
  </details>
 </section>;
}

export function DepartmentCreationsBlock({d,page}:{d:DepartmentCreations;page:SeoPage}){
 const month=monthLabel(d.month);
 const companies=d.kinds.company+d.kinds.companyNoActivity;
 return <div className="pos-creations">
  <Styles/>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:datasetJsonLd(page.h1,page.description,`${SITE_URL}/${page.slug}`,page.updated,`${d.department.name}, France`)}}/>
  <dl className="pos-creations__kpis">
   <div className="pos-creations__kpi"><dt>Annonces de création, {month}</dt><dd>{n(d.total)}</dd></div>
   <div className="pos-creations__kpi"><dt>Par rapport au mois précédent</dt><dd>{signed(percentChange(d.total,d.previous?.count))}<small>{d.previous?`${n(d.previous.count)} en ${monthLabel(d.previous.month)}`:'—'}</small></dd></div>
   <div className="pos-creations__kpi"><dt>Sur un an</dt><dd>{signed(percentChange(d.total,d.lastYear?.count))}<small>{d.lastYear?`${n(d.lastYear.count)} en ${monthLabel(d.lastYear.month)}`:'—'}</small></dd></div>
   <div className="pos-creations__kpi"><dt>Part des sociétés</dt><dd>{d.total?pct(companies/d.total):'—'}<small>{n(companies)} sociétés, {n(d.kinds.individual)} entrepreneurs individuels</small></dd></div>
  </dl>
  <Trend d={d}/>
  <div className="pos-creations__grid">
   <section className="pos-creations__card" aria-labelledby="creations-activities">
    <h2 id="creations-activities">Activités</h2>
    <p className="pos-creations__sub">Répartition indicative des annonces de {month}, d’après l’activité déclarée (voir la méthode).</p>
    <table className="pos-creations__table"><thead><tr><th scope="col">Activité</th><th scope="col" className="num">Annonces</th><th scope="col" className="num">Part</th></tr></thead>
     <tbody>{d.activities.map(a=><tr key={a.key}><td>{a.label}<span className="pos-creations__share" aria-hidden="true"><i style={{width:`${Math.max(1,Math.round(a.share*100))}%`}}/></span></td><td className="num">{n(a.count)}</td><td className="num">{pct(a.share)}</td></tr>)}</tbody>
    </table>
   </section>
   <section className="pos-creations__card" aria-labelledby="creations-communes">
    <h2 id="creations-communes">Communes</h2>
    <p className="pos-creations__sub">Les communes qui comptent au moins {MIN_COMMUNE_NOTICES} annonces en {month}.</p>
    {d.communes.length?<table className="pos-creations__table"><thead><tr><th scope="col">Commune</th><th scope="col" className="num">Annonces</th><th scope="col" className="num">Part</th></tr></thead>
     <tbody>{d.communes.map(c=><tr key={c.key}><td>{c.label}</td><td className="num">{n(c.count)}</td><td className="num">{pct(c.share)}</td></tr>)}</tbody>
    </table>:<p>Aucune commune n’atteint {MIN_COMMUNE_NOTICES} annonces ce mois-ci.</p>}
    {d.communesHidden>0&&<p className="pos-creations__sub" style={{marginTop:12}}>{n(d.communesHidden)} autres communes, non détaillées.</p>}
   </section>
  </div>
  <section className="pos-creations__card" aria-labelledby="creations-departments">
   <h2 id="creations-departments">Les autres départements d’Occitanie</h2>
   <p className="pos-creations__sub"><Link href={`/${CREATIONS_HUB}`}>Comparer les 13 départements</Link></p>
   <DepartmentLinks current={d.department}/>
  </section>
  <p className="pos-creations__source">Source : <a href={BODACC_PUBLIC_PAGE} rel="noopener">BODACC</a>, DILA, données ouvertes sous <a href={BODACC_LICENSE} rel="noopener">Licence Ouverte 2.0</a>. Annonces de la famille « Créations » publiées en {month}. Totaux calculés par ProspectOS, données lues le {new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'Europe/Paris'}).format(new Date(d.source.retrievedAt))}.</p>
 </div>;
}

export function RegionCreationsBlock({region,page}:{region:{month:string;total:number;rows:RegionRow[]}|null;page:SeoPage}){
 const month=region?monthLabel(region.month):null;
 return <div className="pos-creations">
  <Styles/>
  {region&&<script type="application/ld+json" dangerouslySetInnerHTML={{__html:datasetJsonLd(page.h1,page.description,`${SITE_URL}/${page.slug}`,page.updated,'Occitanie, France')}}/>}
  {region&&month?<section className="pos-creations__card" aria-labelledby="creations-region">
   <h2 id="creations-region">Annonces de création publiées en {month}</h2>
   <p className="pos-creations__sub">{n(region.total)} annonces dans les 13 départements, comparées au mois précédent.</p>
   <table className="pos-creations__table"><thead><tr><th scope="col">Département</th><th scope="col" className="num">{month}</th><th scope="col" className="num">Évolution</th><th scope="col" className="num">Part</th></tr></thead>
    <tbody>{region.rows.map(r=><tr key={r.department.code}><td><Link href={`/${creationsPath(r.department)}`}>{r.department.name} ({r.department.code})</Link></td><td className="num">{n(r.count)}</td><td className="num">{signed(percentChange(r.count,r.previous))}</td><td className="num">{pct(r.count/region.total)}</td></tr>)}</tbody>
   </table>
  </section>:<section className="pos-creations__card"><h2>Choisissez un département</h2><DepartmentLinks/></section>}
  {region&&<section className="pos-creations__card" aria-labelledby="creations-pick"><h2 id="creations-pick">Le détail par département</h2><p className="pos-creations__sub">Évolution sur 13 mois, activités et communes.</p><DepartmentLinks/></section>}
  <p className="pos-creations__source">Source : <a href={BODACC_PUBLIC_PAGE} rel="noopener">BODACC</a>, DILA, données ouvertes sous <a href={BODACC_LICENSE} rel="noopener">Licence Ouverte 2.0</a>. Totaux calculés par ProspectOS.</p>
 </div>;
}
