// ICP import — the review screen's own dictionary (French and English), kept next to the feature rather than in the
// app-wide src/i18n/fr.ts / en.ts. Both languages carry exactly the same keys (tests/icp-import-review.test.ts).
import type {Locale} from '../i18n/locale.ts';

const fr={
 title:'Importer mon entreprise',
 intro:'Donnez votre plaquette, un document Word ou collez votre présentation : nous en tirons un brouillon de profil, que vous relisez avant qu’il serve à quoi que ce soit.',
 tabFile:'Fichier PDF ou Word',tabText:'Coller un texte',
 fileLabel:'Votre document (PDF ou .docx, 4 Mo maximum)',fileTooLarge:'Ce fichier dépasse 4 Mo. Collez plutôt le texte de votre présentation.',
 textLabel:'Votre présentation (30 à 50 000 caractères)',textCount:'{n} / 50 000 caractères',
 start:'Analyser',cancel:'Annuler',
 privacy:'Le fichier est lu puis oublié : il n’est jamais conservé. Seul le brouillon extrait est enregistré.',
 pendingTitle:'Analyse de votre document…',
 pendingStep1:'Lecture du document',pendingStep2:'Extraction des informations et de leurs sources',pendingStep3:'Vérification de chaque valeur',
 pendingElapsed:'{s} s écoulées — cela peut prendre jusqu’à une minute.',
 pendingLeave:'Vous pouvez quitter cette page ou la recharger : le résultat vous attendra ici.',
 offline:'Connexion perdue. Nouvelle tentative dans {s} s… Votre import continue côté serveur.',
 reviewTitle:'Relisez votre profil',reviewIntro:'Rien n’est utilisé tant que vous n’avez pas validé. Touchez « Source » pour voir le passage du document.',
 restored:'Vos modifications non validées ont été restaurées.',
 sectionCompany:'Entreprise',sectionOffer:'Offre',sectionTarget:'Cible',sectionPersonas:'Interlocuteurs',sectionSignals:'Signaux d’achat',sectionExclusions:'Exclusions',
 fName:'Nom',fActivity:'Activité',fSites:'Sites',fZones:'Départements d’intervention',fServices:'Services',fPromises:'Engagements',fDifferentiators:'Différences',fProofs:'Preuves',
 fSegments:'Types de clients',fSize:'Taille',fPriority:'Priorité',fValue:'Valeur',fCycle:'Cycle de vente',fRole:'Fonction',fPains:'Difficultés',fAngle:'Angle de message',fReason:'Raison',
 source:'Source',sourceManual:'Saisi par vous',noSource:'Aucune source',
 cHigh:'Sûr',cMedium:'À vérifier',cLow:'Peu sûr',cEmpty:'Vide — à compléter',
 remove:'Retirer',add:'Ajouter',addPlaceholder:'Ajouter…',zonesPlaceholder:'ex. 44, 49, Vendée',empty:'Rien trouvé dans le document.',
 roleHQ:'Siège',roleAGENCY:'Agence',rolePARTNER:'Partenaire',
 unmonitored:'Non surveillé pour l’instant',
 questionsTitle:'Il nous manque {n} information(s)',questionOf:'Question {i} sur {n}',answer:'Répondre',skip:'Passer',questionsDone:'Merci, plus aucune question.',
 keepOffer:'Garder mon offre actuelle',keepCriteria:'Garder mes critères actuels',
 validate:'Valider ce profil',reject:'Rejeter',validating:'Validation…',
 validatedTitle:'Profil validé',validatedBody:'Votre offre et votre cible ont été mises à jour. Les poids de vos critères n’ont pas changé.',
 validatedKept:'Critère gardé tel que vous l’aviez modifié : {k}.',
 discardedTitle:'Brouillon rejeté',discardedBody:'Rien n’a été modifié dans votre projet.',
 failedTitle:'L’import n’a pas abouti',unreadableTitle:'Brouillon illisible — à ré-importer',unreadableBody:'Ce brouillon ne peut plus être relu. Relancez un import : rien n’a été appliqué à votre projet.',
 retry:'Relancer',retryNeedsSource:'Le document n’est pas conservé : choisissez-le à nouveau ou recollez le texte.',newImport:'Nouvel import',
 erase:'Supprimer cet import',eraseConfirm:'Supprimer définitivement cet import ? Le profil déjà validé reste dans votre projet.',erased:'Import supprimé.',
 retryLater:'Réessayer',genericError:'Une erreur est survenue. Réessayez dans un instant.',
} as const;

