# Diagnostic de présence web

Statut : **Disponible** avec l'analyse de site (bêta activée par l'opérateur). Code : `src/discovery/strategies/web-presence.ts`.

## Pourquoi

Un freelance web ou SEO qualifie un prospect sur des faits techniques que le texte d'une page ne dit pas : qui a
fait le site, sur quel outil, s'il est encore entretenu, s'il marche sur un téléphone, si un visiteur peut demander
un devis ou réserver en ligne. Ces faits étaient lus nulle part ; ils le sont désormais, à partir des pages déjà
téléchargées par « Analyser le site » (aucune requête de plus).

## Ce qui est lu

| Type | Statut | Extrait cité | Condition |
|---|---|---|---|
| `WEB_AGENCY_CREDIT` | OBSERVED | La phrase du crédit (« Site réalisé par Agence X ») | Lien sortant en pied de page, crédit explicite (0,9) ou ancre descriptive (0,75). Un lien nu (0,35) n'est jamais enregistré |
| `WEB_CMS` | OBSERVED | Le `<meta name="generator">` tel quel, sinon le chemin CDN reconnu | WordPress, Wix, Squarespace, Shopify, Webflow |
| `WEB_COPYRIGHT_OLD` | OBSERVED | La ligne du copyright | Année la plus récente ≥ 2 ans |
| `WEB_NO_HTTPS` | OBSERVED | L'adresse de la page | Page d'accueil servie en `http://` |
| `WEB_NO_MOBILE_VIEWPORT` | INFERRED | Le titre de la page | Aucune balise viewport sur l'accueil |
| `WEB_QUOTE_REQUEST_FOUND` | OBSERVED | Le texte du lien, bouton ou formulaire | « devis » dans un lien, bouton ou formulaire (une phrase seule ne compte pas) |
| `WEB_NO_QUOTE_REQUEST_SEEN` | INFERRED | Le titre de la page | Rien de tel sur toutes les pages lues |
| `WEB_ONLINE_BOOKING_FOUND` | OBSERVED | Le domaine du service | Lien ou intégration Planity, Doctolib, Calendly, Zenchef… |
| `WEB_NO_ONLINE_BOOKING_SEEN` | INFERRED | Le titre de la page | Rien de tel sur toutes les pages lues |

## Garanties

- **Contexte uniquement.** Chaque fait est une note : `criterion` et `value` nuls. Il n'est jamais proposé comme
  preuve, n'entre jamais dans `scoreProspect` et n'exclut jamais un prospect.
- **Aucune citation inventée.** Un fait OBSERVED n'est gardé que si son extrait se retrouve dans la page
  (`isGrounded`) : texte visible normalisé, ou code source pour un fait technique.
- **L'absence n'est pas une preuve.** Un fait « non repéré » est INFERRED, dit combien de pages ont été lues, et
  n'est jamais émis sur une page quasi vide (site dessiné en JavaScript, que l'analyse n'exécute pas) ni sans titre.
- **Site officiel seulement.** Rien n'est lu sur une page tierce (`source_type` différent de `official_website`).
- **Au plus 8 faits** par analyse, placés après les observations des critères de l'ICP.
- **Pour tous les métiers.** ProspectOS n'est pas réservé aux prestataires web : ces faits ont leur propre section
  repliée dans la revue des preuves (« Site web : diagnostic technique (pour information) »), séparée des autres
  éléments trouvés. Celui qui ne vend rien autour des sites n'a qu'à ne pas l'ouvrir.

## Origine

Le score de confiance du crédit d'agence et les empreintes de plateformes viennent de Harvey
(github.com/ethanplusai/harvey, licence MIT, `harvey/collectors/profile.py`), réécrits pour les sites français :
formulations françaises (« Site réalisé par », « Conception : », « Création site internet »), mentions
d'hébergement (LCEN) écartées, ligne de mentions légales découpée par segment, et comparaison des domaines par
libellé entier (le test par sous-chaîne de Harvey écartait par erreur `studio-x.com` à cause de `x.com`).
