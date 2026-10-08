# Flōw — V5.0.3

Une application de finances personnelles locale, avec synchronisation Firebase facultative. Le dépôt reste nommé **Flow** ; le nom affiché est **Flōw**.

## Mise à jour V5.0.3

Les liens directs vers une rubrique des réglages ouvrent maintenant Réglages puis amènent à la rubrique demandée. Le choix de rubrique sur mobile met aussi à jour l’adresse, pour pouvoir retrouver ou partager le bon écran.

### V5.0.2

Corrections du budget, des confirmations de charges, du rapprochement, des imports, des réservations et de l’affichage mobile. Les clés de stockage V5 et le format personnel sont conservés ; aucune réinitialisation des comptes n’est effectuée. Un résumé figure dans les notifications.

Le partage utilise maintenant des preuves d’invitation privées et un roster transactionnel. Publier les nouvelles règles Firebase est une étape séparée du push GitHub : avant cela, le client conserve la lecture des espaces mais bloque leurs modifications, créations et nouvelles adhésions. Les comptes personnels continuent de se synchroniser sous les règles V5.0.1, ce qui est testé contre émulateur. Après publication, l’administrateur peut utiliser « Sécuriser les anciennes invitations » : les codes sont révoqués, les membres et les résumés conservés. La limite de nouvelles adhésions est de 100 membres actifs ; un ancien espace déjà plus grand conserve ses membres (migration bornée à 1000), mais ne peut pas admettre de nouveau membre tant qu’il n’est pas sous 100.

Le fichier `firestore.rules` contient aussi les règles Sōlo. **Sauvegarder et comparer les règles réellement en ligne avant tout déploiement**, afin de préserver d’éventuelles modifications Sōlo récentes. Ne pas déployer un extrait ni remplacer aveuglément un fichier partagé. Voir les rapports d’audit et `PLAN_JURIDIQUE.md` pour les tests et limites.

## Au quotidien

- Disponible jusqu’au prochain salaire : comptes inclus, charges prévues, réservations et marge de sécurité, sans compter un revenu futur comme déjà reçu.
- Comptes courants, épargne, espèces et autres ; dépenses, revenus, transferts internes, favoris et rapprochement du solde.
- Récurrents à confirmer, objectifs et réservations. Sur salaire confirmé, une réservation automatique peut être refusée pendant cinq minutes ; sinon elle se confirme. Il s’agit d’un budget virtuel, **pas d’un virement bancaire**.
- Import CSV avec aperçu, choix des colonnes et détection des doublons ; aucune connexion bancaire automatique dans cette version.
- Thèmes Flow, Neon Sakura et Ocean Peace en clair/sombre, densité réglable, navigation mobile et animations respectant la réduction des mouvements.
- Tutoriel affiché une fois dans ce navigateur et relançable, wiki recherchable, réglages, confidentialité et crédits.
- Installation PWA et accès local hors connexion après une première ouverture réussie. Rappels dans l’application ; notifications en arrière-plan uniquement après configuration du service optionnel.
- Espaces partagés facultatifs : objectif ou budget saisi explicitement, sans recopier les comptes ni l’historique personnels.

## Lancer en local

Installer Node.js, puis :

```sh
npm ci
npm start
```

Ouvrir `http://127.0.0.1:4173/`. Utiliser un serveur HTTP, pas une ouverture `file://` : les modules et l’installation PWA en dépendent. En production, servir le site en HTTPS.

## Sauvegardes et transferts

Dans **Réglages → Sauvegarde & transfert**, exporter un fichier ou copier un code autonome. Le code contient les données : sa longueur dépend de l’historique, avec des lignes de 64 caractères pour faciliter la copie. Un identifiant de 64 caractères ne peut pas contenir un historique arbitraire sans serveur. Les anciens codes `FLOW42` sont lisibles ; les nouveaux commencent par `FLOW50`.

Les sauvegardes ne sont **pas chiffrées**. Ne pas les publier ni les envoyer à une personne non autorisée. L’import remplace les données personnelles après confirmation : conserver une sauvegarde avant une migration.

## Firebase et confidentialité

Le projet est `novatasks-23d9d`, partagé avec Sōlo/NovaTasks pour Firebase Auth. Les données Flōw utilisent uniquement `flowUsers`, `flowWorkspaces` et `flowInvites` ; les collections Sōlo `users`, `workspaces` et `invites` restent séparées.

En mode local, les données restent dans ce navigateur. Avec la connexion activée, l’état personnel est envoyé à Firestore, les écritures sont regroupées et les conflits entre appareils demandent un choix. Ce n’est pas un chiffrement de bout en bout. L’effacement des données personnelles Flōw ne supprime ni le compte Auth partagé ni les espaces collaboratifs.

Voir [FIREBASE_SETUP.md](FIREBASE_SETUP.md), [CLOUD_DEPLOYMENT.md](CLOUD_DEPLOYMENT.md), [Confidentialité](privacy.html) et [Crédits](credits.html). Les tests locaux ne prouvent pas qu’une configuration de production est déjà publiée.

## Vérification

```sh
npm test
npm run test:rules
npm run test:cloud-ui
npm run test:ui
node tests/ui-offline.cjs
```

Les tests de règles et d’intégration cloud utilisent exclusivement les émulateurs `demo-flow-v5`, jamais la base de production. Ils nécessitent Java compatible avec la version installée de Firebase CLI. Les tests navigateur nécessitent l’aperçu démarré et Chromium Playwright (`npx playwright install chromium`), ou Chrome installé avec `FLOW_BROWSER_CHANNEL=chrome`.

Les notifications en arrière-plan restent désactivées lorsque `push-config.json` ne contient pas de service et de clé publique. Le code du service optionnel et ses instructions sont dans [push-server/README.md](push-server/README.md).
