# Liens de démo (migration 042)

Le propriétaire d'un projet crée un lien en lecture seule vers les entreprises de ce projet. La personne qui le reçoit
l'ouvre sans compte, puis peut créer un compte et garder une copie.

## Ce que fait chaque partie

| Partie | Fichier | Rôle |
|---|---|---|
| Base | `db/migrations/042_demo_shares.sql` | tables `demo_shares` et `demo_share_claims`, cinq fonctions |
| Jeton | `src/demo-share/token.ts` | 32 octets aléatoires en base64url ; seule l'empreinte SHA-256 est stockée |
| Page publique | `app/d/[token]/route.ts`, `src/demo-share/page.ts` | HTML autonome, GET et HEAD seulement |
| Application | `src/demo-share/api.ts`, `src/components/DemoSharePanel.tsx` | créer, lister, désactiver ; copie après inscription |

## Règles

- Seul un propriétaire (`role='owner'`) de l'organisation du projet crée, liste et désactive les liens.
- Le lien s'affiche une fois. Il expire après 14 jours.
- Un lien inconnu, expiré ou désactivé reçoit la même page « Lien expiré ou invalide » (404).
- La page ne lit que le projet du lien : nom et ville des entreprises, signaux non rejetés (type, dates, extrait, lien
  officiel) et les clés d'affichage `raw_metadata.demo` (`department`, `activity`, `sells_vehicles`, `is_new`, `hook`).
  Aucun téléphone, aucun e-mail, aucune preuve, aucun statut.
- L'ordre d'affichage (priorité, puis date du signal) n'est pas le score du produit, qui ne compte que les preuves vérifiées.
- Pas de référencement : en-tête `X-Robots-Tag`, balise `robots`, `/d/` fermé dans `robots.txt`.
- Charger la page ne modifie que le compteur de vues. Les robots d'aperçu (LinkedIn, Slack, WhatsApp…) et les
  préchargements reçoivent la page sans être comptés (`src/demo-share/bots.ts`).
- Limite de débit : 30 pages par minute, par adresse et par instance serveur, en mémoire. Une règle au niveau de la
  plateforme reste à ajouter (audit, lot 2).
- Copie après inscription : projet, ciblage, entreprises et signaux, dans l'organisation du nouveau compte. Les signaux
  repassent « à vérifier ». Une seule copie par compte et par lien.

## Notification de première ouverture

Un e-mail part vers l'adresse de connexion du créateur, une fois par lien, si le SMTP est configuré
(`OUTREACH_SMTP_HOST`, `OUTREACH_SMTP_USER`, `OUTREACH_SMTP_PASSWORD`, `OUTREACH_FROM_EMAIL`). Sans SMTP, rien ne part :
le nombre de vues et la dernière ouverture restent visibles dans le bloc « Partager une démo ».

`DEMO_SHARE_AUTHOR` (facultatif) change le prénom du bandeau « Démo préparée pour vous par … ». Défaut : Kevin.

## Tests

`npm run test:demo-shares-db` (base, 15 contrôles) et `tests/demo-share.test.ts` (10 tests).
