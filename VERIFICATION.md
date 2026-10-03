# V5 : preuves et portes de livraison

Vérifications locales exécutées le 3 octobre 2026, sur Windows avec Chrome installé. Ce document ne certifie pas la configuration Firebase en production.

## Vérifié

- `npm test` : 34 tests passent (calculs financiers, migrations, CSV, sauvegardes bornées, synchronisation/révisions, effacement après écriture en cours, push minimal, références HTML/SVG et service worker).
- `npm run test:rules` : 6 tests passent dans l’émulateur **demo-flow-v5**. Isolation UID/Sōlo, migration, validation, invitations et lecture seule.
- `tests/ui-smoke.cjs` : 1440×900, 1024×768, 390×844 et 320×640 ; navigation, absence de débordement horizontal, boutons +/X, dépense, transfert, wiki, quatre variantes Sakura/Ocean, CSV avec doublons, code et rechargement. Aucune erreur JavaScript observée. Module cloud remplacé pour rendre ces parcours locaux déterministes.
- `tests/ui-finance.cjs` : PC et mobile ; création d’objectif, salaire, réservation automatique/refus, réserve manuelle/libération sans changement du solde réel, confirmation unique d’un récurrent, création de rappel et cloche.
- `tests/ui-offline.cjs` : installation du service worker, cache, rechargement hors connexion et opération locale conservée.
- Règles des fonctions et collections Sōlo préservées à l’identique par rapport au fichier du clone local `work/Solo`. Cela ne remplace pas une comparaison avec les règles réellement publiées.

## Pas encore prouvé / à terminer avant livraison complète

- Accès administrateur au projet Firebase : la console du compte connecté a indiqué projet absent ou autorisation insuffisante. Aucune règle de production déployée pour cette V5.
- Comparaison avec les dernières règles réellement publiées, puis déploiement du fichier complet et contrôles Auth/synchronisation avec données fictives sur deux appareils.
- Revue finale des paramètres de partage : création/invitation/progression existent, mais gestion et retrait des membres/invitations doivent encore être vérifiés et complétés.
- Revue de la propagation d’un effacement personnel vers un autre appareil resté connecté ou hors connexion ; éviter la restauration silencieuse d’un ancien cache.
- Notifications distantes : implémentation et tests locaux présents, mais service non déployé et `push-config.json` vide. Firebase d’abord selon le choix de l’utilisateur ; les rappels internes restent disponibles.
- Compléter les informations de contact privées et les paramètres opérationnels de confidentialité avant diffusion large.
- Push du site public uniquement après la porte Firebase, puis vérifier la version servie et la mise à jour PWA.

L’aperçu local permet d’essayer l’interface dès maintenant. Ces éléments restant ouverts ne doivent pas être présentés comme un déploiement terminé.
