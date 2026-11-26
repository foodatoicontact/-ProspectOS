# ProspectOS installable (PWA)

Décision du propriétaire du 26 nov. 2026. Migration 057, livrée dans une seule PR empilée sur le cockpit (#109).

## Manifeste et démarrage

`app/manifest.ts` est servi à l'adresse `/manifest.webmanifest`. Il déclare :

- le nom ProspectOS ;
- les icônes du favicon (`app/icon.png`), en 192 et 512 px, plus des versions « maskable » sur le vert de l'icône (`public/icons/`) ;
- la couleur de thème `#236c53` ;
- l'affichage `standalone` ;
- la page de démarrage `/app`.

`/app` est l'application elle-même : l'écran de connexion pour un visiteur, l'espace de travail pour une session ouverte. Elle n'est jamais indexée. Sur iPhone, `appleWebApp` ouvre l'app ajoutée à l'écran d'accueil en plein écran.

## Service worker (`public/sw.js`)

Il est volontairement minimal :

- **Mis en cache** : les pages publiques (le réseau d'abord, la copie en cache hors ligne), la coquille de l'app (`/app`, `/`) et les fichiers du build (`/_next/static`).
- **Jamais mis en cache** : une réponse d'API (`/api/…`), une requête qui porte des identifiants, une page privée (`/cockpit`, `/partenaires/espace`, `/partenaires/admin`, `/d/…`). La coquille ne contient aucune donnée : les données viennent toujours de l'API.
- **`push`** : il affiche la notification dans la langue de l'appareil, à partir de `{kind,url}` seulement.
- **`notificationclick`** : il ouvre l'app sur le lien, toujours une adresse de ProspectOS.

Il est enregistré par `src/pwa/PwaBoot.tsx`, monté dans `app/layout.tsx`. `/sw.js` est servi en `no-cache` (`next.config.ts`).

## Notifications push web

Elles fonctionnent sur iPhone (iOS 16.4 ou plus récent, une fois l'app ajoutée à l'écran d'accueil), sur Android et sur ordinateur.

**Consentement.** La personne touche « Activer » ; le navigateur pose alors sa propre question. Un appareil qui accepte enregistre son abonnement pour le compte (`save_push_subscription`).

**Réglages.** Ils se trouvent dans le menu du compte, entrée « Notifications ». On peut activer ou désactiver les notifications pour cet appareil, puis choisir chaque type :

| Type | Déclencheur | Lien ouvert |
|---|---|---|
| Nouvelle livraison de veille | une livraison est créée pour l'organisation (tous ses membres) | `/app#veille` |
| Nouveaux signaux | la surveillance (`trigger='monitor'`) trouve des signaux, au plus une fois par jour et par personne | `/app#aujourdhui` |
| Fin d'essai | un essai terminé depuis moins de 3 jours, une seule fois (tâche quotidienne `/api/cron/cockpit`) | `/app#offres` |

« Recherche enregistrée » n'existe pas dans ProspectOS. Par décision du propriétaire, c'est la **surveillance de prospects** qui en tient lieu, pour la notification comme pour l'invitation.

**Envoi** (`src/pwa/webpush.ts`, bibliothèque `web-push`). Le message est chiffré pour chaque appareil et signé avec les clés VAPID. Il est envoyé :
- juste après une livraison ;
- après la surveillance ;
- dans la tâche quotidienne.

Un appareil que le service de notification déclare disparu (404 ou 410) est supprimé. La suppression du compte supprime tous ses appareils.

**Contenu.** Seuls `{kind,url}` transitent par les services d'Apple, Google ou Mozilla : jamais un nom d'entreprise, le contenu d'un signal ou une donnée personnelle.

**Variables (Vercel) :**

| Variable | Rôle |
|---|---|
| `WEB_PUSH_VAPID_PUBLIC_KEY` | Clé publique, donnée aux navigateurs. |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Clé privée, secrète. |
| `WEB_PUSH_SUBJECT` | Facultatif. `mailto:contact@prospectos.fr` par défaut. |

Pour générer la paire de clés : `npx web-push generate-vapid-keys`. Sans ces variables, rien n'est envoyé.

## Invitation à installer

Elle est montée dans l'app connectée seulement (`src/ui/v2/pwa/PwaLayer.tsx`), jamais sur une page publique. Les règles sont dans `src/pwa/rules.ts` et testées.

**Conditions d'affichage :**
- mobile seulement ;
- jamais si l'app est déjà en mode standalone ou installée sur cet appareil ;
- jamais dans les 2 premières minutes de la première session ;
- sur iPhone, seulement dans Safari ;
- sur Android, seulement quand Chrome propose l'installation (`beforeinstallprompt`).

**Déclencheurs :**
- une recherche qui vient de se terminer avec des résultats ;
- la mise sous surveillance d'un prospect ;
- l'ouverture d'une livraison de veille.

**Présentation.** C'est un bandeau en bas de l'écran, au-dessus de la navigation, qui ne bloque pas la page.
- Sur iPhone, il montre les étapes Partager → « Sur l'écran d'accueil » → « Ajouter », avec l'icône Partager dessinée.
- Sur Android, il montre un bouton « Installer ».

**Plafond.** L'invitation s'affiche au plus 3 fois par appareil, avec au moins 7 jours entre deux affichages.
- « Plus tard » ferme le bandeau ; l'affichage a été compté au moment où il est apparu.
- « Ne plus afficher » enregistre le refus sur le compte (`refuse_install_prompt`) : l'invitation est coupée sur tous les appareils de la personne.

**Après l'installation.** Si `appinstalled` est reçu ou si l'app s'ouvre en standalone, l'invitation ne revient plus jamais sur cet appareil. Au premier lancement, la personne se voit proposer une seule fois d'activer les notifications.

**Mesures** (Fil du cockpit, groupe « Application ») :
- invitation affichée ;
- invitation refusée ;
- app installée ;
- notifications activées.

Ces quatre événements sont rattachés au compte, avec le type d'appareil. Un identifiant tiré au hasard par l'appareil sert à les borner : au plus 3 « invitation affichée » par appareil, au plus un seul de chaque autre événement.

## E-mails

Une seule ligne a été ajoutée, dans l'e-mail « Votre espace de veille est ouvert » (`src/dedicated/notify.ts`) :

```
Sur téléphone, installez ProspectOS sur votre écran d'accueil : https://prospectos.fr/installer-application
```

**Action manuelle** : coller la même ligne, avant la signature, dans le modèle Supabase « Confirm signup » (Supabase → Authentication → Emails, voir `docs/AUTH_EMAIL_CONFIRMATION.md`). Le code ne peut pas modifier ce modèle.

Aucun autre e-mail n'est modifié.

## Aide

La page `/installer-application` décrit l'installation sur iPhone et sur Android, et comment activer ou couper les notifications. Ses captures (`public/aide/`) sont celles des écrans de ProspectOS. Les menus propres à Safari et à Chrome y sont décrits en mots.

## Vérifications

- **Lighthouse.** La catégorie « PWA » a été retirée de Lighthouse à partir de la version 12 (2024). Le contrôle est donc fait avec Lighthouse 11.7.1, la dernière version qui l'a, sur le build de production.
- **iPhone réel.** La réception d'une notification sur un iPhone réel se teste avec un appareil, une fois les clés VAPID en place sur un déploiement https. C'est au propriétaire de le faire, en suivant la procédure de la PR.
