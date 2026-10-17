'use client';
// UI-1 Preview page (/ui-v2, flag UI_V2_ENABLED): every foundation, in both themes, with neutral sample content.
// It is a test bench for the primitives, not a product screen: no API call, no data, no analytics.
import {useId,useState,type ReactNode} from 'react';
import {ThemeProvider,useTheme} from './ThemeProvider.tsx';
import {ThemeSwitcher} from './ThemeSwitcher.tsx';
import {Button,Chip,ChipGroup,Icon,StatusBadge} from './primitives.tsx';
import {ContextDrawer,ContextPanel,Sheet} from './panels.tsx';
import {ICON_NAMES} from './icons.ts';
import {STATUS_META,type UiStatus} from './status.ts';
import {light} from './tokens.ts';

const STATUSES=Object.keys(STATUS_META) as UiStatus[];
const SWATCH_GROUPS:{title:string;keys:string[]}[]=[
 {title:'Fonds et surfaces',keys:['bg','surface-card','surface-inset','surface-muted','glass-solid']},
 {title:'Texte',keys:['text-1','text-2','text-3']},
 {title:'Rôles',keys:['accent','ai','signal','signal-dot']},
 {title:'Statuts',keys:Object.keys(light.colors).filter(k=>k.startsWith('status-')&&k.endsWith('-dot'))},
];
type Filter='contact'|'verify'|'watch'|null;

function Section({title,children,note}:{title:string;children:ReactNode;note?:string}){
 const id=useId();
 return <section className="pos-gal__section pos-card" aria-labelledby={id}>
  <h2 id={id} className="pos-gal__h2">{title}</h2>
  {note&&<p className="pos-gal__note">{note}</p>}
  {children}
 </section>;
}

function SignalSample(){
 return <div>
  <p className="pos-gal__signal"><span className="pos-sigdot" aria-hidden="true"/><span className="pos-gal__signal-type"><span className="pos-visually-hidden">Signal : </span>Nouvelle implantation</span></p>
  <p className="pos-gal__signal-place">Ville exemple <span>· il y a 6 jours</span></p>
 </div>;
}

