// ProspectOS 2.0 design tokens — the single source of truth for the v2 look (prototype V2, validated 2026-10).
// Three layers: a small palette (the only literal colours of the v2 UI), semantic roles per theme that reference it
// (alpha variants are derived, never typed), and theme-independent scales. tokensCss() turns them into CSS custom
// properties scoped to `.pos-ui`, so nothing outside a v2 surface can see or be affected by them.
import {alpha} from './color.ts';

export const palette={
 white:'#FFFFFF',
 ink:{950:'#0D1324',700:'#3B4560',500:'#505874'},
 mist:{50:'#F7F9FD',100:'#F3F6FB',150:'#EEF2F8',200:'#E8EDF5'},
 night:{950:'#050914',925:'#0A1020',900:'#0B1226',875:'#0D1428',850:'#111930',800:'#1A2340',750:'#1C2647'},
 frost:{100:'#E9EDF8',300:'#B3BCD2',400:'#8C96AE'},
 indigo:{800:'#3730A3',700:'#4338CA',600:'#4F46E5',500:'#6366F1',400:'#818CF8',300:'#A5B4FC'},
 violet:{700:'#6D28D9',600:'#7C3AED',500:'#8B5CF6',400:'#A78BFA'},
 cyan:{800:'#085E78',500:'#06B6D4',400:'#22D3EE',300:'#4FE0F5'},
 green:{800:'#166534',600:'#16A34A',400:'#4ADE80'},
 amber:{900:'#8A3C0B',600:'#D97706',500:'#F59E0B',400:'#FBBF24',300:'#FCD34D',50:'#FDF0D3'},
 slate:{600:'#475569',500:'#64748B',400:'#94A3B8',300:'#AEB9CC'},
 rose:{700:'#BE123C',600:'#E11D48',400:'#FB7185'},
 black:'#000000',
} as const;

export type ThemeName='light'|'dark';
// The colour roles a component may use. Status roles always come as fg (text/icon), bg (fill) and dot (marker).
export const STATUS_TONES=['contact','verify','engage','watch','excluded','verified','declared'] as const;
export type StatusTone=typeof STATUS_TONES[number];
type StatusRoles={[K in StatusTone as `status-${K}-fg`|`status-${K}-bg`|`status-${K}-dot`]:string};
export type ColorRoles={
 bg:string;'surface-shell':string;'surface-drawer':string;'surface-sheet':string;'surface-card':string;'surface-inset':string;'surface-muted':string;
 glass:string;'glass-solid':string;'glass-border':string;
 border:string;'border-strong':string;hairline:string;
 'text-1':string;'text-2':string;'text-3':string;
 accent:string;'accent-hover':string;'on-accent':string;'accent-soft':string;'accent-ring':string;
 ai:string;signal:string;'signal-dot':string;'signal-ring':string;
 scrim:string;'toast-bg':string;'toast-fg':string;
}&StatusRoles;
// Non-colour, theme-dependent values (shadows, gradients, halos).
export type EffectRoles={'glass-highlight':string;'shadow-card':string;'shadow-float':string;'shadow-sheet':string;'shadow-accent':string;
 'signal-glow':string;'mark-bg':string;'mark-fg':string;'mark-shadow':string;halo:string};
export type Theme={name:ThemeName;colors:ColorRoles;effects:EffectRoles;
 // Contrast-test inputs: the halo tints at their strongest, used to measure text on glass "on the worst background".
 haloTints:string[]};

type Halo={color:string;a:number;at:string;size:string};
const haloCss=(hs:Halo[])=>hs.map(h=>`radial-gradient(${h.size} at ${h.at}, ${alpha(h.color,h.a)}, transparent 70%)`).join(', ');
// Light (UI-1 adjustment 1): a lighter, cooler base than the prototype; the colour comes from the halos, not a lavender fill.
const LIGHT_HALOS:Halo[]=[
 {color:palette.indigo[500],a:0.26,at:'8% 0%',size:'45% 55%'},
 {color:palette.violet[500],a:0.18,at:'92% 6%',size:'40% 45%'},
 {color:palette.cyan[500],a:0.18,at:'70% 105%',size:'45% 50%'},
 {color:palette.indigo[500],a:0.12,at:'0% 100%',size:'35% 40%'},
];
const DARK_HALOS:Halo[]=[
 {color:palette.indigo[500],a:0.30,at:'8% 0%',size:'45% 55%'},
 {color:palette.violet[500],a:0.22,at:'92% 6%',size:'40% 45%'},
 {color:palette.cyan[500],a:0.15,at:'70% 105%',size:'45% 50%'},
 {color:palette.indigo[500],a:0.14,at:'0% 100%',size:'35% 40%'},
];