export type IcpMessageKey=keyof typeof fr;
const en:Record<IcpMessageKey,string>={
 title:'Import my company',
 intro:'Give us your brochure, a Word document or paste your presentation: we turn it into a draft profile that you review before it is used for anything.',
 tabFile:'PDF or Word file',tabText:'Paste a text',
 fileLabel:'Your document (PDF or .docx, 4 MB max)',fileTooLarge:'This file is over 4 MB. Paste the text of your presentation instead.',
 textLabel:'Your presentation (30 to 50,000 characters)',textCount:'{n} / 50,000 characters',
 start:'Analyse',cancel:'Cancel',
 privacy:'The file is read, then forgotten: it is never stored. Only the extracted draft is saved.',
 pendingTitle:'Analysing your document…',
 pendingStep1:'Reading the document',pendingStep2:'Extracting the facts and their sources',pendingStep3:'Checking every value',
 pendingElapsed:'{s} s elapsed — this can take up to a minute.',
 pendingLeave:'You can leave or reload this page: the result will be waiting here.',
 offline:'Connection lost. Retrying in {s} s… Your import keeps running on the server.',
 reviewTitle:'Review your profile',reviewIntro:'Nothing is used until you validate. Tap “Source” to see the passage of the document.',
 restored:'Your unvalidated changes were restored.',
 sectionCompany:'Company',sectionOffer:'Offer',sectionTarget:'Target',sectionPersonas:'Contacts',sectionSignals:'Buying signals',sectionExclusions:'Exclusions',
 fName:'Name',fActivity:'Activity',fSites:'Sites',fZones:'Departments served',fServices:'Services',fPromises:'Commitments',fDifferentiators:'Differentiators',fProofs:'Proofs',
 fSegments:'Customer types',fSize:'Size',fPriority:'Priority',fValue:'Value',fCycle:'Sales cycle',fRole:'Role',fPains:'Pain points',fAngle:'Message angle',fReason:'Reason',
 source:'Source',sourceManual:'Typed by you',noSource:'No source',
 cHigh:'Confident',cMedium:'To check',cLow:'Unsure',cEmpty:'Empty — to fill in',
 remove:'Remove',add:'Add',addPlaceholder:'Add…',zonesPlaceholder:'e.g. 44, 49, Vendée',empty:'Nothing found in the document.',
 roleHQ:'Head office',roleAGENCY:'Branch',rolePARTNER:'Partner',
 unmonitored:'Not monitored yet',
 questionsTitle:'{n} piece(s) of information missing',questionOf:'Question {i} of {n}',answer:'Answer',skip:'Skip',questionsDone:'Thanks, no more questions.',
 keepOffer:'Keep my current offer',keepCriteria:'Keep my current criteria',
 validate:'Validate this profile',reject:'Reject',validating:'Validating…',
 validatedTitle:'Profile validated',validatedBody:'Your offer and target were updated. Your criteria weights did not change.',
 validatedKept:'Criterion kept as you had edited it: {k}.',
 discardedTitle:'Draft rejected',discardedBody:'Nothing was changed in your project.',
 failedTitle:'The import did not complete',unreadableTitle:'Unreadable draft — import again',unreadableBody:'This draft can no longer be read. Run a new import: nothing was applied to your project.',
 retry:'Retry',retryNeedsSource:'The document is not kept: choose it again or paste the text again.',newImport:'New import',
 erase:'Delete this import',eraseConfirm:'Delete this import for good? The profile already validated stays in your project.',erased:'Import deleted.',
 retryLater:'Try again',genericError:'Something went wrong. Try again in a moment.',
};
export const ICP_MESSAGES={fr,en} as const;
export function icpText(locale:Locale,key:IcpMessageKey,vars?:Record<string,string|number>):string{
 let s:string=ICP_MESSAGES[locale][key];
 for(const [k,v] of Object.entries(vars??{}))s=s.replace(`{${k}}`,String(v));
 return s;
}

