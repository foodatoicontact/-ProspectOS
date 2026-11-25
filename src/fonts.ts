// Polices auto-hébergées (audit externe du 25 nov. 2026) : DM Sans, Manrope et Inter passent par next/font/google, qui les
// télécharge AU BUILD et les sert depuis le site lui-même — le navigateur du visiteur n'appelle plus jamais les
// serveurs de Google Fonts (aucune adresse IP transmise à Google). Ce sont des polices variables : toutes
// les graisses utilisées jusqu'ici (DM Sans 400–700, Manrope 400–800, Inter 400–800 et l'italique 400) sont couvertes.
// Chaque police est exposée par une variable CSS (--font-dm-sans, --font-manrope, --font-inter), déclarée sur :root par le
// layout racine ; les feuilles de style l'utilisent avec le nom d'origine en repli : var(--font-dm-sans,'DM Sans').
import {DM_Sans,Manrope,Inter} from 'next/font/google';
export const dmSans=DM_Sans({subsets:['latin'],display:'swap',variable:'--font-dm-sans'});
export const manrope=Manrope({subsets:['latin'],display:'swap',variable:'--font-manrope'});
// Inter ne sert qu'aux livraisons de la veille dédiée : déclarée partout, téléchargée seulement là où un texte l'utilise.
export const inter=Inter({subsets:['latin'],display:'swap',variable:'--font-inter',style:['normal','italic'],preload:false});
export const FONT_VARIABLES_CSS=`:root{--font-dm-sans:${dmSans.style.fontFamily};--font-manrope:${manrope.style.fontFamily};--font-inter:${inter.style.fontFamily}}`;
