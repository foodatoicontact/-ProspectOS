import {EDITOR} from './legal.ts';
// The one public contact channel of ProspectOS (the address already published in the legal notice). Every
// "écrivez-nous" / "nous contacter" link points here — never to a page that has no contact form.
export const CONTACT_EMAIL=EDITOR.legalEmail;
export const CONTACT_MAILTO=`mailto:${CONTACT_EMAIL}`;
