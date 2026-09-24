// Minimal, deterministic French geography for the Discovery location gate: departments (code, name,
// region) and their prefectures. No network, no routing, no distance: it only reads places that are
// EXPLICITLY written in a text (postal code, "(81)", a department/region/prefecture name) and compares
// regions. Absence of an explicit place is always UNKNOWN — never guessed, never turned into a match.

export type Department = {code: string; name: string; region: string; prefecture: string};

const R = {
 ARA: 'Auvergne-Rhône-Alpes', BFC: 'Bourgogne-Franche-Comté', BRE: 'Bretagne', CVL: 'Centre-Val de Loire', COR: 'Corse',
 GES: 'Grand Est', HDF: 'Hauts-de-France', IDF: 'Île-de-France', NOR: 'Normandie', NAQ: 'Nouvelle-Aquitaine',
 OCC: 'Occitanie', PDL: 'Pays de la Loire', PAC: 'Provence-Alpes-Côte d’Azur',
 GUA: 'Guadeloupe', MTQ: 'Martinique', GUF: 'Guyane', REU: 'La Réunion', MAY: 'Mayotte',
} as const;

export const DEPARTMENTS: readonly Department[] = [
 ['01', 'Ain', R.ARA, 'Bourg-en-Bresse'], ['02', 'Aisne', R.HDF, 'Laon'], ['03', 'Allier', R.ARA, 'Moulins'],
 ['04', 'Alpes-de-Haute-Provence', R.PAC, 'Digne-les-Bains'], ['05', 'Hautes-Alpes', R.PAC, 'Gap'], ['06', 'Alpes-Maritimes', R.PAC, 'Nice'],
 ['07', 'Ardèche', R.ARA, 'Privas'], ['08', 'Ardennes', R.GES, 'Charleville-Mézières'], ['09', 'Ariège', R.OCC, 'Foix'],
 ['10', 'Aube', R.GES, 'Troyes'], ['11', 'Aude', R.OCC, 'Carcassonne'], ['12', 'Aveyron', R.OCC, 'Rodez'],
 ['13', 'Bouches-du-Rhône', R.PAC, 'Marseille'], ['14', 'Calvados', R.NOR, 'Caen'], ['15', 'Cantal', R.ARA, 'Aurillac'],
 ['16', 'Charente', R.NAQ, 'Angoulême'], ['17', 'Charente-Maritime', R.NAQ, 'La Rochelle'], ['18', 'Cher', R.CVL, 'Bourges'],
 ['19', 'Corrèze', R.NAQ, 'Tulle'], ['2A', 'Corse-du-Sud', R.COR, 'Ajaccio'], ['2B', 'Haute-Corse', R.COR, 'Bastia'],
 ['21', 'Côte-d’Or', R.BFC, 'Dijon'], ['22', 'Côtes-d’Armor', R.BRE, 'Saint-Brieuc'], ['23', 'Creuse', R.NAQ, 'Guéret'],
 ['24', 'Dordogne', R.NAQ, 'Périgueux'], ['25', 'Doubs', R.BFC, 'Besançon'], ['26', 'Drôme', R.ARA, 'Valence'],
 ['27', 'Eure', R.NOR, 'Évreux'], ['28', 'Eure-et-Loir', R.CVL, 'Chartres'], ['29', 'Finistère', R.BRE, 'Quimper'],
 ['30', 'Gard', R.OCC, 'Nîmes'], ['31', 'Haute-Garonne', R.OCC, 'Toulouse'], ['32', 'Gers', R.OCC, 'Auch'],
 ['33', 'Gironde', R.NAQ, 'Bordeaux'], ['34', 'Hérault', R.OCC, 'Montpellier'], ['35', 'Ille-et-Vilaine', R.BRE, 'Rennes'],
 ['36', 'Indre', R.CVL, 'Châteauroux'], ['37', 'Indre-et-Loire', R.CVL, 'Tours'], ['38', 'Isère', R.ARA, 'Grenoble'],
 ['39', 'Jura', R.BFC, 'Lons-le-Saunier'], ['40', 'Landes', R.NAQ, 'Mont-de-Marsan'], ['41', 'Loir-et-Cher', R.CVL, 'Blois'],
 ['42', 'Loire', R.ARA, 'Saint-Étienne'], ['43', 'Haute-Loire', R.ARA, 'Le Puy-en-Velay'], ['44', 'Loire-Atlantique', R.PDL, 'Nantes'],
 ['45', 'Loiret', R.CVL, 'Orléans'], ['46', 'Lot', R.OCC, 'Cahors'], ['47', 'Lot-et-Garonne', R.NAQ, 'Agen'],
 ['48', 'Lozère', R.OCC, 'Mende'], ['49', 'Maine-et-Loire', R.PDL, 'Angers'], ['50', 'Manche', R.NOR, 'Saint-Lô'],
 ['51', 'Marne', R.GES, 'Châlons-en-Champagne'], ['52', 'Haute-Marne', R.GES, 'Chaumont'], ['53', 'Mayenne', R.PDL, 'Laval'],
 ['54', 'Meurthe-et-Moselle', R.GES, 'Nancy'], ['55', 'Meuse', R.GES, 'Bar-le-Duc'], ['56', 'Morbihan', R.BRE, 'Vannes'],
 ['57', 'Moselle', R.GES, 'Metz'], ['58', 'Nièvre', R.BFC, 'Nevers'], ['59', 'Nord', R.HDF, 'Lille'],
 ['60', 'Oise', R.HDF, 'Beauvais'], ['61', 'Orne', R.NOR, 'Alençon'], ['62', 'Pas-de-Calais', R.HDF, 'Arras'],
 ['63', 'Puy-de-Dôme', R.ARA, 'Clermont-Ferrand'], ['64', 'Pyrénées-Atlantiques', R.NAQ, 'Pau'], ['65', 'Hautes-Pyrénées', R.OCC, 'Tarbes'],
 ['66', 'Pyrénées-Orientales', R.OCC, 'Perpignan'], ['67', 'Bas-Rhin', R.GES, 'Strasbourg'], ['68', 'Haut-Rhin', R.GES, 'Colmar'],
 ['69', 'Rhône', R.ARA, 'Lyon'], ['70', 'Haute-Saône', R.BFC, 'Vesoul'], ['71', 'Saône-et-Loire', R.BFC, 'Mâcon'],
 ['72', 'Sarthe', R.PDL, 'Le Mans'], ['73', 'Savoie', R.ARA, 'Chambéry'], ['74', 'Haute-Savoie', R.ARA, 'Annecy'],
 ['75', 'Paris', R.IDF, 'Paris'], ['76', 'Seine-Maritime', R.NOR, 'Rouen'], ['77', 'Seine-et-Marne', R.IDF, 'Melun'],
 ['78', 'Yvelines', R.IDF, 'Versailles'], ['79', 'Deux-Sèvres', R.NAQ, 'Niort'], ['80', 'Somme', R.HDF, 'Amiens'],
 ['81', 'Tarn', R.OCC, 'Albi'], ['82', 'Tarn-et-Garonne', R.OCC, 'Montauban'], ['83', 'Var', R.PAC, 'Toulon'],
 ['84', 'Vaucluse', R.PAC, 'Avignon'], ['85', 'Vendée', R.PDL, 'La Roche-sur-Yon'], ['86', 'Vienne', R.NAQ, 'Poitiers'],
 ['87', 'Haute-Vienne', R.NAQ, 'Limoges'], ['88', 'Vosges', R.GES, 'Épinal'], ['89', 'Yonne', R.BFC, 'Auxerre'],
 ['90', 'Territoire de Belfort', R.BFC, 'Belfort'], ['91', 'Essonne', R.IDF, 'Évry-Courcouronnes'], ['92', 'Hauts-de-Seine', R.IDF, 'Nanterre'],
 ['93', 'Seine-Saint-Denis', R.IDF, 'Bobigny'], ['94', 'Val-de-Marne', R.IDF, 'Créteil'], ['95', 'Val-d’Oise', R.IDF, 'Cergy'],
 ['971', 'Guadeloupe', R.GUA, 'Basse-Terre'], ['972', 'Martinique', R.MTQ, 'Fort-de-France'], ['973', 'Guyane', R.GUF, 'Cayenne'],
 ['974', 'La Réunion', R.REU, ''], ['976', 'Mayotte', R.MAY, 'Mamoudzou'],
].map(([code, name, region, prefecture]) => ({code: code!, name: name!, region: region!, prefecture: prefecture!}));