// Signal types and the refusal codes of the API, in the reader's language. A code not listed keeps the server's message.
export const SIGNAL_LABELS:Record<Locale,Record<string,string>>={
 fr:{CREATION:'Création d’entreprise',TRANSFER:'Déménagement',OPENING:'Ouverture d’un site',WORKS:'Travaux',HIRING:'Recrutement',ACQUISITION:'Rachat',CONTRACT_RENEWAL:'Renouvellement de contrat'},
 en:{CREATION:'Company creation',TRANSFER:'Relocation',OPENING:'New site opening',WORKS:'Works',HIRING:'Hiring',ACQUISITION:'Acquisition',CONTRACT_RENEWAL:'Contract renewal'},
};
export const ERROR_TEXT:Record<Locale,Record<string,string>>={
 fr:{IMPORT_STALE:'Cet import ne s’est pas terminé. Relancez-le : votre fichier ou votre texte n’a pas été conservé.',NETWORK:'Connexion impossible. Vérifiez votre réseau et réessayez.'},
 en:{
  IMPORT_STALE:'This import did not finish. Run it again: your file or text was not kept.',NETWORK:'Cannot connect. Check your network and try again.',
  FILE_TOO_LARGE:'File too large (4 MB max). Import your website address instead, or paste the text of your presentation.',
  UNSUPPORTED_FILE:'Unrecognised format: only PDF and Word (.docx) files are accepted. You can also paste the text.',
  FILE_EMPTY:'The file is empty.',TEXT_TOO_SHORT:'Text too short to describe your company (30 characters minimum).',TEXT_TOO_LONG:'Text too long (50,000 characters maximum).',
  PDF_SCANNED:'This PDF has no readable text (scanned document or image). Paste the text of your presentation instead.',
  PDF_UNREADABLE:'This PDF could not be read. Try another export, or paste the text.',PDF_ENCRYPTED:'This PDF is password-protected. Export it without protection, or paste the text.',
  PDF_TIMEOUT:'Reading this PDF took too long. Paste the text of your presentation instead.',DOCX_UNREADABLE:'This Word document could not be read. Save it again as .docx, or paste the text.',
  DOCX_TOO_LARGE:'This Word document is too large once decompressed. Paste the text of your presentation instead.',
  ICP_IMPORT_IN_PROGRESS:'An import is already running for this project. Wait a few seconds.',OFFER_LIMIT_REACHED:'AI analysis quota reached for this period.',QUOTA_EXCEEDED:'Your organisation’s hourly quota is reached.',
  AI_UNAVAILABLE:'The AI provider could not process the request. Try again in a moment.',AI_TRUNCATED_RESULT:'The AI answer was cut off. Try a shorter text.',
  AI_INVALID_RESULT:'The AI answer could not be validated. Nothing was saved to your profile; try again or paste a more focused text.',
  BYOK_CREDENTIAL_INVALID:'Your own Anthropic key is invalid or unreadable. Replace it in Account.',AI_NOT_CONFIGURED:'AI provider and model are not configured.',
  IMPORT_NOT_FOUND:'Import not found.',IMPORT_NOT_REVIEWABLE:'This import is no longer a draft to validate.',INVALID_PROFILE:'The profile sent is not valid. Reload the import and try again.',
 },
};
export function errorText(locale:Locale,code:string|undefined,serverMessage:string|undefined):string{
 if(code&&ERROR_TEXT[locale][code])return ERROR_TEXT[locale][code]!;
 if(locale==='fr'&&serverMessage)return serverMessage;
 return icpText(locale,'genericError');
}
