// Signaux SIRENE — the default presets. Data only (no rule here): validated by presets.ts, and replaced entirely by
// REGISTRY_SIGNAL_PRESETS_JSON (same shape) on a server. NAF rév. 2 codes, as the register writes them.
export const DEFAULT_PRESETS={
 "paramedical_installation": {
  "label": "Installation paramédicale",
  "max_age_days": 183,
  "naf_codes": [
   "86.90F"
  ],
  "name_keywords": [
   "osteo",
   "osteopathe",
   "osteopathie",
   "psychologue",
   "psychologie",
   "psy",
   "dieteticien",
   "dieteticienne",
   "dietetique",
   "nutrition",
   "chiropracteur",
   "chiropraxie",
   "chiropratique"
  ],
  "ambiguities": [
   "Ostéopathes, psychologues, diététiciens et chiropracteurs relèvent tous du code 86.90F (Activités de santé humaine non classées ailleurs), qui couvre aussi d'autres métiers (sophrologues, naturopathes, réflexologues…) : le code ne distingue pas le métier.",
   "name_keywords ne sert qu'à indiquer le métier probable, jamais à exclure : il n'est lu que dans la dénomination, l'enseigne ou le nom commercial, et un métier deviné reste « estime ».",
   "Une partie de ces professionnels se déclare sous un autre code (86.90E pour la rééducation, 85.59B, 96.09Z) : ils ne sont pas couverts par ce preset.",
   "Presque tous sont entrepreneurs individuels : la dénomination est le nom de la personne. Seules les fiches publiquement diffusibles sont gardées, et aucun champ « dirigeants » n'est lu ni stocké."
  ]
 },
 "commerce_ouverture": {
  "label": "Ouverture de commerce",
  "max_age_days": 92,
  "naf_codes": [
   "56.10A",
   "56.10B",
   "56.10C",
   "56.30Z",
   "47.11A",
   "47.11B",
   "47.11C",
   "47.11D",
   "47.11E",
   "47.11F",
   "47.19A",
   "47.19B",
   "47.21Z",
   "47.22Z",
   "47.23Z",
   "47.24Z",
   "47.25Z",
   "47.26Z",
   "47.29Z",
   "47.30Z",
   "47.41Z",
   "47.42Z",
   "47.43Z",
   "47.51Z",
   "47.52A",
   "47.52B",
   "47.53Z",
   "47.54Z",
   "47.59A",
   "47.59B",
   "47.61Z",
   "47.62Z",
   "47.63Z",
   "47.64Z",
   "47.65Z",
   "47.71Z",
   "47.72A",
   "47.72B",
   "47.73Z",
   "47.74Z",
   "47.75Z",
   "47.76Z",
   "47.77Z",
   "47.78A",
   "47.78B",
   "47.78C",
   "47.79Z",
   "96.02A",
   "96.02B"
  ],
  "name_keywords": [],
  "ambiguities": [
   "Commerce de détail : seulement le commerce en magasin (47.1 à 47.7). Les marchés et éventaires (47.8) et la vente à distance ou à domicile (47.9) n'ont pas de boutique et sont exclus.",
   "Restauration : 56.10A/B/C et les débits de boissons (56.30Z) ; les traiteurs (56.21Z) et la restauration collective (56.29) sont exclus.",
   "Beauté : 96.02B (soins de beauté). Les spas et hammams (96.04Z) et le tatouage (96.09Z) ne sont pas inclus.",
   "Beaucoup de créations récentes sont des micro-entreprises domiciliées chez la personne (coiffure ou esthétique à domicile) : le registre ne le dit pas, l'absence sur Google le suggère seulement."
  ]
 }
};
