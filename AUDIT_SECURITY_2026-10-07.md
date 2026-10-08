# Audit sécurité indépendant de Flow — 7 octobre 2026

Base examinée : `0949b77c604c1dfb148799e5c5031d14eaadf3ac`. Aucun changement applicatif, aucun push et aucune requête contre Firebase de production. Aucun AGENTS.md présent aux niveaux workspace/work/repo inspectés. Les attaques portent exclusivement sur des comptes et données fictifs. Ce rapport ne donne pas de score de sécurité.

## Résultats réellement exécutés

| Vérification | Résultat runtime | Environnement |
| --- | --- | --- |
| Files et copies de conflit pour 100 UID, connexion anonyme, changement de compte pendant lecture/commit | 3 tests réussis | Node 22.22.0, fonctions réelles de flow-cloud.js extraites dans un harnais VM |
| Sauvegardes comportant des entrées nulles, pollution de prototype | Reproduction du défaut de normalisation ; aucune pollution du prototype constatée | Node, Backup.parse et Core.normalizeState réels |
| Bombe gzip >4 Mo, UTF-8 invalide, version future, CSV malformé/surdimensionné et montants injectés | Rejets attendus | Node, bibliothèques applicatives réelles |
| 100 sauvegardes compressées malveillantes, rendu complet : noms, IDs, catégories, notes, emojis, notifications | 1 test réussi, 100 rendus, 0 nœud DOM injecté, 0 exécution du marqueur | Microsoft Edge via Playwright ; serveur local éphémère ; ressources externes bloquées |
| Tests existants de sauvegarde, CSV, synchro, chargement, effacement et worker push | 22/22 réussis | Node, worker avec JWKS fictifs et stockage mémoire |
| Règles Firestore nouvelles | 7/7 exécutés et réussis, 0 skip, 14,724 s ; 100 UID et 302 tentatives refusées ; SEC-01/02/03 reproduits | Exécutés par l'audit principal sur émulateur local ; données isolées dans demo-flow-security-audit |

La première tentative navigateur échouait parce que Chromium Playwright n'est pas installé ; l'exécution Edge réussit. La première exécution des règles sans émulateur produisait 7 skips ; l'audit principal a ensuite exécuté la suite sur son émulateur, avec 7 tests réussis et aucun skip. Les harnais VM et le worker simulé prouvent le comportement des fonctions examinées, pas une authentification complète navigateur/Firebase. Les tests marqués `FINDING` réussissent lorsqu'ils reproduisent un comportement vulnérable : leur succès ne signifie pas que le défaut est corrigé.

## SEC-01 — Code d'invitation à modifier accessible à un lecteur

Priorité de correction élevée. Reproduction runtime confirmée par l'audit principal sur l'émulateur Firestore avec la suite fournie.

`flow-cloud.js:433` copie le code utilisé dans `members/{uid}.inviteCode`. `firestore.rules:239-247` autorise tous les membres, y compris `viewer`, à lire toute cette collection. Les invitations sont réutilisables jusqu'à expiration/révocation (`firestore.rules:40-47`). Le lecteur peut supprimer sa propre membership (`firestore.rules:253-255`), puis la recréer avec un code de rôle `member` obtenu dans le roster d'un autre membre.

Préconditions : l'espace possède un lecteur et un membre ayant rejoint avec un code d'édition encore actif. Aucun accès au compte du propriétaire ni devinette du code n'est nécessaire.

Reproduction précise dans `tests/audit-security-rules.cjs`, test `viewer learns member invite from the roster and rejoins with editing rights` :

1. Créer un espace avec propriétaire, invitation viewer et invitation member.
2. Faire rejoindre member et viewer avec leurs codes respectifs.
3. Depuis viewer, lire la collection members et extraire le code du membre.
4. Vérifier que viewer ne peut pas modifier `goals/summary.saved`.
5. Supprimer sa propre membership, recréer sa membership avec `role: member` et le code extrait.
6. Vérifier que la même modification de saved est maintenant acceptée.

Impact confirmé : le lecteur devient membre et réussit l'écriture de progression qui lui était refusée avant l'attaque. Pas de preuve de promotion administrateur ni d'accès aux finances personnelles. Correctif proposé : ne jamais stocker un secret réutilisable dans un document lisible par les lecteurs ; séparer invitation/preuve d'adhésion du roster public et empêcher que l'adhésion nécessite de publier le code.

## SEC-02 — État malformé reconnu comme sauvegarde et accepté par les règles