const {white,ink,mist,night,frost,indigo,violet,cyan,green,amber,slate,rose,black}=palette;

export const light:Theme={name:'light',
 colors:{
  bg:mist[150],
  'surface-shell':alpha(white,0.55),'surface-drawer':alpha(mist[50],0.86),'surface-sheet':alpha(mist[50],0.94),
  'surface-card':white,'surface-inset':mist[100],'surface-muted':mist[200],
  glass:alpha(mist[50],0.6),'glass-solid':mist[50],'glass-border':alpha(white,0.85),
  border:alpha(ink[950],0.08),'border-strong':alpha(ink[950],0.2),hairline:alpha(ink[950],0.08),
  'text-1':ink[950],'text-2':ink[700],'text-3':ink[500],
  accent:indigo[700],'accent-hover':indigo[800],'on-accent':white,'accent-soft':alpha(indigo[700],0.09),'accent-ring':alpha(indigo[700],0.35),
  ai:violet[700],signal:cyan[800],'signal-dot':cyan[500],'signal-ring':alpha(cyan[500],0.16),
  scrim:alpha(ink[950],0.32),'toast-bg':ink[950],'toast-fg':mist[100],
  'status-contact-fg':green[800],'status-contact-bg':alpha(green[600],0.12),'status-contact-dot':green[600],
  'status-verify-fg':amber[900],'status-verify-bg':amber[50],'status-verify-dot':amber[600],
  'status-engage-fg':indigo[700],'status-engage-bg':alpha(indigo[700],0.09),'status-engage-dot':indigo[500],
  'status-watch-fg':slate[600],'status-watch-bg':alpha(slate[500],0.12),'status-watch-dot':slate[500],
  'status-excluded-fg':rose[700],'status-excluded-bg':alpha(rose[700],0.09),'status-excluded-dot':rose[600],
  'status-verified-fg':cyan[800],'status-verified-bg':alpha(cyan[500],0.12),'status-verified-dot':cyan[500],
  'status-declared-fg':slate[600],'status-declared-bg':'transparent','status-declared-dot':slate[500],
 },
 effects:{
  'glass-highlight':`inset 0 1px 0 ${alpha(white,0.8)}`,
  'shadow-card':`0 1px 2px ${alpha(ink[950],0.05)}, 0 12px 32px -12px ${alpha(indigo[800],0.2)}`,
  'shadow-float':`0 24px 60px -24px ${alpha(indigo[800],0.3)}`,
  'shadow-sheet':`0 -12px 48px -12px ${alpha(ink[950],0.25)}`,
  'shadow-accent':`0 4px 12px -4px ${alpha(indigo[700],0.45)}`,
  'signal-glow':'0 0 0 0 transparent',
  'mark-bg':`linear-gradient(140deg, ${indigo[600]}, ${violet[700]})`,'mark-fg':white,
  'mark-shadow':`0 4px 12px -2px ${alpha(indigo[600],0.5)}`,
  halo:haloCss(LIGHT_HALOS),
 },
 haloTints:LIGHT_HALOS.map(h=>alpha(h.color,h.a)),
};

