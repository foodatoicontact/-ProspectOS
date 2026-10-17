'use client';
// Clair / Sombre / Système — the control UI-2 puts in the account menu. Nothing is pressed until the provider has read
// the stored preference (first client render = server render, no hydration mismatch).
import {useTheme} from './ThemeProvider.tsx';
import {Chip,ChipGroup} from './primitives.tsx';
import {THEME_PREFERENCES,type ThemePreference} from './theme.ts';
import type {IconName} from './icons.ts';
import type {Locale} from '../../i18n/locale.ts';

const LABEL:Record<Locale,Record<ThemePreference,string>&{group:string}>={
 fr:{light:'Clair',dark:'Sombre',system:'Système',group:'Thème de l’interface'},
 en:{light:'Light',dark:'Dark',system:'System',group:'Interface theme'},
};
const ICON:Record<ThemePreference,IconName>={light:'sun',dark:'moon',system:'system'};

export function ThemeSwitcher({locale='fr'}:{locale?:Locale}){
 const {preference,setPreference}=useTheme();
 return <ChipGroup label={LABEL[locale].group} variant="segmented">
  {THEME_PREFERENCES.map(p=><Chip key={p} icon={ICON[p]} pressed={preference===p} onPressedChange={()=>setPreference(p)}>{LABEL[locale][p]}</Chip>)}
 </ChipGroup>;
}
