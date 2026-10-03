# V5 : preuves et portes de livraison

Vérifications locales exécutées le 3 octobre 2026, sur Windows avec Chrome installé. Ce document ne certifie pas la configuration Firebase en production.

## Vérifié

- `npm test` : 36 tests passent (calculs financiers, migrations, CSV, sauvegardes bornées, synchronisation/révisions, effacement après écriture en cours, absence de restauration automatique d’un cache ancien, push minimal, références HTML/SVG et service worker).
- `npm run test:rules` : 8 tests passent dans l’émulateur **demo-flow-v5**. Isolation UID/Sōlo, migration, validation, invitations, rôles, listes restreintes, révocation/retrait et barrière de révision après effacement.
- `npm run test:cloud-ui` : SDK Firebase réel avec Auth/Firestore locaux et données fictives. Inscription, synchronisation PC/mobile, isolation des comptes, partage lecture seule/modification, progression, révocation d’invitation, retrait et effacement vers une session connectée et une session hors connexion avec modifications en attente. Déconnexion, réouverture en mode connexion, réinitialisation de mot de passe et nettoyage des messages du dialogue également vérifiés. Les API Firebase de production sont bloquées dans ce test. Une copie locale de conflit est conservée si un ancien appareil choisit de charger la version cloud.
- `tests/ui-smoke.cjs` : 1440×900, 1024×768, 390×844 et 320×640 ; navigation, absence de débordement horizontal, boutons +/X, dépense, transfert, wiki, quatre variantes Sakura/Ocean, CSV avec doublons, code et rechargement. Aucune erreur JavaScript observée. Module cloud remplacé pour rendre ces parcours locaux déterministes.
- `tests/ui-finance.cjs` : PC et mobile ; création d’objectif avec repère personnel, saisie rapide sans déplacement de focus retardé, salaire, réservation automatique/refus, réserve manuelle/libération sans changement du solde réel, confirmation unique d’un récurrent, création de rappel et cloche. Service worker bloqué dans cette suite pour isoler les formulaires ; l’installation et le hors-ligne sont vérifiés séparément.
- `tests/ui-offline.cjs` : installation du service worker, cache, rechargement hors connexion et opération locale conservée.
- Règles des fonctions et collections Sōlo préservées à l’identique par rapport au fichier du clone local `work/Solo`. Cela ne remplace pas une comparaison avec les règles réellement publiées.

## Pas encore prouvé / à terminer avant livraison complète

- Accès administrateur au projet Firebase : la console du compte connecté a indiqué projet absent ou autorisation insuffisante. Aucune règle de production déployée pour cette V5.
- Comparaison avec les dernières règles réellement publiées, puis déploiement du fichier complet et contrôles Auth/synchronisation avec données fictives sur deux appareils.
- Notifications distantes : implémentation et tests locaux présents, mais service non déployé et `push-config.json` vide. Firebase d’abord selon le choix de l’utilisateur ; les rappels internes restent disponibles.
- Compléter les informations de contact privées et les paramètres opérationnels de confidentialité avant diffusion large.
- Push du site public uniquement après la porte Firebase, puis vérifier la version servie et la mise à jour PWA.

L’aperçu local permet d’essayer l’interface dès maintenant. Ces éléments restant ouverts ne doivent pas être présentés comme un déploiement terminé.
