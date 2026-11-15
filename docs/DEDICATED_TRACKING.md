# Veille dédiée — suivi au résultat

Migration 043 · `src/dedicated/` · `src/ui/v2/dedicated/` · tests `tests/dedicated-tracking*.{ts,mjs}`.

## But

Un client de la « veille dédiée » reçoit des listes numérotées d'entreprises et paie au résultat. Chaque mois, il paie le plus élevé de ces deux montants :

- le minimum garanti ;
- la commission multipliée par le nombre de clients signés.

Le suivi des signatures se fait **dans ProspectOS**, pas dans un tableau externe. L'historique est ainsi fiable pour les deux parties.

## Activation

| Variable | Effet |
|---|---|
| `DEDICATED_TRACKING_ENABLED=true` | Active les routes `/api/v1/dedicated/…`, les entrées du menu du compte (interface v2) et le job quotidien. Désactivée (valeur par défaut) : routes en 404, aucune entrée de menu, le job ne fait rien. |
| `DEDICATED_NOTIFY_EMAIL` (optionnel) | Adresse qui reçoit l'alerte « relevé non validé au 5 ». À défaut, l'alerte part à l'adresse de contact des mentions légales. |
| SMTP existant (`OUTREACH_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `OUTREACH_FROM_EMAIL`) | Sert à envoyer l'alerte. Sans SMTP, l'alerte reste visible dans le tableau de bord et l'envoi sera retenté au passage suivant. |

## Qui voit quoi

- **Client** : tout membre de l'organisation du client voit son contrat, ses livraisons, ses fiches, ses relevés et son journal, jamais ceux d'une autre organisation. Cette règle est appliquée par la RLS.
- **Administrateur** : le compte avec un droit `INTERNAL` `ACTIVE` (le modèle admin de la migration 013) voit tous les clients.
- **Écriture** : personne n'écrit directement dans les tables. Toute modification passe par les fonctions de la migration 043.

## Mise en place d'un client (compte existant)

1. Le client a déjà son compte ProspectOS. Aucun compte n'est créé : la veille est rattachée à **son organisation existante, par identifiant**.
2. L'administrateur ouvre le menu du compte → « Veille dédiée — clients » → **« Proposer une veille »** :
   - il cherche l'organisation par son nom ou par l'adresse d'un membre, puis la choisit (identifiant) ;
   - il saisit le libellé, le minimum et la commission HT, le début de l'essai et le premier mois de relevé ;
   - il joint la proposition PDF générée par `npm run devis` (5 Mo au plus). Le serveur calcule son empreinte SHA-256 à partir des octets stockés.
3. Le client voit la proposition dans son espace, peut lire le PDF, et clique sur **« J'accepte la proposition »**. Tant qu'il n'a pas accepté, l'espace de suivi reste fermé : aucune livraison, aucun export, aucune action.
4. L'acceptation est inscrite au journal en ajout seul : utilisateur, horodatage, version et **empreinte SHA-256 du PDF accepté**. Si la proposition a été remplacée entre-temps, l'ancienne empreinte est refusée. L'espace s'ouvre et l'essai commence à la date prévue.
5. Deux e-mails partent alors (au mieux, s'il y a une configuration SMTP) :
   - à l'administrateur : « Proposition acceptée » ;
   - au client : « Votre espace de veille est ouvert », avec le lien.
6. Les livraisons se font par « Nouvelle livraison » (contrat actif seulement) : on indique le périmètre et on colle une entreprise par ligne, au format `SIREN;Entreprise;Ville;Source;Lien https`.

## Abonnement et résiliation

- **Abonnement** : l'accès à la veille ne dépend d'aucun abonnement ProspectOS. Il reste ouvert si l'essai est expiré ou si l'abonnement est résilié. Aucune fonction de la veille ne lit un droit d'accès, sauf la vérification administrateur. Rien ne passe par Stripe.
- **Résiliation** : l'administrateur utilise « Résilier ». Il n'y a plus de nouvelle livraison. Le client garde la consultation et la mise à jour des statuts **pendant 6 mois**, pour les commissions qui restent dues ; ensuite, l'espace se ferme pour lui.
- **Relevés après résiliation** : après le mois de la résiliation, ils ne portent plus de minimum garanti (commissions seules). Aucun relevé n'est émis pour un mois sans signature.

## Règles tenues par la base de données

- **Statuts** : À contacter, Contacté, Devis envoyé, Signé, Perdu, Déjà client.
- **Déjà client** : accepté jusqu'au 15e jour inclus après la livraison (date de Paris). Il faut fournir une pièce datée au plus tard le jour de la livraison : type, date et référence. Après ce délai, l'option est refusée (`known_window_closed`) et grisée à l'écran.
- **Signé** : la date de la première facture est obligatoire. Elle doit se situer entre la livraison et aujourd'hui.
- **Fiche comptée** : une fiche comptée dans un relevé ne change plus de statut.
- **Journal** (`dedicated_journal`) : il est en ajout seul. Il enregistre :
  - l'ouverture d'une fiche ;
  - les exports CSV et PDF ;
  - chaque changement de statut ;
  - la création d'une livraison ;
  - la génération, la validation et la relance d'un relevé.

  Chaque entrée porte l'horodatage et l'utilisateur. Un déclencheur refuse tout `UPDATE`, `DELETE` et `TRUNCATE`, pour tous les rôles, propriétaire de la table compris. Aucun rôle navigateur ne peut y insérer de ligne.
- **Export** : il passe par `export_dedicated_items`, qui renvoie les lignes et écrit l'entrée du journal dans la même transaction. Chaque ligne porte le numéro de livraison et l'identifiant de la fiche.

## Relevé mensuel

Le job `/api/cron/dedicated-statements` tourne chaque jour à 06:23 UTC. Son passage du 1er du mois fait le travail ; les passages suivants ne trouvent rien de nouveau.

1. Il génère le relevé du mois précédent pour chaque contrat dont le premier mois de relevé est atteint. Le relevé reprend toutes les fiches « Signé » avant la fin de ce mois qui ne figurent dans aucun autre relevé. Le montant vaut `greatest(minimum, commission × signatures)`. Un contrôle (`CHECK`) de la base refuse tout autre montant.
2. Le client valide le relevé d'un clic, avant le 5. Il doit cocher « J'atteste l'exactitude de ce relevé ». La validation est enregistrée dans le journal avec cette mention. Une validation faite à partir du 5 est acceptée, mais marquée en retard (`late`).
3. À partir du 5, chaque relevé non validé est signalé **une fois** à l'administrateur par e-mail. Un envoi échoué est remis en file pour le passage suivant.

## Tableau de bord administrateur

**Compteurs par client** : livrées, ouvertes, exportées, contactées, devis, signées, perdues, déjà clientes.

**Alertes** :

- devis envoyé depuis plus de 60 jours sans suite ;
- fiche exportée sans changement de statut depuis 30 jours ;
- ratio signatures/devis inférieur à 10 % sur 3 mois glissants ;
- relevé non validé après le 4.

## Captures

Le banc `/ui-v2/veille-dediee?view=client|admin` affiche les deux écrans sur des données fictives. Il n'est servi que si `UI_V2_ENABLED` et `UI_V2_BENCH_ENABLED` sont actifs, et jamais en production.
