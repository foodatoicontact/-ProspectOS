// Single source of truth for the legal/editor identity used across the public legal pages
// (/mentions-legales, /confidentialite, /cgu, /cgv) and the signup acceptance flow.
//
// Every field is either verified directly from this repository/product (see the comment on each
// field) or explicitly '[À FOURNIR]'/'[À DÉFINIR AVANT COMMERCIALISATION]' — never invented. A legal
// identity (status, SIREN/SIRET, address, VAT, director of publication) is never asserted without a
// verifiable source: guessing it here would be worse than leaving it visibly incomplete, since it
// would look authoritative while being wrong.
export const MISSING = '[À FOURNIR]';
export const MISSING_COMMERCIAL = '[À DÉFINIR AVANT COMMERCIALISATION]';

// Verified from db/schema.sql, this session's own read-only production audit (organization "Foodatoi",
// GitHub org foodatoicontact), and README.md ("Première verticale Foodatoi"). This identifies the
// product/brand operating ProspectOS — it is NOT, on its own, proof of a specific legal status,
// registration number, or address, which is why every field below it is still explicitly missing.
export const EDITOR_NAME = 'Foodatoi';

export const EDITOR = {
 name: EDITOR_NAME,
 legalStatus: MISSING, // SAS / SARL / EI / auto-entrepreneur / association... — unverifiable from this repository
 siren: MISSING,
 siret: MISSING,
 rcs: MISSING,
 vatNumber: MISSING,
 address: MISSING,
 phone: MISSING,
 legalEmail: MISSING, // dedicated legal/RGPD contact channel — no such address exists anywhere in this repository
 publicationDirector: MISSING,
 capital: MISSING, // only relevant if a share-capital company — status itself is unverified
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