const byCode = new Map(DEPARTMENTS.map(d => [d.code, d]));
export const REGIONS: readonly string[] = [...new Set(DEPARTMENTS.map(d => d.region))];

// Accent/case/apostrophe/hyphen-insensitive comparison form.
export const foldPlace = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[-_]+/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();

// Names that are also everyday French/English words ("Nord", "Lot", "Cher", "Var", "Tours", "Nice"…)
// are never matched by name alone — only through a postal code or an explicit "(NN)" department code.
const AMBIGUOUS = new Set(['ain', 'aube', 'cher', 'eure', 'gard', 'indre', 'loire', 'lot', 'manche', 'marne', 'meuse', 'nord', 'orne', 'somme', 'var', 'vienne', 'jura',
 'tours', 'nice', 'gap', 'pau', 'nancy', 'valence', 'vannes', 'tulle', 'laval', 'auch', 'foix', 'mende', 'moulins', 'laon', 'chaumont', 'troyes', 'metz', 'agen', 'blois', 'arras', 'cergy', 'belfort']);
type Pattern = {folded: string; region: string; department: string | null};
const PLACE_PATTERNS: Pattern[] = [
 ...DEPARTMENTS.map(d => ({folded: foldPlace(d.name), region: d.region, department: d.code})),
 ...DEPARTMENTS.filter(d => d.prefecture).map(d => ({folded: foldPlace(d.prefecture), region: d.region, department: d.code})),
 ...REGIONS.map(r => ({folded: foldPlace(r), region: r, department: null})),
 {folded: 'ile de france', region: R.IDF, department: null}, {folded: 'paca', region: R.PAC, department: null},
 {folded: 'region parisienne', region: R.IDF, department: null},
].filter(p => !AMBIGUOUS.has(p.folded))
 // Longest first, so "Tarn-et-Garonne" is read before "Tarn" and "Haute-Garonne" before "Garonne".
 .sort((a, b) => b.folded.length - a.folded.length);

