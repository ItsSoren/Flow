# Activer Firebase pour Flōw V5

Projet existant : `novatasks-23d9d`. Garder le forfait Spark et préserver les données Sōlo/NovaTasks.

## Avant publication

1. Ouvrir Firebase Console avec un compte administrateur autorisé.
2. Sauvegarder les règles actuellement publiées et comparer leurs blocs Sōlo avec `firestore.rules`. Si la production a évolué, fusionner ces changements avant publication : ne pas écraser une version plus récente.
3. Publier le fichier complet **`firestore.rules`**, jamais `flow-firestore.rules` (simple avertissement de migration), ni un extrait Flow.
4. Vérifier Auth e-mail/mot de passe, le domaine autorisé de l’hébergement et les liens des e-mails de vérification/réinitialisation. Auth est partagé : ne pas casser les réglages Sōlo.
5. Le client utilise la configuration publique de `firebase-config.js`. Une application Web Firebase distincte peut être enregistrée dans ce même projet pour mieux distinguer les apps. Ne jamais inclure un compte de service ou une clé privée dans le site.

## Tester et déployer

```sh
npm ci
npm run test:rules
npm run test:cloud-ui
```

Les tests ciblent exclusivement les émulateurs `demo-flow-v5`, pas la production. Le test cloud navigateur nécessite `npm start` dans un autre terminal ; il vérifie le SDK réel avec Auth et Firestore locaux. Après comparaison et validation du fichier complet, publier les règles dans la console ou avec une session CLI explicitement autorisée :

```sh
npx firebase-tools deploy --only firestore:rules --project novatasks-23d9d
```

Cette commande modifie la sécurité du projet partagé. Un push GitHub seul ne déploie pas les règles.

## Contrôles en production, avec données fictives

- Connexion, déconnexion, vérification e-mail et réinitialisation.
- Une opération créée sur PC apparaît sur mobile ; une modification hors connexion est synchronisée au retour.
- Les modifications concurrentes demandent un choix et conservent une copie locale.
- Deux comptes différents ne lisent jamais les données personnelles l’un de l’autre.
- L’espace partagé ne contient que le budget/objectif saisi explicitement, pas les comptes et opérations personnels.
- L’effacement personnel conserve le compte Auth et les espaces partagés.
- Sōlo continue à lire et écrire ses collections inchangées.

Ne déclarer la synchronisation prête qu’après ces contrôles. L’état personnel synchronisé est limité à 850 000 octets ; exporter et alléger un historique trop volumineux. Surveiller les quotas dans la console : le regroupement des écritures ne garantit pas une consommation nulle.