Défaut runtime confirmé localement ; acceptation Firestore confirmée par l'audit principal sur émulateur, suivie d'une relecture et de TypeError dans le normalizer.

`FlowBackup.parse(JSON.stringify({...FlowCore.getEmptyState(), accounts:[null]}))` réussit. `FlowCore.normalizeState` lève ensuite TypeError. Le même défaut est reproduit avec `[null]` dans transactions, recurring, goals, reservations, notifications et reminders. Le validateur de sauvegarde vérifie les collections reconnues et leur longueur, sans vérifier la nature de leurs éléments (`flow-backup.js:9`). Le normalizer déréférence chaque élément sans garde (`flow-core.js:52` et suivants).

`firestore.rules:49-68` valide la nature des listes et leur longueur, mais pas leurs éléments ni plusieurs valeurs structurantes comme version. Le test Firestore écrit `[null]` dans accounts **au bon UID**, relit l'état et démontre son échec de normalisation.

Impact : sauvegarde impossible à importer ; état personnel malformé susceptible de casser son chargement et de conduire au retour à un état vide lors de lecture du cache. Une écriture sur l'UID d'autrui n'est pas démontrée. Correctif proposé : rejeter ou filtrer les enregistrements nuls et de type incorrect à chaque frontière de chargement, puis valider les données nécessaires avant remplacement de l'état.

## SEC-03 — La limite annoncée de 100 membres n'est pas appliquée aux adhésions

Reproduction runtime confirmée par l'audit principal sur émulateur : 102 membres réels, alors que memberCount reste à 1.

`flowValidWorkspace` impose `memberCount <=100`, mais l'adhésion ne met jamais à jour ce compteur (`flow-cloud.js:424-436`) et les règles de création de membership ne consultent aucune capacité. Le test fait rejoindre 101 invités au même espace, puis vérifie 102 membres réels pour `memberCount:1`.

Impact : compteur incohérent et absence de limite effective sur les memberships, donc possibilité d'augmenter les lectures/listes et de contourner une limite produit. Ce n'est pas un test de charge ni une preuve de saturation Firebase. Correctif proposé : choisir une limite réelle et l'appliquer avec un compteur validé atomiquement, ou retirer la promesse et le champ de limite trompeurs.

## Contrôles positifs et limites

Les files et copies de conflit restent distinctes pour 100 identités fictives. Une réponse de lecture ou commit Alice arrivée après passage à Bob n'applique pas Alice à Bob et n'efface pas la file Bob dans les interleavings testés. Cela ne prouve pas l'absence de toute course Auth/browser. Les copies en localStorage sont accessibles aux scripts de même origine : le nommage UID assure un cloisonnement logique, pas un chiffrement du navigateur partagé.

La suite Firestore confirme que chaque UID peut écrire son document personnel, que 300 lectures/écritures/suppressions sur l'UID voisin sont refusées, et que deux accès anonymes sont refusés. Les plafonds des neuf listes sont testés avec le bon UID. Les attaques directes de promotion, les modifications viewer, la suppression du propriétaire, les invitations expirées/révoquées et le listing non autorisé sont refusés dans les cas exécutés. Ce contrôle d'accès positif coexiste avec le contournement indirect SEC-01.

Le navigateur a rendu 100 sauvegardes contenant balises img/svg/script et attributs d'événement dans les champs utilisateur. Aucun nœud attaquant ni exécution du marqueur n'apparaît. Les IDs passent par `safeId`, les classes de couleur par une liste fermée, les textes par escapeHtml ou textContent. Les champs de partage sont construits avec textContent à l'inspection statique. Aucun essai d'exploitation XSS contre données réelles, navigateur distant ou interface de partage réelle n'a été effectué.

Un scan des fichiers sources présents n'a trouvé aucune clé privée/service account/token serveur intégré. Les occurrences VAPID_PRIVATE_KEY sont des références à une variable secrète du worker, pas sa valeur. `firebase-config.js` contient la configuration web publique et pointe vers le projet réel ; les suites d'audit ne l'utilisent jamais pour établir une connexion. Historique Git, secrets distants, configuration Firebase/Cloudflare et artefact réellement publié n'ont pas été audités.

La CSP déclarée dans index.html interdit l'exécution inline de scripts/attributs et restreint object/base/form/frame. Des domaines connect-src génériques Google/Workers sont autorisés ; aucune preuve d'exploitation associée n'a été trouvée. La présence d'une CSP dans le repo ne démontre pas les headers ni le contenu du déploiement en ligne.

