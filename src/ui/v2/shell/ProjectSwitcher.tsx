'use client';
// The project list behind the "[Projet ▼]" trigger: the same projects and the same "new project" entry as the
// legacy <select>, nothing more. Rendered in a Sheet (mobile) or a Popover (desktop) by AppShell.
import {Icon} from '../primitives.tsx';
import type {Locale} from '../../../i18n/locale.ts';

export type ShellProject={id:string;name:string};
export type ProjectSwitcherProps={projects:ShellProject[];currentId:string;busy:boolean;onSelect:(id:string)=>void;onNew:()=>void};

export const PROJECT_TEXT:Record<Locale,{title:string;none:string;new:string;trigger:(name:string)=>string}>={
 fr:{title:'Projets',none:'Aucun projet',new:'Nouveau projet',trigger:n=>`Projet : ${n}. Changer de projet`},
 en:{title:'Projects',none:'No project',new:'New project',trigger:n=>`Project: ${n}. Switch project`},
};

export function ProjectList({projects,currentId,busy,onSelect,onNew,locale,onDone}:ProjectSwitcherProps&{locale:Locale;onDone:()=>void}){
 const t=PROJECT_TEXT[locale];
 return <div className="pos-projects">
  {projects.length===0&&<p className="pos-menu__note">{t.none}</p>}
  {projects.length>0&&<ul className="pos-menu__list">
   {projects.map(p=><li key={p.id}>
    <button type="button" className="pos-menu__item" disabled={busy} aria-current={p.id===currentId?'true':undefined}
     onClick={()=>{onDone();if(p.id!==currentId)onSelect(p.id)}}>
     <Icon name="project" size={18}/><span className="pos-menu__label">{p.name}</span>
     {p.id===currentId&&<Icon name="check" size={18} className="pos-menu__check"/>}
    </button>
   </li>)}
  </ul>}
  <div className="pos-menu__sep" role="presentation"/>
  <button type="button" className="pos-menu__item" disabled={busy} onClick={()=>{onDone();onNew()}}>
   <Icon name="plus" size={18}/><span className="pos-menu__label">{t.new}</span>
  </button>
 </div>;
}
