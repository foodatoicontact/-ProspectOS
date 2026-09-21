// Single source of truth for the legal/editor identity used across the public legal pages
// (/mentions-legales, /confidentialite, /cgu, /cgv) and the signup acceptance flow.
//
// Every field is either verified directly from this repository/product, or officially provided by the
// owner in conversation (see the comment on each field), or one of the two explicit placeholders below
// — never invented. A legal identity detail is never asserted without a verifiable source: guessing it
// here would be worse than leaving it visibly incomplete, since it would look authoritative while being
// wrong.
export const MISSING = '[À FOURNIR]'; // genuinely unknown — the owner still needs to supply this
export const TO_CONFIRM = '[À CONFIRMER]'; // a status that is administratively pending or contractually unverified — never asserted either way until confirmed
export const MISSING_COMMERCIAL = '[À DÉFINIR AVANT COMMERCIALISATION]';

// The service these legal pages actually concern. ProspectOS and Foodatoi are two distinct
// projects operated by the same entrepreneur individuel (Kevin Cardia) — a prior version of this
// constant incorrectly named Foodatoi as ProspectOS's own "nom commercial", which misattributed
// ProspectOS to a different project. Never reintroduce that: this page is about ProspectOS, and
// ProspectOS is presented as the service concerned, never as operating "in the context of" or
// "under" any other named project.
export const SERVICE_NAME = 'ProspectOS';

// Officially provided by the owner (Kevin Cardia) for this legal bloc. An entrepreneur individuel (EI)
// has no "raison sociale" distinct from the person's own civil identity — the natural person IS the
// legal operator, which is why `name` and `publicationDirector` are the same person, and `capital` is
// genuinely not applicable (an EI has no share capital).
export const EDITOR = {
 name: 'Kevin Cardia',
 legalStatus: 'Entrepreneur individuel (EI), régime micro-entreprise',
 siren: '106 540 453',
 siret: '106 540 453 00011',
 // RNE = Registre National des Entreprises, the registry that actually holds this EI's registration
 // (confirmed by the owner). This is distinct from an RCS (Registre du Commerce et des Sociétés) entry
 // at a greffe, which is a separate question — see `rcs` below. The ProspectOS activity itself is a
 // separate, still-pending formality — see ACTIVITY_FORMALITY.
 rneRegistrationDate: '25/06/2026',
 // RCS applies to activities qualified as "commerciales" and registered at a greffe (a number + a
 // "ville d'immatriculation"). RNE registration alone does not establish this, and the ProspectOS
 // activity formality itself is still pending INSEE/TCO processing — never invent a number, a greffe
 // city, or a new registration here.
 rcs: TO_CONFIRM,
 // Never asserted as "non applicable" merely because the regime is micro-entreprise — an intracommunity
 // VAT number must be shown here if one applies. None has been verified, so this stays an explicit,
 // neutral "to confirm" rather than either a fabricated number or a definitive exemption claim.
 vatStatus: TO_CONFIRM,
 address: '1 rue Edmond Haraucourt, 31100 Toulouse, France',
 phone: '06 35 15 10 66',
 // A dedicated public/legal/RGPD contact channel — deliberately distinct from the registered business
 // address above, and never the owner's personal address repurposed as this contact.
 legalEmail: 'prospectos.contact@gmail.com',
 // The entrepreneur individuel themselves, in the absence of any separate legal entity or board to
 // designate a distinct director of publication (LCEN art. 6-III).
 publicationDirector: 'Kevin Cardia',
 capital: 'Non applicable (entrepreneur individuel — pas de capital social)',
};

// The formality adding ProspectOS's software-publishing/SaaS activity to this EI's registration — filed
// but not yet validated by the INSEE/TCO at the time this text was written. Kept to the minimal factual
// statement the owner asked for, never expanded into an unnecessary commercial claim: no activity
// description, no implied validation.
export const ACTIVITY_FORMALITY = {
 filedAt: '21/09/2026',
 declaredStartDate: '18/09/2026',
 status: 'Formalité d’adjonction d’activité déposée — validation administrative en cours.',
};

// Hosting is verified from actual product architecture: README.md's own deployment instructions
// ("Déployer sur Vercel"), package.json's @supabase/supabase-js dependency, and the live Supabase
// project this engagement has operated against all session. Vercel's address is taken from its own
// official documentation, as verified and supplied for this bloc; Supabase's own registered address was
// not verified and stays explicit rather than guessed.
export const HOSTING = {
 application: {name: 'Vercel Inc.', role: 'Hébergement de l’application web (déploiement Next.js)', address: '440 N Barranca Avenue #4133, Covina, CA 91723, United States'},
 database: {name: 'Supabase', role: 'Base de données PostgreSQL et authentification (Supabase Auth)', address: MISSING, region: 'eu-west-1 — Europe (Irlande)'},
};

// One entry per provider whose processing can involve a transfer of data outside the EU. Each `status`
// states only what is actually verified about that provider's own contractual mechanism — never
// extrapolated from a different, similarly-named product's terms (see `braveSearch`, where a real DPA
// exists for Brave Ads but has not been verified to apply to the Brave Search API ProspectOS actually
// uses), and never overstated into "no transfer is possible" merely because primary storage is in the EU
// (see `supabase`).
export const TRANSFERS = {
 vercel: 'Le contrat de traitement des données (DPA) de Vercel prévoit des Clauses Contractuelles Types (CCT/SCC) européennes pour les transferts internationaux concernés par l’hébergement applicatif.',
 supabase: 'Le projet ProspectOS est configuré dans la région eu-west-1 (Irlande), qui détermine la localisation primaire des données selon la documentation Supabase. Ceci ne signifie pas qu’aucun traitement ou transfert hors UE ne peut jamais avoir lieu dans le cadre de l’exploitation du service ; le DPA Supabase intègre des Clauses Contractuelles Types pour les transferts internationaux applicables.',
 anthropic: 'Le contrat de traitement des données (DPA) d’Anthropic, incluant des Clauses Contractuelles Types, est intégré à ses Commercial Terms applicables à l’usage commercial de son API — utilisé uniquement pour les données décrites à la section 3 (texte d’offre que vous soumettez volontairement à l’analyse, et votre clé BYOK le cas échéant), jamais pour l’ensemble des données ProspectOS.',
 braveSearch: `${TO_CONFIRM} — un mécanisme de transfert contractuel a été identifié pour Brave Ads, mais son applicabilité à l’API Brave Search effectivement utilisée par ProspectOS n’a pas été vérifiée et n’est pas présumée.`,
};

// Bumped whenever the corresponding page's substance changes — never silently. Recorded (via Supabase
// Auth's own user_metadata, see app/page.tsx's signUp() call) at the moment a new account accepts them,
// so a specific version can always be tied to a specific acceptance timestamp without a new table.
export const TERMS_VERSION = '2026-09-21';
export const PRIVACY_VERSION = '2026-09-21';

export const LEGAL_PAGES = [
 {href: '/mentions-legales', label: 'Mentions légales'},
 {href: '/cgu', label: 'CGU'},
 {href: '/confidentialite', label: 'Confidentialité'},
 {href: '/cgv', label: 'CGV'},
] as const;