L'audit a découvert une faiblesse dans la couverture existante : les cas oversized/unexpected de `tests/firestore-rules.cjs` tentent d'écrire `flowUsers/oversized` ou `flowUsers/unexpected` en tant que alice. Ils sont refusés par UID, même si le validateur de schéma serait absent. La suite ajoutée cible le bon UID pour vérifier les plafonds des neuf listes et les champs inattendus.

## Rejouer sans contacter la production

Depuis la racine du repo en PowerShell :

```powershell
node --test tests/audit-security-local.cjs
$env:FLOW_BROWSER_CHANNEL='msedge'
node --test tests/audit-security-browser.cjs
```

Pour les règles, utiliser l'émulateur déjà ouvert par l'audit principal. Le script refuse toute adresse hors localhost/127.0.0.1 et emploie toujours le projet isolé `demo-flow-security-audit`. Il efface les données de **ce seul projet de test** avant chaque cas ; ne pas changer cet identifiant pour celui d'une application.

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
node --test tests/audit-security-rules.cjs
```

Ne pas confondre 100 utilisateurs synthétiques avec 100 sessions Auth réelles ou 100 utilisateurs simultanés de production. Ce volet couvre surtout contrôle d'accès, imports, données malformées et isolation ; les parcours fonctionnels complets et la concurrence financière sont traités par les autres volets de l'audit principal.

## Vérification après correctifs locaux — 8 octobre 2026

Les trois constats SEC-01/02/03 ont reçu des correctifs locaux et des tests de régression : le roster ne révèle plus de codes réutilisables, les anciens codes peuvent être révoqués/nettoyés par l'admin sans supprimer les membres, les états avec entrées nulles sont rejetés au niveau sauvegarde/Firestore et ignorés sans crash par le normalizer, et le compteur incrémenté dans la même écriture que l'adhésion refuse le 101e membre. L'audit des règles a été rejoué sur émulateur : **9 tests réussis, 0 échec, 0 ignoré**; il comprend les 100 UID fictifs et les refus de dépassement de capacité.

Cette première correction cumulative a été remplacée avant livraison V5.0.2 : `memberIds` et `memberCount` sont validés avec la création/suppression correspondante de membership dans une écriture atomique. Un départ libère une place ; une décrémentation sans suppression est refusée. La migration conserve les anciens membres, corrige le compteur réel et ne modifie ni les rôles ni le résumé partagé. Les espaces historiques de 101 à 1000 membres sont volontairement conservés sans nouvelle adhésion au-delà de 100, pour éviter de retirer des accès existants automatiquement. La revue indépendante a signalé cette exception à un plafond absolu de 100 ; elle est désormais explicitement documentée et testée.

La lecture des corps du worker Push reste bornée et ses tests passent. Cela ne constitue pas une seconde revue Codex Security des changements ni une vérification des règles déployées. Le premier cycle reviewer a identifié la migration des anciens partages; le client local accompagne désormais ce nettoyage, mais aucune action n'a été faite sur les espaces ou règles de production.

## Livraison V5.0.2 — vérifications finales

Une revue de candidat indépendante supplémentaire a inspecté les règles, le client et les tests de partage, sans écriture. Le seul constat restant était l’exception de capacité historique ci-dessus, assumée pour compatibilité. Suite finale : 8 tests de règles fonctionnelles + 11 tests de sécurité des règles réussis, sans skip. Le test de remplacement après départ passe, ainsi que les migrations de 2 et de 101 membres.

Le SDK Firebase réel contre émulateurs passe les clics physiques, les droits, la révocation, le retrait, la synchronisation et l’effacement multi-appareils. Le nouveau client a également été testé avec les règles exactes du commit V5.0.1 : comptes/historique préservés, nouvelle écriture personnelle synchronisée sur mobile, création/adhésion de partage bloquée. Le test de capacité du client est une lecture privée non destructive ; aucun secret ou écriture de test n’est envoyé à la production.

Les règles de production n’ont pas été inspectées ni déployées : aucune session Firebase CLI autorisée ni onglet console accessible lors de la livraison. Le push du site ne publie pas les règles. La fermeture serveur de SEC-01 nécessite toujours la publication des règles puis la révocation/nettoyage des anciens codes par l’admin. Le blocage côté client ne protège pas contre un client malveillant utilisant d’anciennes règles encore vulnérables.
