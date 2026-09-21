// Single source of truth for the legal/editor identity used across the public legal pages
// (/mentions-legales, /confidentialite, /cgu, /cgv) and the signup acceptance flow.
//
// Every field is either verified directly from this repository/product, or officially provided by the
// owner in conversation (see the comment on each field), or explicitly '[À FOURNIR]'/
// '[À DÉFINIR AVANT COMMERCIALISATION]' — never invented. A legal identity detail is never asserted
// without a verifiable source: guessing it here would be worse than leaving it visibly incomplete,
// since it would look authoritative while being wrong.
export const MISSING = '[À FOURNIR]';
export const MISSING_COMMERCIAL = '[À DÉFINIR AVANT COMMERCIALISATION]';

// Verified from db/schema.sql, this session's own read-only production audit (organization "Foodatoi",
// GitHub org foodatoicontact), and README.md ("Première verticale Foodatoi"). Foodatoi is the
// product/project ProspectOS is a vertical of — it is referenced here as such, never presented as a
// separate legal entity distinct from the individual entrepreneur below.
export const COMMERCIAL_NAME = 'Foodatoi';

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
 // at a greffe, which is a separate question — see `rcs` below, deliberately left unresolved rather
 // than assumed either way.
 rneRegistrationDate: '25/06/2026',
 // RCS applies to activities qualified as "commerciales" and registered at a greffe (a number + a
 // "ville d'immatriculation"); RNE registration alone does not establish whether that additional
 // registration exists or is required for this specific activity. No RCS number or greffe city was
 // provided, so this stays explicitly unresolved rather than guessed as either "applicable" or "non
 // applicable" — see MISSING_LEGAL_INFORMATION in the RC report for exactly what to verify.
 rcs: MISSING,
 // Determined, not left blank: a brand-new micro-entreprise (SIRET obtained 25/06/2026) is, by default
 // and by far the most common case, under "franchise en base de TVA" (article 293 B du CGI) — no VAT
 // number exists or is required under this regime, and the correct mentions-légales statement is this
 // exemption notice, not an empty/missing number. This assumes no voluntary opt-in to real VAT taxation
 // and no threshold already exceeded — neither was indicated, and both would need to be corrected by
 // the owner if inaccurate.
 vatStatus: 'TVA non applicable, article 293 B du Code général des impôts (franchise en base de TVA applicable de plein droit aux micro-entreprises, sauf option contraire ou dépassement des seuils légaux — à corriger si inexact)',
 address: '1 rue Edmond Haraucourt, 31100 Toulouse, France',
 phone: MISSING,
 // Deliberately NOT the registered business address above: a postal/registration address is a
 // different legal requirement (mentions légales) from a functioning channel for exercising RGPD
 // rights, and the owner explicitly asked that the personal/business address never be repurposed as
 // that contact. No such dedicated channel exists yet.
 legalEmail: MISSING,
 // The entrepreneur individuel themselves, in the absence of any separate legal entity or board to
 // designate a distinct director of publication (LCEN art. 6-III).
 publicationDirector: 'Kevin Cardia',
 capital: 'Non applicable (entrepreneur individuel — pas de capital social)',
};

// The formality adding ProspectOS's software-publishing/SaaS activity to this EI's registration —
// filed but not yet validated by INSEE/INPI at the time this text was written. Never state or imply
// this activity is already definitively registered until that validation is actually received.
export const ACTIVITY_FORMALITY = {
 filedAt: '21/09/2026',
 declaredStartDate: '18/09/2026',
 status: 'Formalité d’adjonction d’activité déposée auprès de l’INPI — en cours de traitement/validation (non encore confirmée par l’INSEE au jour de la présente mise à jour)',
 description: 'Conception, développement, édition, exploitation et commercialisation de logiciels, applications web et solutions numériques, notamment sous forme de services en ligne (SaaS), destinés aux professionnels. Développement, maintenance et évolution de solutions logicielles intégrant notamment des fonctionnalités d’intelligence artificielle.',
};

// Hosting is verified from actual product architecture: README.md's own deployment instructions
// ("Déployer sur Vercel"), package.json's @supabase/supabase-js dependency, and the live Supabase
// project this engagement has operated against all session. Their own registered addresses are not
// asserted here — a legal document should cite the exact current address from each provider's own
// legal pages at publication time, not a value memorized/guessed here.
export const HOSTING = {
 application: {name: 'Vercel Inc.', role: 'Hébergement de l’application web (déploiement Next.js)', address: MISSING},
 database: {name: 'Supabase', role: 'Base de données PostgreSQL et authentification (Supabase Auth)', address: MISSING},
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
