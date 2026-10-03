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

- Le 3 octobre 2026, l’utilisateur confirme avoir installé les règles Firebase et autorise la publication officielle. Le précédent blocage d’accès n’est donc plus retenu comme obstacle à cette publication. Cette confirmation ne constitue pas une vérification indépendante des règles de production.
- Contrôles Auth/synchronisation sur deux appareils en production : restent à confirmer ; les tests multi-appareils automatisés utilisent les émulateurs, pas les données réelles.
- Notifications distantes : implémentation et tests locaux présents, mais service non déployé et `push-config.json` vide. Firebase d’abord selon le choix de l’utilisateur ; les rappels internes restent disponibles.
- Compléter les informations de contact privées et les paramètres opérationnels de confidentialité avant diffusion large.
- Publication officielle autorisée sur `main` après confirmation utilisateur des règles ; contrôler la version effectivement servie par GitHub Pages après le push.

Le mini-guide V5 est accessible depuis la cloche et Réglages → Notifications. Son état de lecture est enregistré localement par utilisateur, sans nouvelle requête Firebase ni modification du schéma des règles. Un test vérifie son unicité, son accès et la persistance de lecture après rechargement sur les quatre tailles d’écran.