function Gallery(){
 const {resolved,preference}=useTheme();
 const [filter,setFilter]=useState<Filter>(null);
 const [sheet,setSheet]=useState(false);
 const [drawer,setDrawer]=useState(false);
 const [adaptive,setAdaptive]=useState(false);
 const [loading,setLoading]=useState(false);
 const toggle=(f:Exclude<Filter,null>)=>(on:boolean)=>setFilter(on?f:null);
 const startLoading=()=>{setLoading(true);window.setTimeout(()=>setLoading(false),1600)};
 const panelBody=<>
  <SignalSample/>
  <p className="pos-gal__text">Correspond à votre cible sur les critères déjà vérifiés. <span className="pos-gal__muted">3 critères à documenter.</span></p>
  <ul className="pos-gal__list">
   <li><StatusBadge status="verified"/> Critère vérifié par une source</li>
   <li><StatusBadge status="declared"/> Information déclarée par vous</li>
   <li><StatusBadge status="verify"/> Critère encore à documenter</li>
  </ul>
 </>;

 return <div className="pos-gal">
  <header className="pos-gal__top pos-glass">
   <span className="pos-gal__mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 19V5h5a4 4 0 0 1 0 8H8"/><circle cx="17.5" cy="17.5" r="1.6"/></svg></span>
   <div className="pos-gal__brand"><strong>ProspectOS</strong><span>Fondations UI v2 · Preview interne</span></div>
   <ThemeSwitcher/>
  </header>

  <main className="pos-gal__main">
   <div className="pos-gal__intro">
    <h1 className="pos-gal__h1">Fondations</h1>
    <p className="pos-gal__note" role="status">Thème choisi : {preference??'…'} · appliqué : {resolved??'…'}. Aucune donnée, aucun appel réseau : banc d’essai des primitives UI-1.</p>
   </div>

   <Section title="Couleurs sémantiques" note="Chaque pastille lit un token CSS ; aucune valeur n’est écrite dans les composants.">
    {SWATCH_GROUPS.map(g=><div key={g.title} className="pos-gal__swgroup">
     <h3 className="pos-gal__h3">{g.title}</h3>
     <div className="pos-gal__swatches">{g.keys.map(k=><div key={k} className="pos-gal__swatch"><span style={{background:`var(--pos-${k})`}}/><code>{k}</code></div>)}</div>
    </div>)}
   </Section>

   <Section title="Typographie">
    <p className="pos-gal__type-4xl">Aujourd’hui</p>
    <p className="pos-gal__type-xl">Titre de carte</p>
    <p className="pos-gal__text">Texte courant — Correspond à votre cible sur les critères déjà vérifiés.</p>
    <p className="pos-gal__muted">Texte secondaire · il y a 6 jours</p>
   </Section>

   <Section title="Button" note="Une seule action principale par décision. Cible tactile ≥ 44 px pour toutes les tailles.">
    <div className="pos-gal__row">
     <Button variant="primary" iconEnd="arrow-right">Compléter les informations</Button>
     <Button variant="secondary">Action secondaire</Button>
     <Button variant="quiet" iconEnd="chevron-right">Voir pourquoi</Button>
     <Button variant="danger">Exclure</Button>
    </div>
    <div className="pos-gal__row">
     <Button variant="primary" size="sm">Petit</Button>
     <Button variant="primary" size="md">Moyen</Button>
     <Button variant="primary" size="lg">Grand</Button>
     <Button variant="secondary" loading={loading} onClick={startLoading}>{loading?'Enregistrement…':'Simuler un chargement'}</Button>
     <Button variant="secondary" disabled>Indisponible</Button>
    </div>
   </Section>

   <Section title="StatusBadge" note="Le statut n’est jamais porté par la couleur seule : libellé et icône. « Déclaré par vous » n’est jamais « Vérifié ».">
    <div className="pos-gal__row">{STATUSES.map(s=><StatusBadge key={s} status={s}/>)}</div>
   </Section>

   <Section title="Chip" note="Filtres à bascule (aria-pressed). Le résumé tient sur une ligne et défile en lui-même à 320 px.">
    <ChipGroup label="Filtrer les recommandations" variant="segmented">
     <Chip tone="contact" count={0} pressed={filter==='contact'} onPressedChange={toggle('contact')}>à contacter</Chip>
     <Chip tone="verify" count={3} pressed={filter==='verify'} onPressedChange={toggle('verify')}>à vérifier</Chip>
     <Chip tone="watch" count={0} pressed={filter==='watch'} onPressedChange={toggle('watch')}>en veille</Chip>
    </ChipGroup>
    <p className="pos-gal__muted">Filtre actif : {filter??'aucun'}</p>
   </Section>

   <Section title="Signal" note="Signature visuelle : point cyan + TYPE, puis lieu · âge. Pas de carte imbriquée.">
    <SignalSample/>
   </Section>

   <Section title="Icônes" note={`${ICON_NAMES.length} icônes, grille 24, trait unique. Décoratives par défaut (aria-hidden).`}>
    <ul className="pos-gal__icons">{ICON_NAMES.map(n=><li key={n}><Icon name={n} size={22}/><code>{n}</code></li>)}</ul>
   </Section>

   <Section title="Surfaces" note="Verre réservé à la navigation, au panneau et à la feuille ; cartes quasi opaques. Repli opaque sans backdrop-filter ou en transparence réduite.">
    <div className="pos-gal__surfaces">
     <div className="pos-glass pos-gal__surface">Verre</div>
     <div className="pos-card pos-gal__surface">Carte</div>
     <div className="pos-inset pos-gal__surface">Encart</div>
    </div>
   </Section>

   <Section title="Sheet · ContextDrawer" note="Feuille modale sur mobile (focus retenu, Échap, glisser vers le bas) ; panneau non modal intégré à l’espace de travail sur ordinateur (Échap, retour du focus).">
    <div className="pos-gal__row">
     <Button variant="secondary" onClick={()=>setSheet(true)}>Ouvrir la feuille</Button>
     <Button variant="secondary" onClick={()=>setDrawer(o=>!o)} aria-expanded={drawer}>{drawer?'Fermer le panneau':'Ouvrir le panneau'}</Button>
     <Button variant="quiet" iconEnd="chevron-right" onClick={()=>setAdaptive(true)}>Voir pourquoi (adaptatif)</Button>
    </div>
    <div className="pos-gal__workspace pos-glass">
     <div className="pos-gal__workspace-main">
      <p className="pos-gal__muted">Espace de travail</p>
      <div className="pos-card pos-gal__minicard"><strong>Entreprise exemple</strong><StatusBadge status="verify"/></div>
     </div>
     <ContextDrawer open={drawer} onClose={()=>setDrawer(false)} title="Pourquoi cette recommandation ?">{panelBody}</ContextDrawer>
    </div>
   </Section>
  </main>

  <Sheet open={sheet} onClose={()=>setSheet(false)} title="Que manque-t-il pour décider ?"
   footer={<Button variant="primary" fullWidth onClick={()=>setSheet(false)}>Terminer</Button>}>{panelBody}</Sheet>
  <ContextPanel open={adaptive} onClose={()=>setAdaptive(false)} title="Pourquoi cette recommandation ?">{panelBody}</ContextPanel>
 </div>;
}

export function FoundationsGallery(){
 return <ThemeProvider className="pos-canvas"><Gallery/></ThemeProvider>;
}