export type PlaceSet = {departments: Set<string>; regions: Set<string>};

// A postal code only counts next to a place-shaped word or in parentheses — never a bare 5-digit number
// (a salary, a quantity). Overseas codes are 97x; Corsica (20xxx) resolves to its region only.
function departmentOfPostalCode(code: string): Department | null {
 if (/^97[1-6]/.test(code)) return byCode.get(code.slice(0, 3)) ?? null;
 if (code.startsWith('20')) return byCode.get('2A') ?? null; // region Corse either way
 const d = byCode.get(code.slice(0, 2));
 return d && code.slice(0, 2) !== '00' ? d : null;
}
const POSTAL_NEXT_TO_PLACE = /(?:\((\d{5})\)|\b(\d{5})\s+[A-ZÀ-Ý][a-zà-ÿ]|[A-ZÀ-Ý][a-zà-ÿ'’-]+\s+\(?(\d{5})\)?(?!\s*(?:€|eur|euros|\$)))/g;
const DEPARTMENT_CODE_IN_PARENS = /\((\d{2}|2[AB]|97[1-6])\)/g;

export function placesIn(text: string): PlaceSet {
 const out: PlaceSet = {departments: new Set(), regions: new Set()};
 const add = (d: Department | null | undefined) => { if (d) { out.departments.add(d.code); out.regions.add(d.region); } };
 for (const m of text.matchAll(POSTAL_NEXT_TO_PLACE)) add(departmentOfPostalCode((m[1] ?? m[2] ?? m[3])!));
 for (const m of text.matchAll(DEPARTMENT_CODE_IN_PARENS)) add(byCode.get(m[1]!));
 let folded = ` ${foldPlace(text)} `;
 for (const p of PLACE_PATTERNS) {
  const needle = ` ${p.folded} `;
  if (!folded.includes(needle)) continue;
  folded = folded.split(needle).join(' ');
  if (p.department) add(byCode.get(p.department)); else out.regions.add(p.region);
 }
 return out;
}

// True when a (short) name is a place and nothing else — "Gaillac", "Tarn", "Occitanie", "Toulouse".
export function isPlaceName(name: string, extraPlaces: readonly string[] = []): boolean {
 const f = foldPlace(name);
 if (!f) return false;
 return PLACE_PATTERNS.some(p => p.folded === f) || AMBIGUOUS.has(f) || extraPlaces.some(x => foldPlace(x) === f);
}

export type LocationState = 'VERIFIED' | 'COMPATIBLE' | 'UNKNOWN' | 'MISMATCH';
export type LocationTarget = {text: string; cityTokens: string[]; places: PlaceSet};

// The zone the user asked for. City tokens are the literal leading words of each comma/"et"-separated
// part ("Gaillac et jusqu'à ~1h autour" -> "gaillac"); places are what the gazetteer can read in it.
export function locationTarget(location: string): LocationTarget {
 const cityTokens = location.split(/,|\bet\b|\bou\b|\(|\)|\//i).map(part => foldPlace(part).split(' ').filter(w => w.length >= 3 && !/^\d+$/.test(w))[0] ?? '').filter(Boolean)
  .filter(t => !['france', 'jusqu', 'autour', 'environ', 'heure', 'voiture', 'rayon', 'region', 'departement', 'alentours', 'proximite', 'secteur', 'zone'].includes(t))
  // A department/region is compared through `places`, never as a literal token ("tarn" would match "Tarn-et-Garonne").
  .filter(t => !PLACE_PATTERNS.some(p => p.folded === t && !DEPARTMENTS.some(d => foldPlace(d.prefecture) === t)));
 return {text: location, cityTokens: [...new Set(cityTokens)], places: placesIn(location)};
}

// VERIFIED: the candidate's own text names the target city, or a target department.
// COMPATIBLE: same region as the target, nothing more precise. MISMATCH: every explicit place in the
// candidate is in a region the target does not cover. UNKNOWN: anything else — never promoted to a match.
export function compareLocation(target: LocationTarget, candidateText: string): {state: LocationState; candidate: PlaceSet} {
 const candidate = placesIn(candidateText);
 const folded = ` ${foldPlace(candidateText)} `;
 if (target.cityTokens.some(t => folded.includes(` ${t} `))) return {state: 'VERIFIED', candidate};
 if ([...candidate.departments].some(d => target.places.departments.has(d))) return {state: 'VERIFIED', candidate};
 if (!target.places.regions.size || !candidate.regions.size) return {state: 'UNKNOWN', candidate};
 if ([...candidate.regions].some(r => target.places.regions.has(r))) return {state: 'COMPATIBLE', candidate};
 return {state: 'MISMATCH', candidate};
}