export const dark:Theme={name:'dark',
 colors:{
  bg:night[950],
  'surface-shell':alpha(night[925],0.55),'surface-drawer':alpha(night[875],0.88),'surface-sheet':alpha(night[875],0.94),
  'surface-card':night[850],'surface-inset':night[900],'surface-muted':night[800],
  glass:alpha(night[900],0.58),'glass-solid':night[900],'glass-border':alpha(white,0.07),
  border:alpha(white,0.07),'border-strong':alpha(white,0.18),hairline:alpha(white,0.07),
  'text-1':frost[100],'text-2':frost[300],'text-3':frost[400],
  accent:indigo[400],'accent-hover':indigo[300],'on-accent':night[925],'accent-soft':alpha(indigo[400],0.14),'accent-ring':alpha(indigo[400],0.45),
  ai:violet[400],signal:cyan[300],'signal-dot':cyan[400],'signal-ring':alpha(cyan[400],0.14),
  scrim:alpha(night[950],0.6),'toast-bg':frost[100],'toast-fg':night[925],
  'status-contact-fg':green[400],'status-contact-bg':alpha(green[400],0.14),'status-contact-dot':green[400],
  'status-verify-fg':amber[300],'status-verify-bg':alpha(amber[400],0.13),'status-verify-dot':amber[500],
  'status-engage-fg':indigo[300],'status-engage-bg':alpha(indigo[400],0.14),'status-engage-dot':indigo[400],
  'status-watch-fg':slate[400],'status-watch-bg':alpha(slate[400],0.14),'status-watch-dot':slate[400],
  'status-excluded-fg':rose[400],'status-excluded-bg':alpha(rose[400],0.14),'status-excluded-dot':rose[400],
  'status-verified-fg':cyan[300],'status-verified-bg':alpha(cyan[400],0.12),'status-verified-dot':cyan[400],
  'status-declared-fg':slate[300],'status-declared-bg':'transparent','status-declared-dot':slate[400],
 },
 effects:{
  'glass-highlight':`inset 0 1px 0 ${alpha(white,0.05)}`,
  'shadow-card':`inset 0 1px 0 ${alpha(white,0.05)}, 0 18px 40px -14px ${alpha(black,0.7)}`,
  'shadow-float':`0 30px 70px -24px ${alpha(black,0.8)}`,
  'shadow-sheet':`0 -16px 60px -12px ${alpha(black,0.7)}`,
  'shadow-accent':`0 4px 16px -4px ${alpha(indigo[400],0.45)}`,
  'signal-glow':`0 0 12px ${alpha(cyan[400],0.55)}`,
  'mark-bg':`linear-gradient(140deg, ${indigo[500]}, ${violet[600]})`,'mark-fg':white,
  'mark-shadow':`0 4px 14px -2px ${alpha(indigo[500],0.55)}`,
  halo:haloCss(DARK_HALOS),
 },
 haloTints:DARK_HALOS.map(h=>alpha(h.color,h.a)),
};

export const THEMES:Record<ThemeName,Theme>={light,dark};

// Theme-independent scales (ZF-UI0 DESIGN_TOKENS).
export const scales={
 space:{1:'4px',2:'8px',3:'12px',4:'16px',5:'20px',6:'24px',7:'32px',8:'40px',9:'48px',10:'64px'},
 radius:{sm:'8px',md:'12px',lg:'16px',xl:'20px',sheet:'24px',shell:'26px',pill:'999px'},
 font:{ui:"'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",display:"'Manrope', 'DM Sans', system-ui, sans-serif",
  mono:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"},
 text:{xs:'12px',sm:'13px',base:'14px',md:'15px',lg:'17px',xl:'19px','2xl':'21px','3xl':'26px','4xl':'32px'},
 leading:{tight:'1.2',snug:'1.4',normal:'1.5'},
 weight:{regular:'400',medium:'500',semibold:'600',bold:'700',heavy:'800'},
 dur:{fast:'120ms',base:'200ms',slow:'320ms'},
 ease:{standard:'cubic-bezier(.2,0,0,1)',emphasized:'cubic-bezier(.3,0,0,1.2)',exit:'cubic-bezier(.4,0,1,1)'},
 blur:{glass:'20px','glass-compact':'12px'},
 size:{target:'44px','reading':'760px','drawer':'448px','sidenav':'224px'},
 z:{drawer:'20',popover:'30',sheet:'50',toast:'60'},
} as const;

const decl=(prefix:string,obj:Record<string,string>)=>Object.entries(obj).map(([k,v])=>`--pos-${prefix}${k}:${v};`).join('');
export function themeDeclarations(t:Theme):string{
 return decl('',t.colors as unknown as Record<string,string>)+decl('',t.effects as unknown as Record<string,string>)+`color-scheme:${t.name};`;
}
export function scaleDeclarations():string{
 return Object.entries(scales).map(([group,vals])=>decl(`${group}-`,vals as Record<string,string>)).join('');
}
// The whole token stylesheet. Light is the base; dark applies when the theme script (theme.ts) resolved dark, or — when
// scripts never ran — when the device prefers dark (the default preference is "system").
export function tokensCss():string{
 return [
  `.pos-ui{${scaleDeclarations()}${themeDeclarations(light)}}`,
  `.pos-ui[data-theme="dark"]{${themeDeclarations(dark)}}`,
  `@media (prefers-color-scheme: dark){.pos-ui:not([data-theme]){${themeDeclarations(dark)}}}`,
  // The document behind a v2 surface (overscroll, scrollbars) follows the resolved theme without touching <html>.
  `html:has(.pos-ui[data-theme="dark"]){color-scheme:dark;background:${dark.colors.bg}}`,
  `html:has(.pos-ui[data-theme="light"]){color-scheme:light;background:${light.colors.bg}}`,
 ].join('\n');
}
