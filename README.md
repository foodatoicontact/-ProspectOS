# ProspectOS

ProspectOS est un moteur de prospection B2B evidence-first qui aide les équipes à découvrir, qualifier et
suivre des entreprises à partir de signaux publics vérifiables.

**Prospection autonome, action humaine.** ProspectOS cherche, trie et documente ; la décision, la
validation des preuves et le contact restent humains.

## Le problème

La prospection B2B repose encore largement sur :

- des listes recyclées, où les mêmes entreprises reviennent d'une recherche à l'autre ;
- une qualification manuelle, longue et peu reproductible ;
- des données peu contextualisées (un nom, un site, rarement la raison de s'y intéresser) ;
- des faux positifs : annuaires, articles, pages sans rapport présentés comme des entreprises ;
- des scores opaques, impossibles à expliquer à un commercial ou à un client ;
- des recommandations sans preuve vérifiable derrière elles.

## La réponse ProspectOS

```
Besoin commercial
  → ICP (profil client idéal, critères pondérés)
  → Discovery (recherche d'acteurs)
  → résolution d'entité et déduplication
  → collecte de signaux publics
  → qualification
  → validation humaine
  → scoring explicable
  → activation commerciale
```

Chaque étape laisse une trace : d'où vient l'entreprise, ce qui a été observé, ce qui a été confirmé, par
qui, et pourquoi le score vaut ce qu'il vaut.

## Principes produit

### Evidence-first

Chaque signal important est relié à une source publique (URL exacte, extrait lu, date de collecte) ou à une
observation explicable. Une absence d'information reste « inconnue » : elle n'est jamais convertie en
réponse négative ou positive.

### Human-in-the-loop

Aucune preuve ne devient `VERIFIED` automatiquement. Le système propose ; un utilisateur confirme, contredit
ou laisse non vérifié après lecture de la source. Aucun message n'est envoyé par ProspectOS.

### Memory-aware discovery

ProspectOS garde la mémoire des acteurs déjà rencontrés dans un projet : entreprises déjà ajoutées, déjà
vues dans une recherche précédente ou écartées. Une nouvelle recherche est comparée à tout l'historique du
projet, jamais à celui d'un autre projet ou d'une autre organisation.

### Novelty

Chaque résultat exploitable reçoit un statut, relatif au projet :

| Statut | Signification |
|---|---|
| `NEW` | jamais vu dans ce projet |
| `SEEN` | apparu dans une recherche précédente, jamais ajouté |
| `ADDED` | déjà un prospect du projet (jamais recréé en double) |
| `IGNORED` | écarté explicitement lors d'une recherche précédente |
| `CURRENT_RUN_DUPLICATE` | même acteur déjà présent plus haut dans la même recherche |

L'identité repose sur des éléments forts (prospect lié, domaine propre, téléphone, nom avec localisation
compatible), jamais sur une simple ressemblance de nom.

### Search-Until-New

Quand une recherche ramène surtout des acteurs déjà connus, l'utilisateur peut demander à ProspectOS
d'explorer d'autres variantes de sa propre requête pour faire émerger de nouveaux acteurs. L'exploration
est bornée (nombre de requêtes, temps, coût visible) et chaque recherche indique pourquoi elle s'est
arrêtée. ProspectOS ne promet jamais un nombre de nouveaux prospects.

## Capacités actuelles

