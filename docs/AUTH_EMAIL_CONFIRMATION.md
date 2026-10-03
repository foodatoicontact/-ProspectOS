# E-mail de confirmation d'inscription — état et actions manuelles

Hotfix `hotfix/auth-activation-ux` (feedback utilisateur réel : l'e-mail de confirmation ressemble à un e-mail
générique Supabase). Le code de l'application ne peut pas changer l'expéditeur ni le contenu de cet e-mail : ils
sont définis dans la configuration Supabase Auth du projet. **Rien n'a été modifié côté Supabase, SMTP ou DNS.**

## État constaté (niveau de vérification)

| Point | Constat | Vérification |
|---|---|---|
| SMTP personnalisé | Aucun dans le code ni dans le dépôt | Vérifié dans le dépôt |
| Template personnalisé | Aucun (pas de dossier `supabase/`, pas de template versionné) | Vérifié dans le dépôt |
| Expéditeur réel | Probablement l'expéditeur par défaut de Supabase, cohérent avec le retour de Jeffrey | **Non vérifié** : configuration Auth distante non lisible avec les droits de la session |
| Objet / contenu | Probablement le template par défaut (« Confirm Your Signup », en anglais) | **Non vérifié** |
| Site URL / Redirect URLs | Inconnues | **Non vérifié** |

Limite connue du mailer par défaut de Supabase (documentation Supabase) : il est prévu pour le développement, avec un
plafond horaire d'envois très bas et sans engagement de délivrabilité. Un SMTP dédié est recommandé pour un usage réel.

## Action manuelle 1 — Template « Confirm signup » (priorité P0, sans risque de délivrabilité)

- **Où** : Supabase Dashboard → projet ProspectOS → Authentication → Emails (Templates) → *Confirm signup*.
- **Objet** : `Confirmez votre adresse pour activer ProspectOS`
- **Corps** (HTML) :

```html
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#19342c">
  <p style="font-size:20px;font-weight:bold">ProspectOS</p>
  <p>Bonjour,</p>
  <p>Vous venez de créer votre compte ProspectOS. Confirmez votre adresse e-mail pour l'activer
     et démarrer votre essai gratuit de 7 jours.</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#236c53;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Confirmer mon adresse</a>
  </p>
  <p style="font-size:13px;color:#5e6f62">Vous n'êtes pas à l'origine de cette inscription ? Ignorez simplement cet e-mail : aucun compte ne sera activé.</p>
  <p style="font-size:13px;color:#5e6f62">— L'équipe ProspectOS</p>
</div>
```

- **Objectif** : l'utilisateur reconnaît ProspectOS dès l'objet et le bouton, sans aucune mention technique.
- **Risque** : faible. Le lien `{{ .ConfirmationURL }}` doit rester présent, sinon la confirmation devient impossible.
- **Rollback** : bouton « Reset to default » du template.

## Action manuelle 2 — URLs de redirection (P0, vérification)

- **Où** : Authentication → URL Configuration.
- **Vérifier** : `Site URL` = `https://prospectos-v0.vercel.app` (jamais `localhost`). Ajouter
  `https://prospectos-v0.vercel.app/` aux *Redirect URLs*. N'ajouter une Preview que si on veut y tester l'inscription.
- **Pourquoi** : l'application envoie désormais `emailRedirectTo` = le site d'inscription. Supabase ne l'honore que s'il
  figure dans la liste, sinon il renvoie vers la `Site URL`. Une `Site URL` en `localhost` casserait la confirmation.
- **Rollback** : remettre les valeurs précédentes (les noter avant toute modification).

## Action manuelle 3 — SMTP transactionnel dédié (P1, à valider)

- **Où** : Authentication → Emails → SMTP Settings (+ DNS du domaine d'envoi).
- **Solution** : un fournisseur transactionnel (par exemple Resend, Postmark, Brevo ou Amazon SES), avec un expéditeur
  du type `ProspectOS <no-reply@domaine-prospectos>`.
- **Bénéfice attendu** : nom et domaine ProspectOS dans la boîte de réception, plafond d'envoi adapté, meilleure
  délivrabilité. Aucune garantie de ne jamais finir en spam.
- **Configuration** : un domaine à soi, avec les enregistrements SPF, DKIM et DMARC fournis par le prestataire, puis
  hôte, port, utilisateur et mot de passe SMTP saisis dans Supabase.
- **Coût** : souvent gratuit ou faible à ce volume, selon le prestataire.
- **Risque** : une configuration SPF/DKIM incorrecte peut faire échouer tous les envois (inscriptions bloquées).
  À faire hors période de test utilisateur, avec un envoi de test vers plusieurs messageries (Gmail, Outlook).
- **Rollback** : désactiver « Custom SMTP » dans Supabase pour revenir immédiatement au mailer par défaut. Les
  enregistrements DNS ajoutés peuvent rester en place sans effet.
