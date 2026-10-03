# Publication et notifications

## Site

Servir les fichiers publics en HTTPS. Ne pas publier `node_modules`, `tests`, `artifacts`, `.env`, `.dev.vars`, les comptes de service ni les secrets push. Avant de mettre à jour le site public, publier et vérifier les règles compatibles V5 suivant `FIREBASE_SETUP.md`.

Le service worker met en cache les fichiers publics, pas les réponses financières Firebase. Vérifier l’offre de rechargement après mise à jour et la conservation des données locales.

## Notifications en arrière-plan : option non activée

Lorsque `push-config.json` est vide, aucune demande d’autorisation push n’est déclenchée. Firebase seul fournit ici Auth et la synchronisation : l’architecture statique Spark n’exécute pas les rappels programmés en arrière-plan.

Le service optionnel est documenté dans `push-server/README.md`. Il nécessite Cloudflare, un Worker, un espace KV, les secrets VAPID et une origine autorisée explicite. Vérifier abonnement/désabonnement et livraison avant d’activer la configuration publique. Les rappels dans Flōw et l’installation PWA restent disponibles sans lui.

Les notifications distantes sont génériques : ni montants, ni soldes, ni libellés financiers ne sont transmis au service ou affichés sur l’écran verrouillé. Leur livraison dépend du navigateur, du système et de la cadence du service ; ce n’est pas une alarme garantie.

## Avant diffusion large

Compléter les coordonnées privées de contact de l’éditeur et les informations opérationnelles propres au projet dans la politique de confidentialité. Les protections et tests fournis ne constituent pas une certification juridique ou un audit de sécurité indépendant.
