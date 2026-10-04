# V5 : preuves et portes de livraison

Vérifications locales exécutées les 3 et 4 octobre 2026, sur Windows avec Chrome installé. Ce document ne certifie pas la configuration Firebase en production.

## Correctif V5.0.1 — 4 octobre 2026

- 46 tests unitaires passent. Comparaisons canoniques après normalisation : l’ordre des champs Firestore et le passage V4/V5 ne sont plus assimilés à un conflit. Un changement réel de solde, une file basée sur une révision dépassée ou un document effacé restent protégés.
- Reprise automatique d’une file locale basée sur la révision cloud actuelle, sans confirmation superflue. Les échos optimistes Firebase ne sont pas considérés comme des sauvegardes cloud confirmées.
- Régression avec SDK Firebase réel et émulateurs : rechargement d’un cache non vide, deux lectures d’un document V4 sans popup, soldes courant/épargne 1000/200 préservés et premier enregistrement V5 avec alias de solde initial lisible par V4. Cette compatibilité porte sur le solde initial ; elle ne rend pas V4 compatible avec toutes les fonctionnalités V5.
- Confirmation par échéance datée et idempotente, affichage immédiat local, prévention des doubles appuis et indication de la dernière confirmation/prochaine échéance. Les échéances futures restent à venir ; leur date peut être modifiée pour un paiement anticipé.
- Les charges dépassées non confirmées sont déduites du disponible ; leur confirmation ne crée pas une seconde déduction. Les réservations manuelles utilisent le même principe.
- Contrôles UI sur PC, 390 px et 320 px : case favori réellement 18 px, formulaire et longue ligne récurrente sans débordement horizontal, double appui ne créant qu’une opération, budget et solde actualisés immédiatement. Les parcours généraux couvrent aussi 1024 px.
- Bandeau discret indiquant « enregistré ici », « hors connexion » ou « synchronisé ». Nouveau cache 5.0.1, références de modules versionnées et activation du service worker d’attente sur demande de l’utilisateur ; pas d’effacement du stockage local.
- Règles Firebase inchangées : aucune republication requise pour ce correctif. Aucune donnée personnelle réelle ni aucun compte Firebase de production modifié par les tests.
- Test multi-appareil avec SDK réel et Firebase locaux : une facture mensuelle est confirmée hors connexion en un appui, le solde passe immédiatement de 995 à 945, l’étiquette indique l’attente, puis le second appareil retrouve exactement 945 après synchronisation. Un premier passage de la suite a expiré à l’attente de la première écriture ; la relance instrumentée a passé l’ensemble des contrôles. Aucun résultat d’un test échoué n’est compté comme réussite.

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