Statuts : **Disponible** (dans le code en production, testé), **Bêta** (disponible sous condition
d'activation ou de configuration), **Roadmap** (non disponible).

| Capacité | Statut |
|---|---|
| Projets de prospection, offre, ICP pondéré (total 100) | Disponible |
| Discovery via API de recherche web officielle, avec classement des sources (entreprise, annuaire, média, page non pertinente) | Disponible |
| Résolution d'entité, déduplication, garde contre les doublons de prospects | Disponible |
| Mémoire projet et Novelty Engine | Disponible |
| Search-Until-New (exploration bornée) | Disponible |
| Historique des recherches, relecture d'une recherche passée, « Rejouer » (préremplissage sans lancement) | Disponible |
| Analyse de sites publics (pages limitées, sans exécution de JavaScript) | Bêta (activée par l'opérateur) |
| Collecte d'observations et propositions rattachées aux critères de l'ICP | Disponible |
| Revue des preuves : confirmer, contredire, laisser non vérifié | Disponible |
| Scoring explicable, fondé uniquement sur les preuves vérifiées | Disponible |
| Préparation de messages (modèle factuel FR/EN, à partir des preuves vérifiées ; aucun envoi) | Disponible |
| Suivi des prospects (statuts du pipeline, historique) | Disponible |
| Export CSV des prospects ; export des données du compte ; suppression de compte | Disponible |
| Analyse d'offre assistée par IA (proposition à valider), clé API propre (Anthropic) | Bêta (configuration requise) |
| Multi-tenant, isolation PostgreSQL RLS, quotas, journaux d'audit | Disponible |
| Interface FR / EN, démo publique sans compte | Disponible |
| SSO, invitations d'équipe, intégrations CRM | Roadmap |

## Workflow type

1. Décrire le marché cible et l'offre.
2. Définir l'ICP : critères et poids.
3. Lancer une Discovery (requête, zone, catégories, mode de recherche).
4. Examiner les entreprises détectées, triées par nouveauté pour le projet.
5. Ajouter les prospects pertinents, ignorer les autres.
6. Analyser leurs signaux publics.
7. Examiner les preuves proposées, critère par critère, avec leur source.
8. Confirmer les éléments utiles, contredire les éléments faux.
9. Qualifier : le score et la couverture se recalculent sur les seules preuves vérifiées.
10. Préparer l'activation commerciale : message relu, copié et envoyé par l'utilisateur.
11. Relancer une recherche plus tard sans recycler inutilement les mêmes acteurs.

## Gouvernance des preuves

| État | Sens | Effet sur le score |
|---|---|---|
| `VERIFIED` | confirmé par un utilisateur identifié, après lecture de la source | compte (si la preuve est sourcée et datée de moins de 90 jours) |
| `INFERRED` | proposé par le système à partir d'un extrait public | 0 point |
| `UNKNOWN` | aucune information trouvée | 0 point, jamais interprété comme un « non » |
| `CONTRADICTED` | infirmé par un utilisateur | 0 point |

Les états techniques exacts (`NOT_VERIFIED`, `INFERRED_UNCONFIRMED`, `OBSERVED`…) sont décrits dans le
[document DSI](docs/DSI-SECURITY-ARCHITECTURE.md#6-evidence-lifecycle).

**Règle : `INFERRED` ≠ `VERIFIED`.** Le score ne présente jamais une inférence comme une preuve confirmée.
Cette règle est appliquée par le moteur de score et par une contrainte de la base de données (une preuve
vérifiée exige un vérificateur, une source et un extrait).

## Sécurité et gouvernance

- Multi-tenant : chaque donnée appartient à une organisation ; isolation par PostgreSQL Row Level Security.
- Contrôles côté serveur : authentification vérifiée à chaque appel d'API, droits vérifiés en base.
- Quotas persistants par organisation (et par utilisateur pour l'analyse de sites), réservés avant tout
  appel externe.
- Journaux d'audit : analyses de sites, événements métier en ajout seul, coût des appels fournisseurs.
- Protection SSRF, délais d'expiration, taille de réponse bornée, respect de robots.txt.
- Contrôle des sources : un site n'est analysé que si le serveur l'autorise ; le navigateur ne choisit
  jamais la destination.
- Aucune automatisation LinkedIn non autorisée : pas de connexion, d'invitation ni de message automatisé.

Détail : [Architecture, sécurité et gouvernance](docs/DSI-SECURITY-ARCHITECTURE.md).

## Stack

Next.js · TypeScript · PostgreSQL · Supabase (Auth, base de données) · Vercel.

## État du produit

ProspectOS est en **bêta**, avec un accès contrôlé.

Indicateurs étudiés sur des cas réels :

- couverture (les acteurs attendus sont-ils trouvés ?) ;
- précision (part de résultats réellement exploitables) ;
- nouveauté (part d'acteurs jamais vus par le projet) ;
- qualification (critères avec signal, preuves confirmées) ;
- complétude (coordonnées, localisation, activité) ;
- exploitabilité commerciale.

Aucun indicateur de ROI ou de conversion n'est publié à ce stade.

## Limites actuelles

- La couverture dépend des sources publiques indexées et de la façon dont les entreprises se présentent en
  ligne.
- Certains sites bloquent ou ne permettent pas l'analyse automatisée ; l'information reste alors inconnue.
- Une partie des résultats d'une recherche reste non exploitable (annuaires, articles) et est écartée.
- Certaines informations restent inconnues même après analyse.
- La validation humaine reste nécessaire pour tout score non nul.
- La géographie commerciale avancée (zones de chalandise, rayons, communes limitrophes) est en évolution.

## Documentation

- [Executive Overview](docs/EXECUTIVE-OVERVIEW.md)
- [Architecture, sécurité et gouvernance (DSI / CTO / RSSI)](docs/DSI-SECURITY-ARCHITECTURE.md)
- [Novelty Engine](docs/DISCOVERY_NOVELTY.md)
- [Search-Until-New](docs/DISCOVERY_SEARCH_UNTIL_NEW.md)
- [Architecture technique](docs/ARCHITECTURE.md)

## Pour les développeurs

Prérequis : Node.js 24, npm.

```bash
npm ci
npm run dev          # démo locale sans secret : http://localhost:3000
npm run test:all     # tests unitaires, tests PostgreSQL (PGlite) et typecheck
npm run build
```

La démo fonctionne sans compte ni secret. L'espace connecté nécessite un projet Supabase dédié : appliquer
`db/schema.sql` puis les migrations de `db/migrations/` dans l'ordre, et renseigner les variables décrites
dans `.env.example`. Les clés restent côté serveur et ne sont jamais versionnées.
